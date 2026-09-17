import { describe, expect, it } from 'vitest'
import type { ModelProfile } from '../src/agent/session/model-profile'
import type { SettingsTarget } from '../src/settings/protocol'
import { SettingsStore, type ConfigPort, type SecretPort } from '../src/settings/settings-store'

type Written = { key: string; value: unknown; target: SettingsTarget }

/** The configuration as one map, remembering where each write went. */
function fakeConfig(initial: Record<string, unknown>, hasWorkspace = true) {
  const values = new Map(Object.entries(initial))
  const writes: Written[] = []
  const port: ConfigPort = {
    get: <T>(key: string, fallback: T) => (values.has(key) ? (values.get(key) as T) : fallback),
    update: async (key, value, target) => {
      values.set(key, value)
      writes.push({ key, value, target })
    },
    hasWorkspace: () => hasWorkspace,
  }
  return { port, writes, values }
}

function fakeSecrets(stored: string[] = []) {
  const keys = new Map(stored.map((name) => [name, 'x']))
  const port: SecretPort = {
    has: async (name) => keys.has(name),
    store: async (name, value) => void keys.set(name, value),
  }
  return { port, keys }
}

const claude: ModelProfile = { name: 'Claude', engine: 'claude-sdk', model: 'claude-opus-5' }
const kimi: ModelProfile = { name: 'Kimi', engine: 'openai-compatible', model: 'moonshotai/Kimi-K3', baseUrl: 'https://api.berget.ai/v1', apiKeySecret: 'berget' }

function store(config: Record<string, unknown>, options: { hasWorkspace?: boolean; secrets?: string[] } = {}) {
  const cfg = fakeConfig(config, options.hasWorkspace ?? true)
  const sec = fakeSecrets(options.secrets)
  return { store: new SettingsStore(cfg.port, sec.port), ...cfg, secrets: sec.keys }
}

describe('SettingsStore profiles', () => {
  it('renaming_a_profile_updates_the_defaults_that_named_it', async () => {
    const { store: s, values } = store({ profiles: [claude, kimi], activeProfile: 'Claude', planProfile: 'Claude' })
    await s.saveProfile(0, { ...claude, name: 'Opus' })
    expect(values.get('activeProfile')).toBe('Opus')
    expect(values.get('planProfile')).toBe('Opus')
    expect((values.get('profiles') as ModelProfile[]).map((p) => p.name)).toEqual(['Opus', 'Kimi'])
  })

  it('removing_the_work_default_profile_is_refused', async () => {
    const { store: s, values } = store({ profiles: [claude, kimi], activeProfile: 'Claude', planProfile: '' })
    await expect(s.removeProfile(0)).rejects.toThrow(/Claude/)
    expect(values.get('profiles')).toEqual([claude, kimi])
    await s.removeProfile(1)
    expect(values.get('profiles')).toEqual([claude])
  })

  it('duplicate_profile_names_are_refused', async () => {
    const { store: s } = store({ profiles: [claude, kimi] })
    await expect(s.saveProfile(2, { ...kimi, name: 'Claude' })).rejects.toThrow(/already exists/)
    await expect(s.saveProfile(1, { ...kimi, name: 'Claude' })).rejects.toThrow(/already exists/)
    await expect(s.saveProfile(1, { ...kimi, name: 'Kimi' })).resolves.toBeUndefined()
  })

  it('openai_profile_without_base_url_or_key_name_is_refused', async () => {
    const { store: s } = store({ profiles: [claude] })
    await expect(s.saveProfile(1, { ...kimi, baseUrl: ' ' })).rejects.toThrow(/base URL/)
    const { apiKeySecret: _, ...withoutKey } = kimi
    await expect(s.saveProfile(1, withoutKey)).rejects.toThrow(/API key name/)
  })

  it('a_claude_profile_keeps_no_openai_fields', async () => {
    const { store: s, values } = store({ profiles: [] })
    await s.saveProfile(0, { ...claude, baseUrl: 'https://x', apiKeySecret: 'k', effort: 'high' })
    expect(values.get('profiles')).toEqual([{ ...claude, effort: 'high' }])
  })

  it('profiles_and_defaults_write_to_user_settings', async () => {
    const { store: s, writes } = store({ profiles: [claude] })
    await s.saveProfile(1, kimi)
    await s.save('activeProfile', 'Kimi')
    expect(writes.map((w) => w.target)).toEqual(['user', 'user'])
  })
})

describe('SettingsStore workspace settings', () => {
  it('workspace_keys_write_to_the_workspace_target', async () => {
    const { store: s, writes } = store({})
    await s.save('permissions.allow', ['Edit'])
    await s.save('cleanup.fileLines', 300)
    expect(writes).toEqual([
      { key: 'permissions.allow', value: ['Edit'], target: 'workspace' },
      { key: 'cleanup.fileLines', value: 300, target: 'workspace' },
    ])
  })

  it('a_workspace_key_is_refused_without_a_folder_open', async () => {
    const { store: s, writes } = store({}, { hasWorkspace: false })
    await expect(s.save('permissions.deny', ['Bash'])).rejects.toThrow(/open a folder/i)
    expect(writes).toEqual([])
    expect((await s.snapshot()).hasWorkspace).toBe(false)
  })

  it('empty_list_rows_are_dropped', async () => {
    const { store: s, values } = store({})
    await s.save('planIgnore', [' docs/drafts/** ', '', '  '])
    await s.save('verify', [
      { match: '**/*.cs', command: 'dotnet test' },
      { match: '', command: 'npm test' },
      { match: 'src/**', command: '' },
    ])
    expect(values.get('planIgnore')).toEqual(['docs/drafts/**'])
    expect(values.get('verify')).toEqual([{ match: '**/*.cs', command: 'dotnet test' }])
  })
})

describe('SettingsStore api keys', () => {
  it('api_key_is_stored_under_the_name_the_profile_gives', async () => {
    const { store: s, secrets } = store({ profiles: [claude, kimi] })
    await s.setApiKey('berget', 'sk-1')
    expect(secrets.get('berget')).toBe('sk-1')
  })

  it('snapshot_tells_which_named_keys_are_stored_without_the_keys', async () => {
    const { store: s } = store({ profiles: [kimi, { ...kimi, name: 'GLM', apiKeySecret: 'other' }] }, { secrets: ['berget'] })
    const snapshot = await s.snapshot()
    expect(snapshot.keys).toEqual([
      { name: 'berget', stored: true },
      { name: 'other', stored: false },
    ])
    expect(JSON.stringify(snapshot)).not.toContain('sk-')
  })

  it('profile_defaults_name_every_profile_and_the_two_in_use', () => {
    const { store: s } = store({ profiles: [claude, kimi], activeProfile: 'Kimi', planProfile: '' })
    expect(s.profileDefaults()).toEqual({ names: ['Claude', 'Kimi'], active: 'Kimi', plan: '' })
  })
})
