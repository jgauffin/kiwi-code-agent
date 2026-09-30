import { describe, expect, it } from 'vitest'
import { compactAtFor, compactionPoint } from '../src/agent/session/compaction-point'
import type { Provider } from '../src/agent/session/model-profile'

const claude: Provider = { name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5[1m]', 'claude-sonnet-5[1m]'], compactAtTokens: { 'claude-opus-5[1m]': 300_000 } }

describe('compaction point', () => {
  it('the_ceiling_wins_when_it_comes_before_the_windows_share', () => {
    expect(compactionPoint(1_000_000, 0.75, 700_000)).toBe(700_000)
    expect(compactionPoint(200_000, 0.75, 700_000)).toBe(150_000)
    expect(compactionPoint(200_000, 0.75, 0)).toBe(150_000)
  })

  it('a_model_with_its_own_limit_uses_it_and_one_without_takes_the_global_setting', () => {
    expect(compactAtFor({ apiKeySecret: 'Claude', model: 'claude-opus-5[1m]' }, [claude], 700_000)).toBe(300_000)
    expect(compactAtFor({ apiKeySecret: 'Claude', model: 'claude-sonnet-5[1m]' }, [claude], 700_000)).toBe(700_000)
  })

  it('the_limit_follows_the_provider_the_session_runs_on_not_the_model_name_alone', () => {
    const other: Provider = { name: 'Proxy', engine: 'claude-sdk', models: ['claude-opus-5[1m]'] }
    expect(compactAtFor({ apiKeySecret: 'Proxy', model: 'claude-opus-5[1m]' }, [claude, other], 700_000)).toBe(700_000)
  })
})
