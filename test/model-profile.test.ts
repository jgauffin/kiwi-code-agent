import { describe, expect, it } from 'vitest'
import { reasoningEffortFor } from '../src/agent/session/effort'
import { choiceFor, phaseRefusalMessage, providerModel, resolvePhase, resolveStep, sameModelProfile, type ModelProfile, type Profile, type Provider } from '../src/agent/session/model-profile'

const claude: Provider = { name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5', 'claude-sonnet-5'] }
const berget: Provider = { name: 'berget', engine: 'openai-compatible', baseUrl: 'https://api.berget.ai/v1', models: ['moonshotai/Kimi-K3'] }

const profile: Profile = {
  name: 'Balanced',
  default: { provider: 'Claude', model: 'claude-sonnet-5' },
  steps: { plan: { provider: 'Claude', model: 'claude-opus-5', effort: 'high' } },
}

const cheap: Profile = { name: 'Cheap', default: { provider: 'berget', model: 'moonshotai/Kimi-K3' } }
const settingsDefault: ModelProfile = { name: 'Balanced', engine: 'claude-sdk', model: 'claude-sonnet-5' }

describe('resolveStep', () => {
  it('a_step_with_no_entry_of_its_own_runs_the_default', () => {
    expect(resolveStep(profile, [claude], 'implement')).toMatchObject({ name: 'Balanced', engine: 'claude-sdk', model: 'claude-sonnet-5' })
  })

  it('a_step_with_an_entry_overrides_the_default', () => {
    expect(resolveStep(profile, [claude], 'plan')).toMatchObject({ name: 'Balanced', engine: 'claude-sdk', model: 'claude-opus-5', effort: 'high' })
  })

  it('a_claude_provider_names_its_optional_key_so_a_stored_one_replaces_the_editor_login', () => {
    expect(resolveStep(profile, [claude], 'chat')).toEqual({ name: 'Balanced', engine: 'claude-sdk', model: 'claude-sonnet-5', apiKeySecret: 'Claude' })
    expect(providerModel(claude, 'claude-opus-5').apiKeySecret).toBe('Claude')
  })

  it('an_openai_compatible_provider_carries_its_endpoint_and_its_own_name_as_the_key_into_the_resolved_profile', () => {
    const mixed: Profile = { name: 'Mixed', default: { provider: 'berget', model: 'moonshotai/Kimi-K3' } }
    expect(resolveStep(mixed, [claude, berget], 'chat')).toEqual({
      name: 'Mixed',
      engine: 'openai-compatible',
      model: 'moonshotai/Kimi-K3',
      baseUrl: 'https://api.berget.ai/v1',
      apiKeySecret: 'berget',
    })
  })

  it('a_provider_that_is_not_configured_refuses_to_resolve_rather_than_falling_back', () => {
    const orphan: Profile = { name: 'Orphan', default: { provider: 'gone', model: 'x' } }
    expect(() => resolveStep(orphan, [claude], 'chat')).toThrow(/"gone"/)
  })

  it('choiceFor_names_which_model_a_step_would_run_on_without_resolving_it', () => {
    expect(choiceFor(profile, 'plan')?.model).toBe('claude-opus-5')
    expect(choiceFor(profile, 'cleanup')?.model).toBe('claude-sonnet-5')
  })
})

describe('effort', () => {
  const effortOf = (p: Profile, providers: Provider[], step: Parameters<typeof resolveStep>[2], attempt?: number) => resolveStep(p, providers, step, attempt).effort

  it('a_step_without_an_effort_of_its_own_runs_the_one_suggested_for_its_step', () => {
    expect(effortOf(profile, [claude], 'reconcile')).toBe('high')
    expect(effortOf(profile, [claude], 'implement')).toBe('medium')
    expect(effortOf(profile, [claude], 'cleanup')).toBe('low')
  })

  it('a_step_can_set_its_own_effort_and_still_run_the_default_model', () => {
    const own: Profile = { ...profile, steps: { implement: { effort: 'low' } } }
    expect(resolveStep(own, [claude], 'implement')).toMatchObject({ model: 'claude-sonnet-5', effort: 'low' })
  })

  it('chat_has_no_suggestion_and_runs_the_effort_of_the_profile_default', () => {
    expect(effortOf(profile, [claude], 'chat')).toBeUndefined()
    expect(effortOf({ ...profile, default: { ...profile.default, effort: 'low' } }, [claude], 'chat')).toBe('low')
  })

  it('the_suggestion_for_a_step_beats_the_effort_of_the_profile_default', () => {
    expect(effortOf({ ...profile, default: { ...profile.default, effort: 'low' } }, [claude], 'reconcile')).toBe('high')
  })

  it('a_fix_tries_one_level_harder_for_every_test_run_that_failed_again_up_to_the_highest', () => {
    expect([1, 2, 3, 4, 9].map((attempt) => effortOf(profile, [claude], 'fix', attempt))).toEqual(['medium', 'high', 'xhigh', 'max', 'max'])
  })

  it('an_openai_compatible_model_nothing_says_takes_effort_is_sent_none', () => {
    expect(effortOf(cheap, [berget], 'plan')).toBeUndefined()
  })

  it('a_provider_declaring_reasoning_effort_gets_it_capped_at_high', () => {
    const declared: Provider = { ...berget, reasoningControl: 'reasoning_effort' }
    expect(effortOf(cheap, [declared], 'cleanup')).toBe('low')
    expect(effortOf(cheap, [declared], 'fix', 5)).toBe('high')
  })

  it('a_known_model_takes_its_control_from_the_table_under_any_host_prefix', () => {
    const openai: Provider = { name: 'openai', engine: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5', 'openai/gpt-5-mini', 'gpt-4.1'] }
    const on = (model: string): Profile => ({ name: 'Gpt', default: { provider: 'openai', model } })
    expect(effortOf(on('gpt-5'), [openai], 'plan')).toBe('high')
    expect(effortOf(on('openai/gpt-5-mini'), [openai], 'plan')).toBe('high')
    expect(effortOf(on('gpt-4.1'), [openai], 'plan')).toBeUndefined()
  })

  it('a_session_s_effort_is_fitted_to_what_its_endpoint_takes_now_since_older_records_hold_any_level', () => {
    const openai: Provider = { name: 'openai', engine: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5'] }
    const onGpt: ModelProfile = { name: 'Gpt', engine: 'openai-compatible', model: 'gpt-5', apiKeySecret: 'openai', effort: 'max' }
    expect(reasoningEffortFor(onGpt, [openai])).toBe('high')
    expect(reasoningEffortFor({ ...onGpt, model: 'moonshotai/Kimi-K3', apiKeySecret: 'berget' }, [openai, berget])).toBeUndefined()
    expect(reasoningEffortFor({ name: 'Gpt', engine: 'openai-compatible', model: 'gpt-5', apiKeySecret: 'openai' }, [openai])).toBeUndefined()
  })

  it('a_provider_declaring_no_reasoning_control_beats_the_table', () => {
    const openai: Provider = { name: 'openai', engine: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5'], reasoningControl: 'none' }
    expect(effortOf({ name: 'Gpt', default: { provider: 'openai', model: 'gpt-5' } }, [openai], 'plan')).toBeUndefined()
  })
})

describe('resolvePhase', () => {
  it('B1_a_phase_with_a_choice_runs_on_the_configured_profile_it_names', () => {
    const resolution = resolvePhase('implement', 'Cheap', [profile, cheap], [claude, berget], settingsDefault)
    expect(resolution).toEqual({
      kind: 'ok',
      isDefault: false,
      profile: { name: 'Cheap', engine: 'openai-compatible', model: 'moonshotai/Kimi-K3', baseUrl: 'https://api.berget.ai/v1', apiKeySecret: 'berget' },
    })
  })

  it('B2_a_phase_with_no_choice_runs_on_the_settings_default', () => {
    expect(resolvePhase('reconcile', undefined, [profile, cheap], [claude, berget], settingsDefault)).toEqual({
      kind: 'ok',
      profile: settingsDefault,
      isDefault: true,
    })
  })

  it('B6_a_choice_naming_a_profile_no_longer_configured_refuses_and_names_the_missing_configuration', () => {
    const resolution = resolvePhase('cleanup', 'Gone', [profile], [claude, berget], settingsDefault)
    expect(resolution).toEqual({ kind: 'missing', profileName: 'Gone', settingsDefault })
  })

  it('B6_the_refusal_message_names_the_missing_configuration_and_offers_the_settings_default', () => {
    const resolution = resolvePhase('cleanup', 'Gone', [profile], [claude, berget], settingsDefault)
    if (resolution.kind !== 'missing') throw new Error('expected a missing resolution')
    expect(phaseRefusalMessage('cleanup', resolution)).toMatch(/"Gone"/)
    expect(phaseRefusalMessage('cleanup', resolution)).toMatch(/"Balanced"/)
  })
})

describe('sameModelProfile', () => {
  it('two_resolutions_of_the_same_configuration_compare_equal_so_a_change_of_choice_that_resolves_the_same_is_not_treated_as_a_switch', () => {
    const a = resolveStep(profile, [claude], 'implement')
    const b = resolveStep(profile, [claude], 'implement')
    expect(sameModelProfile(a, b)).toBe(true)
  })

  it('a_profile_on_a_different_engine_or_model_is_not_the_same', () => {
    expect(sameModelProfile(resolveStep(profile, [claude], 'implement'), resolveStep(cheap, [claude, berget], 'implement'))).toBe(false)
  })
})

describe('providerModel', () => {
  it('a_model_picked_straight_off_a_provider_is_named_by_both', () => {
    expect(providerModel(berget, 'moonshotai/Kimi-K3')).toEqual({
      name: 'berget · moonshotai/Kimi-K3',
      engine: 'openai-compatible',
      model: 'moonshotai/Kimi-K3',
      baseUrl: 'https://api.berget.ai/v1',
      apiKeySecret: 'berget',
    })
  })
})
