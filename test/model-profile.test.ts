import { describe, expect, it } from 'vitest'
import { choiceFor, providerModel, resolveStep, type Profile, type Provider } from '../src/agent/session/model-profile'

const claude: Provider = { name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5', 'claude-sonnet-5'] }
const berget: Provider = { name: 'berget', engine: 'openai-compatible', baseUrl: 'https://api.berget.ai/v1', models: ['moonshotai/Kimi-K3'] }

const profile: Profile = {
  name: 'Balanced',
  default: { provider: 'Claude', model: 'claude-sonnet-5' },
  steps: { plan: { provider: 'Claude', model: 'claude-opus-5', effort: 'high' } },
}

describe('resolveStep', () => {
  it('a_step_with_no_entry_of_its_own_runs_the_default', () => {
    expect(resolveStep(profile, [claude], 'implement')).toEqual({ name: 'Balanced', engine: 'claude-sdk', model: 'claude-sonnet-5' })
  })

  it('a_step_with_an_entry_overrides_the_default', () => {
    expect(resolveStep(profile, [claude], 'plan')).toEqual({ name: 'Balanced', engine: 'claude-sdk', model: 'claude-opus-5', effort: 'high' })
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
