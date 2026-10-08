import { describe, expect, it } from 'vitest'
import { INSTALLED_PROVIDER_NAME, modelUpgrade } from '../src/settings/model-upgrade'
import type { Profile, Provider } from '../src/agent/session/model-profile'

const bundled: Provider = { name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5[1m]', 'claude-sonnet-5[1m]'] }
const berget: Provider = { name: 'berget', engine: 'openai-compatible', baseUrl: 'https://api.berget.ai/v1', models: ['moonshotai/Kimi-K3'] }

const onOpus: Profile = { name: 'Claude', default: { provider: 'Claude', model: 'claude-opus-5[1m]' } }

describe('offering the newer models to a profile on the bundled engine', () => {
  it('a_profile_on_the_bundled_engine_is_moved_to_the_newer_model_on_the_installed_engine', () => {
    const upgrade = modelUpgrade([bundled], [onOpus])!
    expect(upgrade.moves).toEqual([{ from: 'claude-opus-5[1m]', to: 'claude-opus-5-5[1m]' }])
    expect(upgrade.profiles).toEqual([{ index: 0, profile: { name: 'Claude', default: { provider: INSTALLED_PROVIDER_NAME, model: 'claude-opus-5-5[1m]' } } }])
  })

  it('the_provider_it_adds_serves_every_model_of_the_line_the_bundled_one_listed', () => {
    const upgrade = modelUpgrade([bundled], [onOpus])!
    expect(upgrade.provider).toEqual({ name: INSTALLED_PROVIDER_NAME, engine: 'claude-installed', models: ['claude-opus-5-5[1m]', 'claude-sonnet-5-5[1m]'] })
    expect(upgrade.providerIsNew).toBe(true)
  })

  it('the_1m_window_suffix_survives_the_move_and_a_model_without_it_stays_without_it', () => {
    const plain: Profile = { name: 'Plain', default: { provider: 'Claude', model: 'claude-sonnet-5' } }
    expect(modelUpgrade([{ ...bundled, models: ['claude-sonnet-5'] }], [plain])!.moves).toEqual([{ from: 'claude-sonnet-5', to: 'claude-sonnet-5-5' }])
  })

  it('a_step_with_a_model_of_its_own_is_moved_with_the_default_keeping_its_effort', () => {
    const split: Profile = {
      name: 'Balanced',
      default: { provider: 'Claude', model: 'claude-sonnet-5[1m]' },
      steps: { plan: { provider: 'Claude', model: 'claude-opus-5[1m]', effort: 'high' } },
    }
    const upgrade = modelUpgrade([bundled], [split])!
    expect(upgrade.profiles[0]!.profile.steps!.plan).toEqual({ provider: INSTALLED_PROVIDER_NAME, model: 'claude-opus-5-5[1m]', effort: 'high' })
    expect(upgrade.profiles[0]!.profile.default.model).toBe('claude-sonnet-5-5[1m]')
  })

  it('a_step_that_sets_only_an_effort_is_left_alone', () => {
    const own: Profile = { name: 'Balanced', default: { provider: 'Claude', model: 'claude-opus-5[1m]' }, steps: { implement: { effort: 'low' } } }
    expect(modelUpgrade([bundled], [own])!.profiles[0]!.profile.steps!.implement).toEqual({ effort: 'low' })
  })

  it('nothing_is_offered_once_the_profiles_already_run_the_newer_models', () => {
    const installed: Provider = { name: INSTALLED_PROVIDER_NAME, engine: 'claude-installed', models: ['claude-opus-5-5[1m]'] }
    const moved: Profile = { name: 'Claude', default: { provider: INSTALLED_PROVIDER_NAME, model: 'claude-opus-5-5[1m]' } }
    expect(modelUpgrade([bundled, installed], [moved])).toBeUndefined()
  })

  it('a_model_on_an_openai_compatible_endpoint_is_never_moved', () => {
    const kimi: Profile = { name: 'Kimi', default: { provider: 'berget', model: 'moonshotai/Kimi-K3' } }
    expect(modelUpgrade([bundled, berget], [kimi])).toBeUndefined()
  })

  it('a_model_with_no_successor_is_left_where_it_is', () => {
    const old: Provider = { name: 'Claude', engine: 'claude-sdk', models: ['claude-haiku-4-5'] }
    expect(modelUpgrade([old], [{ name: 'Haiku', default: { provider: 'Claude', model: 'claude-haiku-4-5' } }])).toBeUndefined()
  })

  it('an_installed_provider_already_configured_is_pointed_at_rather_than_a_second_one_added', () => {
    const mine: Provider = { name: 'My Claude', engine: 'claude-installed', models: ['claude-opus-5-5[1m]'] }
    const upgrade = modelUpgrade([bundled, mine], [onOpus])!
    expect(upgrade.providerIsNew).toBe(false)
    expect(upgrade.provider).toEqual({ name: 'My Claude', engine: 'claude-installed', models: ['claude-opus-5-5[1m]', 'claude-sonnet-5-5[1m]'] })
    expect(upgrade.profiles[0]!.profile.default.provider).toBe('My Claude')
  })

  it('a_profile_left_on_its_own_models_is_not_listed_as_changed', () => {
    const kimi: Profile = { name: 'Kimi', default: { provider: 'berget', model: 'moonshotai/Kimi-K3' } }
    expect(modelUpgrade([bundled, berget], [kimi, onOpus])!.profiles.map((p) => p.index)).toEqual([1])
  })
})
