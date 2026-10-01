import { describe, expect, it } from 'vitest'
import type { Profile, Provider } from '../src/agent/session/model-profile'
import type { SettingsTarget } from '../src/settings/protocol'
import type { MemoryEntry, MemoryScope } from '../src/agent/memory/memories'
import { SettingsStore, type ConfigPort, type MemoryPort, type SecretPort } from '../src/settings/settings-store'

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
    move: async (from, to) => {
      const value = keys.get(from)
      if (value === undefined) return
      keys.set(to, value)
      keys.delete(from)
    },
    delete: async (name) => void keys.delete(name),
  }
  return { port, keys }
}

const claudeProvider: Provider = { name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5', 'claude-sonnet-5'] }
const bergetProvider: Provider = { name: 'berget', engine: 'openai-compatible', baseUrl: 'https://api.berget.ai/v1', models: ['moonshotai/Kimi-K3'] }

const opus: Profile = { name: 'Opus', default: { provider: 'Claude', model: 'claude-opus-5' } }
const kimi: Profile = { name: 'Kimi', default: { provider: 'berget', model: 'moonshotai/Kimi-K3' } }

/** Remembers what it was asked to forget, rather than touching any real files. */
function fakeMemory(project: MemoryEntry[] = [], user: MemoryEntry[] = []) {
  const forgotten: { scope: MemoryScope; title: string }[] = []
  const port: MemoryPort = {
    list: async () => ({ project, user }),
    forget: async (scope, title) => void forgotten.push({ scope, title }),
  }
  return { port, forgotten }
}

function store(config: Record<string, unknown>, options: { hasWorkspace?: boolean; secrets?: string[] } = {}) {
  const cfg = fakeConfig(config, options.hasWorkspace ?? true)
  const sec = fakeSecrets(options.secrets)
  const mem = fakeMemory()
  return { store: new SettingsStore(cfg.port, sec.port, mem.port), ...cfg, secrets: sec.keys, memory: mem }
}

const withModels = (providers: Provider[], profiles: Profile[], activeProfile: string) => ({ providers, profiles, activeProfile })

describe('SettingsStore profiles', () => {
  it('renaming_a_profile_updates_the_default_that_named_it', async () => {
    const { store: s, values } = store(withModels([claudeProvider, bergetProvider], [opus, kimi], 'Opus'))
    await s.saveProfile(0, { ...opus, name: 'Balanced' })
    expect(values.get('activeProfile')).toBe('Balanced')
    expect((values.get('profiles') as Profile[]).map((p) => p.name)).toEqual(['Balanced', 'Kimi'])
  })

  it('removing_the_active_profile_is_refused', async () => {
    const { store: s, values } = store(withModels([claudeProvider, bergetProvider], [opus, kimi], 'Opus'))
    await expect(s.removeProfile(0)).rejects.toThrow(/Opus/)
    expect(values.get('profiles')).toEqual([opus, kimi])
    await s.removeProfile(1)
    expect(values.get('profiles')).toEqual([opus])
  })

  it('duplicate_profile_names_are_refused', async () => {
    const { store: s } = store(withModels([claudeProvider, bergetProvider], [opus, kimi], 'Opus'))
    await expect(s.saveProfile(2, { ...kimi, name: 'Opus' })).rejects.toThrow(/already exists/)
    await expect(s.saveProfile(1, { ...kimi, name: 'Opus' })).rejects.toThrow(/already exists/)
    await expect(s.saveProfile(1, { ...kimi, name: 'Kimi' })).resolves.toBeUndefined()
  })

  it('a_profile_naming_a_provider_that_is_not_configured_is_refused', async () => {
    const { store: s } = store(withModels([claudeProvider], [], ''))
    await expect(s.saveProfile(0, { name: 'Ghost', default: { provider: 'berget', model: 'x' } })).rejects.toThrow(/not configured/)
  })

  it('a_step_override_identical_to_the_default_is_not_kept_as_one', async () => {
    const { store: s, values } = store(withModels([claudeProvider, bergetProvider], [], ''))
    await s.saveProfile(0, { name: 'Balanced', default: { provider: 'Claude', model: 'claude-opus-5' }, steps: { plan: { provider: 'Claude', model: 'claude-opus-5' } } })
    expect((values.get('profiles') as Profile[])[0]!.steps).toBeUndefined()
  })

  it('a_step_may_set_only_its_effort_and_keeps_it_when_its_model_matches_the_default', async () => {
    const { store: s, values } = store(withModels([claudeProvider], [], ''))
    const steps = { implement: { effort: 'low' as const }, plan: { provider: 'Claude', model: 'claude-opus-5', effort: 'max' as const } }
    await s.saveProfile(0, { name: 'Balanced', default: { provider: 'Claude', model: 'claude-opus-5' }, steps })
    expect((values.get('profiles') as Profile[])[0]!.steps).toEqual({ implement: { effort: 'low' }, plan: { effort: 'max' } })
  })

  it('a_step_naming_a_provider_without_a_model_is_refused', async () => {
    const { store: s } = store(withModels([claudeProvider], [], ''))
    await expect(s.saveProfile(0, { name: 'Half', default: { provider: 'Claude', model: 'claude-opus-5' }, steps: { plan: { provider: 'Claude' } } })).rejects.toThrow(/model/)
  })

  it('the_first_profile_saved_becomes_what_new_sessions_run_on', async () => {
    const { store: s, values } = store(withModels([claudeProvider], [], ''))
    await s.saveProfile(0, opus)
    expect(values.get('activeProfile')).toBe('Opus')
  })

  it('providers_and_profiles_write_to_user_settings', async () => {
    const { store: s, writes } = store(withModels([claudeProvider], [], ''))
    await s.saveProfile(0, opus)
    await s.save('permissions.allow', ['Edit'])
    expect(writes.filter((w) => w.key === 'profiles' || w.key === 'activeProfile').every((w) => w.target === 'user')).toBe(true)
    expect(writes.find((w) => w.key === 'permissions.allow')?.target).toBe('workspace')
  })
})

describe('SettingsStore providers', () => {
  it('renaming_a_provider_updates_the_profiles_that_chose_it', async () => {
    const { store: s, values } = store(withModels([bergetProvider], [kimi], 'Kimi'))
    await s.saveProvider(0, { ...bergetProvider, name: 'GLM' })
    expect((values.get('profiles') as Profile[])[0]!.default.provider).toBe('GLM')
  })

  it('renaming_an_openai_compatible_provider_carries_its_stored_key_to_the_new_name', async () => {
    const { store: s, secrets } = store(withModels([bergetProvider], [], ''), { secrets: ['berget'] })
    await s.saveProvider(0, { ...bergetProvider, name: 'GLM' })
    expect(secrets.has('berget')).toBe(false)
    expect(secrets.get('GLM')).toBe('x')
  })

  it('renaming_a_claude_provider_moves_no_secret', async () => {
    const { store: s, secrets } = store(withModels([claudeProvider], [], ''))
    await s.saveProvider(0, { ...claudeProvider, name: 'Opus SDK' })
    expect(secrets.size).toBe(0)
  })

  it('removing_an_openai_compatible_provider_deletes_its_stored_key', async () => {
    const { store: s, secrets } = store(withModels([claudeProvider, bergetProvider], [], ''), { secrets: ['berget'] })
    await s.removeProvider(1)
    expect(secrets.has('berget')).toBe(false)
  })

  it('removing_a_provider_still_named_by_a_profile_is_refused', async () => {
    const { store: s } = store(withModels([claudeProvider, bergetProvider], [kimi], 'Kimi'))
    await expect(s.removeProvider(1)).rejects.toThrow(/Kimi/)
    await expect(s.removeProvider(0)).resolves.toBeUndefined()
  })

  it('duplicate_provider_names_are_refused', async () => {
    const { store: s } = store(withModels([claudeProvider], [], ''))
    await expect(s.saveProvider(1, { ...bergetProvider, name: 'Claude' })).rejects.toThrow(/already exists/)
  })

  it('an_openai_provider_without_a_base_url_is_refused', async () => {
    const { store: s } = store(withModels([], [], ''))
    await expect(s.saveProvider(0, { ...bergetProvider, baseUrl: ' ' })).rejects.toThrow(/base URL/)
  })

  it('a_claude_provider_keeps_no_endpoint', async () => {
    const { store: s, values } = store(withModels([], [], ''))
    await s.saveProvider(0, { ...claudeProvider, baseUrl: 'https://x' })
    expect(values.get('providers')).toEqual([claudeProvider])
  })

  it('empty_model_rows_are_dropped', async () => {
    const { store: s, values } = store(withModels([], [], ''))
    await s.saveProvider(0, { ...claudeProvider, models: ['claude-opus-5', ' ', ''] })
    expect((values.get('providers') as Provider[])[0]!.models).toEqual(['claude-opus-5'])
  })

  it('a_compaction_limit_is_kept_only_for_a_model_the_provider_still_serves', async () => {
    const { store: s, values } = store(withModels([], [], ''))
    await s.saveProvider(0, { ...claudeProvider, compactAtTokens: { 'claude-opus-5': 300_000, 'claude-haiku-4-5': 100_000, 'claude-sonnet-5': -1 } })
    expect((values.get('providers') as Provider[])[0]!.compactAtTokens).toEqual({ 'claude-opus-5': 300_000 })
  })

  it('a_provider_with_no_compaction_limits_saves_none', async () => {
    const { store: s, values } = store(withModels([], [], ''))
    await s.saveProvider(0, { ...claudeProvider, compactAtTokens: {} })
    expect(values.get('providers')).toEqual([claudeProvider])
  })

  it('an_openai_provider_keeps_its_declared_reasoning_control_and_a_claude_one_none', async () => {
    const { store: s, values } = store(withModels([], [], ''))
    await s.saveProvider(0, { ...bergetProvider, reasoningControl: 'reasoning_effort' })
    await s.saveProvider(1, { ...claudeProvider, reasoningControl: 'reasoning_effort' })
    expect(values.get('providers')).toEqual([{ ...bergetProvider, reasoningControl: 'reasoning_effort' }, claudeProvider])
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
  it('api_key_is_stored_under_the_name_the_provider_gives', async () => {
    const { store: s, secrets } = store(withModels([claudeProvider, bergetProvider], [], ''))
    await s.setApiKey('berget', 'sk-1')
    expect(secrets.get('berget')).toBe('sk-1')
  })

  it('snapshot_tells_which_named_keys_are_stored_without_the_keys', async () => {
    const { store: s } = store(withModels([bergetProvider, { ...bergetProvider, name: 'GLM' }], [], ''), { secrets: ['berget'] })
    const snapshot = await s.snapshot()
    expect(snapshot.keys).toEqual([
      { name: 'berget', stored: true },
      { name: 'GLM', stored: false },
    ])
    expect(JSON.stringify(snapshot)).not.toContain('sk-')
  })

  it('snapshot_tells_whether_a_claude_provider_has_a_key_since_one_replaces_the_editor_login', async () => {
    const { store: s } = store(withModels([claudeProvider, bergetProvider], [], ''), { secrets: ['Claude'] })
    expect((await s.snapshot()).keys).toEqual([
      { name: 'Claude', stored: true },
      { name: 'berget', stored: false },
    ])
  })

  it('an_empty_key_removes_the_stored_one_so_claude_falls_back_to_the_editor_login', async () => {
    const { store: s, secrets } = store(withModels([claudeProvider], [], ''), { secrets: ['Claude'] })
    await s.setApiKey('Claude', '')
    expect(secrets.has('Claude')).toBe(false)
  })

  it('renaming_a_claude_provider_carries_its_key_and_removing_it_deletes_the_key', async () => {
    const { store: s, secrets } = store(withModels([claudeProvider], [], ''), { secrets: ['Claude'] })
    await s.saveProvider(0, { ...claudeProvider, name: 'Anthropic' })
    expect(secrets.has('Anthropic')).toBe(true)
    expect(secrets.has('Claude')).toBe(false)
    await s.removeProvider(0)
    expect(secrets.has('Anthropic')).toBe(false)
  })

  it('profile_defaults_names_every_profile_and_the_one_in_use', () => {
    const { store: s } = store(withModels([claudeProvider, bergetProvider], [opus, kimi], 'Kimi'))
    expect(s.profileDefaults()).toEqual({ names: ['Opus', 'Kimi'], active: 'Kimi' })
  })
})

describe('SettingsStore memories', () => {
  it('the_snapshot_lists_every_memory_the_memory_port_holds', async () => {
    const cfg = fakeConfig({})
    const sec = fakeSecrets()
    const project = [{ title: 'Blue means clickable', file: 'blue.md', summary: 'say so' }]
    const user = [{ title: 'Likes short replies', file: 'CLAUDE.md', summary: 'say less' }]
    const mem = fakeMemory(project, user)
    const s = new SettingsStore(cfg.port, sec.port, mem.port)
    expect((await s.snapshot()).memories).toEqual({ project, user })
  })

  it('forgetting_a_memory_passes_its_scope_and_title_straight_to_the_memory_port', async () => {
    const { store: s, memory } = store({})
    await s.forgetMemory('project', 'Blue means clickable')
    expect(memory.forgotten).toEqual([{ scope: 'project', title: 'Blue means clickable' }])
  })
})

describe('SettingsStore migrating settings from before providers existed', () => {
  it('reads_a_flat_profile_list_as_a_provider_and_a_profile_until_the_page_saves_over_it', async () => {
    const { store: s } = store({ profiles: [{ name: 'Claude', engine: 'claude-sdk', model: 'claude-opus-5' }], activeProfile: 'Claude', planProfile: '' })
    const snapshot = await s.snapshot()
    expect(snapshot.providers).toEqual([{ name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5'] }])
    expect(snapshot.profiles[0]!.default).toEqual({ provider: 'Claude', model: 'claude-opus-5' })
    expect(snapshot.activeProfile).toBe('Claude')
  })
})
