import { describe, expect, it } from 'vitest'
import { takesProfile } from '../src/agent/session/session-status'
import type { ModelProfile } from '../src/agent/session/model-profile'

const fast: ModelProfile = { name: 'Fast', engine: 'claude-sdk', model: 'claude-sonnet-5' }
const balanced: ModelProfile = { name: 'Balanced', engine: 'claude-sdk', model: 'claude-opus-5' }

describe('a feature run follows its profile', () => {
  it('a_turn_already_in_flight_finishes_on_the_model_it_started_on', () => {
    expect(takesProfile('planning', balanced, fast)).toBe(false)
    expect(takesProfile('implementing', balanced, fast)).toBe(false)
  })

  it('a_profile_changed_in_settings_reaches_the_next_turn', () => {
    expect(takesProfile('idle', balanced, fast)).toBe(true)
    expect(takesProfile('needs_human', balanced, fast)).toBe(true)
  })

  it('a_profile_that_resolves_the_same_is_not_a_switch', () => {
    expect(takesProfile('idle', fast, { ...fast })).toBe(false)
  })
})
