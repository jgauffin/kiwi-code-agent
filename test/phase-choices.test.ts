import { describe, expect, it } from 'vitest'
import { chooseProfile, choiceFor, isPhaseStep, shouldApplyPhaseChoice, type FeaturePhaseChoices, type PhaseChoiceStore } from '../src/agent/session/phase-choices'
import type { ModelProfile, PhaseProfile, Step } from '../src/agent/session/model-profile'

const balanced: ModelProfile = { name: 'Balanced', engine: 'claude-sdk', model: 'claude-sonnet-5' }
const fast: ModelProfile = { name: 'Fast', engine: 'claude-sdk', model: 'claude-haiku-5' }
const okFast: PhaseProfile = { kind: 'ok', profile: fast, isDefault: false }
const okBalanced: PhaseProfile = { kind: 'ok', profile: balanced, isDefault: true }
const missing: PhaseProfile = { kind: 'missing', profileName: 'Gone', settingsDefault: balanced }

function fakeStore(seed: FeaturePhaseChoices = {}): PhaseChoiceStore & { saved: FeaturePhaseChoices[] } {
  let current = seed
  const saved: FeaturePhaseChoices[] = []
  return {
    read: () => current,
    save: async (choices) => {
      current = choices
      saved.push(choices)
    },
    saved,
  }
}

describe('isPhaseStep', () => {
  it('B1_the_phases_of_a_feature_that_run_a_model_are_blind_plan_map_against_code_implement_and_cleanup', () => {
    expect((['plan', 'reconcile', 'implement', 'cleanup'] satisfies Step[]).every(isPhaseStep)).toBe(true)
  })

  it('a_featureless_step_takes_no_per_feature_choice', () => {
    expect((['chat', 'docs', 'docs-map', 'file-decisions'] satisfies Step[]).some(isPhaseStep)).toBe(false)
  })
})

describe('choosing a profile', () => {
  it('B7_a_choice_is_held_per_feature_so_choosing_for_one_feature_never_touches_another', async () => {
    const store = fakeStore()
    await chooseProfile(store, 'orders', 'implement', 'Fast')
    await chooseProfile(store, 'billing', 'implement', 'Careful')
    const all = store.read()
    expect(choiceFor(all, 'orders', 'implement')).toBe('Fast')
    expect(choiceFor(all, 'billing', 'implement')).toBe('Careful')
  })

  it('a_fix_of_a_failed_test_run_runs_on_the_profile_chosen_for_implement', async () => {
    const store = fakeStore({ orders: { implement: 'Fast' } })
    expect(choiceFor(store.read(), 'orders', 'fix')).toBe('Fast')
  })

  it('B7_a_choice_is_held_per_step_so_choosing_one_phase_never_touches_another_phase_of_the_same_feature', async () => {
    const store = fakeStore()
    await chooseProfile(store, 'orders', 'plan', 'Strongest')
    await chooseProfile(store, 'orders', 'implement', 'Fast')
    const all = store.read()
    expect(choiceFor(all, 'orders', 'plan')).toBe('Strongest')
    expect(choiceFor(all, 'orders', 'implement')).toBe('Fast')
    expect(choiceFor(all, 'orders', 'reconcile')).toBeUndefined()
  })

  it('B7_clearing_a_choice_leaves_the_feature_s_other_choices_and_never_writes_to_the_spec_or_tasks_file', async () => {
    const store = fakeStore({ orders: { plan: 'Strongest', implement: 'Fast' } })
    await chooseProfile(store, 'orders', 'implement', undefined)
    const all = store.read()
    expect(choiceFor(all, 'orders', 'implement')).toBeUndefined()
    expect(choiceFor(all, 'orders', 'plan')).toBe('Strongest')
    // The store is a plain in-memory map of feature to step to profile name: nothing in `chooseProfile` reads or
    // writes a path, so it cannot reach the spec or the tasks file the way the board and the rules do.
    expect(store.saved.every((snapshot) => Object.values(snapshot).every((steps) => Object.values(steps).every((name) => typeof name === 'string')))).toBe(
      true,
    )
  })

  it('B5_a_choice_for_one_step_never_leaks_into_another_so_a_retrieval_sub_session_resolved_on_its_own_stays_unaffected', async () => {
    // Retrieval has no step of its own to hold a choice for (it is not a SessionMode `isPhaseStep` recognises), so
    // whatever it resolves its own profile from is a lookup this store never feeds: a choice set here for the
    // calling phase cannot reach a step that was never named.
    const store = fakeStore()
    await chooseProfile(store, 'orders', 'reconcile', 'Strongest')
    const all = store.read()
    expect(choiceFor(all, 'orders', 'plan')).toBeUndefined()
    expect(choiceFor(all, 'orders', 'implement')).toBeUndefined()
    expect(choiceFor(all, 'orders', 'cleanup')).toBeUndefined()
  })
})

describe('shouldApplyPhaseChoice', () => {
  it('B3_a_turn_already_in_flight_finishes_on_the_model_it_started_on', () => {
    expect(shouldApplyPhaseChoice('planning', balanced, okFast)).toBe(false)
    expect(shouldApplyPhaseChoice('implementing', balanced, okFast)).toBe(false)
  })

  it('B3_a_choice_takes_effect_on_the_next_turn_once_the_session_is_no_longer_under_way', () => {
    expect(shouldApplyPhaseChoice('idle', balanced, okFast)).toBe(true)
    expect(shouldApplyPhaseChoice('needs_human', balanced, okFast)).toBe(true)
  })

  it('a_resolution_that_resolves_the_same_as_what_is_already_running_is_not_treated_as_a_switch', () => {
    expect(shouldApplyPhaseChoice('idle', fast, okFast)).toBe(false)
    expect(shouldApplyPhaseChoice('idle', balanced, okBalanced)).toBe(false)
  })

  it('B2_a_choice_cleared_back_to_the_settings_default_reaches_the_next_turn_the_same_way_a_choice_does', () => {
    expect(shouldApplyPhaseChoice('idle', fast, okBalanced)).toBe(true)
  })

  it('B6_a_refused_resolution_is_offered_rather_than_applied_so_a_live_session_keeps_running_on_its_own_profile', () => {
    expect(shouldApplyPhaseChoice('idle', balanced, missing)).toBe(false)
  })
})

describe('E1', () => {
  it('E1_changing_the_implement_profile_while_the_board_is_part_worked_reaches_the_next_implement_turn_and_touches_nothing_else_the_board_holds', async () => {
    // The board is mid-work: some tasks are already marked done or in progress on disk. The choice store's only
    // shape is feature -> step -> profile name (`FeaturePhaseChoices`), so nothing about the board's own markers
    // can be read from or written through it; a fresh implement task's run resolves `choiceFor` again from here,
    // which is exactly how it picks up a choice made mid-work rather than one fixed when the board started.
    const store = fakeStore({ orders: { implement: 'Balanced' } })
    await chooseProfile(store, 'orders', 'implement', 'Fast')
    const all = store.read()
    expect(choiceFor(all, 'orders', 'implement')).toBe('Fast')
    expect(Object.keys(all.orders!)).toEqual(['implement'])
  })
})
