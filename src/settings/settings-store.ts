import type { ModelProfile } from '../agent/session/model-profile'
import type { VerifyRule } from '../agent/phases/verification'
import type { EditableSettings, SettingKey, SettingsSnapshot, SettingsTarget } from './protocol'

/** The `kiwiAgent` configuration section, keys relative to it. */
export type ConfigPort = {
  get<T>(key: string, fallback: T): T
  update(key: string, value: unknown, target: SettingsTarget): Promise<void>
  hasWorkspace(): boolean
}

/** Secret storage by the name a profile's `apiKeySecret` gives. */
export type SecretPort = {
  has(name: string): Promise<boolean>
  store(name: string, value: string): Promise<void>
}

/** Where a profile's `apiKeySecret` lives in the editor's secret storage. */
export function secretKey(name: string): string {
  return `kiwiAgent.apiKey.${name}`
}

/** What a session runs on by default, as the new-session screen shows and sets it. */
export type ProfileDefaults = { names: string[]; active: string; plan: string }

/**
 * Where each setting is written: what the model runs on and how the host runs
 * it belong to the person; what the agent may do and how a project is checked
 * belong to the workspace.
 */
const TARGETS: Record<SettingKey | 'profiles', SettingsTarget> = {
  activeProfile: 'user',
  planProfile: 'user',
  profiles: 'user',
  nodePath: 'user',
  traceEngine: 'user',
  'permissions.allow': 'workspace',
  'permissions.deny': 'workspace',
  verify: 'workspace',
  verifyFailureBudget: 'workspace',
  'cleanup.functionLines': 'workspace',
  'cleanup.typeLines': 'workspace',
  'cleanup.fileLines': 'workspace',
  'cleanup.ignore': 'workspace',
  planIgnore: 'workspace',
}

export class SettingsStore {
  constructor(
    private readonly config: ConfigPort,
    private readonly secrets: SecretPort,
  ) {}

  async snapshot(): Promise<SettingsSnapshot> {
    const profiles = this.profiles()
    const names = [...new Set(profiles.map((p) => p.apiKeySecret).filter((n): n is string => !!n))]
    return {
      profiles,
      activeProfile: this.config.get('activeProfile', ''),
      planProfile: this.config.get('planProfile', ''),
      keys: await Promise.all(names.map(async (name) => ({ name, stored: await this.secrets.has(name) }))),
      permissions: { allow: this.config.get<string[]>('permissions.allow', []), deny: this.config.get<string[]>('permissions.deny', []) },
      verify: this.config.get<VerifyRule[]>('verify', []),
      verifyFailureBudget: this.config.get('verifyFailureBudget', 3),
      cleanup: {
        functionLines: this.config.get('cleanup.functionLines', 25),
        typeLines: this.config.get('cleanup.typeLines', 200),
        fileLines: this.config.get('cleanup.fileLines', 400),
        ignore: this.config.get<string[]>('cleanup.ignore', []),
      },
      planIgnore: this.config.get<string[]>('planIgnore', []),
      nodePath: this.config.get('nodePath', ''),
      traceEngine: this.config.get('traceEngine', false),
      hasWorkspace: this.config.hasWorkspace(),
    }
  }

  profileDefaults(): ProfileDefaults {
    return {
      names: this.profiles().map((p) => p.name),
      active: this.config.get('activeProfile', ''),
      plan: this.config.get('planProfile', ''),
    }
  }

  async save<K extends SettingKey>(key: K, value: EditableSettings[K]): Promise<void> {
    const target = TARGETS[key]
    if (target === 'workspace' && !this.config.hasWorkspace()) throw new Error(`"${key}" is a workspace setting; open a folder to change it.`)
    await this.config.update(key, cleaned(value), target)
  }

  /** Saves the profile at `index`, or adds it at the end; a rename follows into the defaults that named it. */
  async saveProfile(index: number, profile: ModelProfile): Promise<void> {
    const profiles = this.profiles()
    if (index < 0 || index > profiles.length) throw new Error(`No profile at position ${index}.`)
    const saved = validProfile(profile)
    const taken = profiles.some((p, i) => i !== index && p.name === saved.name)
    if (taken) throw new Error(`A profile named "${saved.name}" already exists.`)
    const previous = profiles[index]
    await this.config.update('profiles', [...profiles.slice(0, index), saved, ...profiles.slice(index + 1)], TARGETS.profiles)
    if (previous && previous.name !== saved.name) await this.rename(previous.name, saved.name)
  }

  async removeProfile(index: number): Promise<void> {
    const profiles = this.profiles()
    const profile = profiles[index]
    if (!profile) throw new Error(`No profile at position ${index}.`)
    const roles = [
      ...(this.config.get('activeProfile', '') === profile.name ? ['the model'] : []),
      ...(this.config.get('planProfile', '') === profile.name ? ['the plan model'] : []),
    ]
    if (roles.length > 0) throw new Error(`"${profile.name}" is ${roles.join(' and ')} new sessions run on; pick another first.`)
    await this.config.update('profiles', profiles.filter((_, i) => i !== index), TARGETS.profiles)
  }

  async setApiKey(name: string, value: string): Promise<void> {
    if (!name.trim()) throw new Error('An API key needs the name a profile stores it under.')
    await this.secrets.store(name, value)
  }

  private profiles(): ModelProfile[] {
    return this.config.get<ModelProfile[]>('profiles', [])
  }

  private async rename(from: string, to: string): Promise<void> {
    for (const key of ['activeProfile', 'planProfile'] as const) {
      if (this.config.get(key, '') === from) await this.config.update(key, to, TARGETS[key])
    }
  }
}

/** A list row left empty is a row, not a rule. */
function cleaned<V>(value: V): V {
  if (!Array.isArray(value)) return value
  return value.filter((item) => (typeof item === 'string' ? item.trim() !== '' : isRule(item))).map((item) => (typeof item === 'string' ? item.trim() : item)) as V
}

const isRule = (item: unknown): item is VerifyRule =>
  typeof item === 'object' && item !== null && typeof (item as VerifyRule).match === 'string' && (item as VerifyRule).match.trim() !== '' && typeof (item as VerifyRule).command === 'string' && (item as VerifyRule).command.trim() !== ''

function validProfile(profile: ModelProfile): ModelProfile {
  const name = profile.name.trim()
  const model = profile.model.trim()
  if (!name) throw new Error('A profile needs a name.')
  if (!model) throw new Error(`Profile "${name}" needs a model.`)
  const base: ModelProfile = { name, engine: profile.engine, model, ...(profile.effort ? { effort: profile.effort } : {}) }
  if (profile.engine === 'claude-sdk') return base
  const baseUrl = profile.baseUrl?.trim()
  const apiKeySecret = profile.apiKeySecret?.trim()
  if (!baseUrl) throw new Error(`Profile "${name}" needs a base URL.`)
  if (!apiKeySecret) throw new Error(`Profile "${name}" needs an API key name.`)
  const systemPromptFile = profile.systemPromptFile?.trim()
  return { ...base, baseUrl, apiKeySecret, ...(systemPromptFile ? { systemPromptFile } : {}) }
}
