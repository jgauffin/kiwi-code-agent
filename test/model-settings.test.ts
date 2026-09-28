import { describe, expect, it } from 'vitest'
import { migrateModelSettings, needsMigration, type LegacyProfile } from '../src/settings/model-settings'
import { resolveStep } from '../src/agent/session/model-profile'

const opus: LegacyProfile = { name: 'Claude', engine: 'claude-sdk', model: 'claude-opus-5' }
const sonnet: LegacyProfile = { name: 'Claude Sonnet', engine: 'claude-sdk', model: 'claude-sonnet-5' }
const kimi: LegacyProfile = { name: 'Kimi', engine: 'openai-compatible', model: 'moonshotai/Kimi-K3', baseUrl: 'https://api.berget.ai/v1', apiKeySecret: 'berget' }

describe('migrating the one-model-per-profile settings', () => {
  it('profiles_sharing_an_endpoint_become_one_provider_holding_both_models', () => {
    const { providers } = migrateModelSettings([opus, sonnet, kimi], 'Claude Sonnet', '')
    expect(providers).toEqual([
      { name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5', 'claude-sonnet-5'] },
      { name: 'berget', engine: 'openai-compatible', baseUrl: 'https://api.berget.ai/v1', models: ['moonshotai/Kimi-K3'] },
    ])
  })

  it('every_old_profile_stays_a_profile_so_the_picker_still_offers_what_it_offered', () => {
    const { profiles, activeProfile } = migrateModelSettings([opus, sonnet, kimi], 'Claude Sonnet', '')
    expect(profiles.map((p) => p.name)).toEqual(['Claude', 'Claude Sonnet', 'Kimi'])
    expect(activeProfile).toBe('Claude Sonnet')
    expect(profiles[2]!.default).toEqual({ provider: 'berget', model: 'moonshotai/Kimi-K3' })
  })

  it('the_plan_model_becomes_an_override_on_every_planning_step_of_the_profile_in_use', () => {
    const { providers, profiles } = migrateModelSettings([sonnet, opus], 'Claude Sonnet', 'Claude')
    const active = profiles.find((p) => p.name === 'Claude Sonnet')!
    expect(Object.keys(active.steps ?? {}).sort()).toEqual(['docs', 'file-decisions', 'plan', 'reconcile'])
    expect(resolveStep(active, providers, 'plan').model).toBe('claude-opus-5')
    expect(resolveStep(active, providers, 'implement').model).toBe('claude-sonnet-5')
  })

  it('no_plan_model_leaves_every_step_on_the_one_model_that_was_configured', () => {
    const { providers, profiles } = migrateModelSettings([opus], 'Claude', '')
    expect(profiles[0]!.steps).toBeUndefined()
    expect(resolveStep(profiles[0]!, providers, 'plan').model).toBe('claude-opus-5')
  })

  it('effort_and_the_prompt_file_follow_the_model_they_were_set_for', () => {
    const { profiles } = migrateModelSettings([{ ...kimi, effort: 'high', systemPromptFile: 'docs/agent-prompt.md' }], 'Kimi', '')
    expect(profiles[0]!.default).toEqual({ provider: 'berget', model: 'moonshotai/Kimi-K3', effort: 'high', systemPromptFile: 'docs/agent-prompt.md' })
  })

  it('two_endpoints_under_one_key_name_get_providers_of_their_own', () => {
    const other: LegacyProfile = { ...kimi, name: 'GLM', model: 'glm-5', baseUrl: 'https://other.example/v1' }
    const { providers } = migrateModelSettings([kimi, other], 'Kimi', '')
    expect(providers.map((p) => p.name)).toEqual(['berget', 'berget 2'])
  })

  it('an_active_profile_naming_nothing_falls_back_to_the_first_one', () => {
    expect(migrateModelSettings([opus, sonnet], 'Deleted', '').activeProfile).toBe('Claude')
    expect(migrateModelSettings([], '', '').activeProfile).toBe('')
  })

  it('no_provider_configured_yet_is_what_marks_settings_from_before_providers_existed', () => {
    expect(needsMigration([])).toBe(true)
    expect(needsMigration([{ name: 'Claude', engine: 'claude-sdk', models: [] }])).toBe(false)
  })
})
