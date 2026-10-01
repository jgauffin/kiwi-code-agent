import { DEFAULT_TEST_GLOBS, type Limits } from '../agent/cleanup/oversized'
import type { AppliedBundle, Bundle, BundleScope } from '../agent/instructions/bundles'
import type { MemoryEntry, MemoryScope } from '../agent/memory/memories'
import { type ModelChoice, type Profile, type Provider, type StepChoice } from '../agent/session/model-profile'
import { STEPS } from '../agent/session/session-manager'
import type { VerifyRule } from '../agent/phases/verification'
import { DEFAULT_COMPACT_AT_TOKENS } from '../agent/session/compaction-point'
import { migrateModelSettings, needsMigration, type LegacyProfile, type ModelSettings } from './model-settings'
import type { EditableSettings, SettingKey, SettingsSnapshot, SettingsTarget } from './protocol'

/** The `kiwiAgent` configuration section, keys relative to it. */
export type ConfigPort = {
  get<T>(key: string, fallback: T): T
  update(key: string, value: unknown, target: SettingsTarget): Promise<void>
  hasWorkspace(): boolean
}

/** Secret storage, keyed by an OpenAI-compatible provider's own name. */
export type SecretPort = {
  has(name: string): Promise<boolean>
  store(name: string, value: string): Promise<void>
  /** Carries a stored key from one name to another; a no-op if `from` holds nothing. */
  move(from: string, to: string): Promise<void>
  delete(name: string): Promise<void>
}

/** Where a provider's key lives in the editor's secret storage, under the provider's own name. */
export function secretKey(name: string): string {
  return `kiwiAgent.apiKey.${name}`
}

/** What a session runs on by default, as the new-session screen shows and sets it. */
export type ProfileDefaults = { names: string[]; active: string }

/** Memories, read and forgotten off the files they actually live in rather than `kiwiAgent` configuration. */
export type MemoryPort = {
  list(): Promise<{ project: MemoryEntry[]; user: MemoryEntry[] }>
  forget(scope: MemoryScope, title: string): Promise<void>
}

/** Bundles, read off the catalog and off the `AGENTS.md` files they are applied into, closed over this workspace. */
export type BundlePort = {
  /** Every bundle in the catalog, from every accepted source, for browsing. */
  available(): Promise<Bundle[]>
  /** The catalog narrowed to what this workspace holds, for the one-time offer. */
  matching(): Promise<Bundle[]>
  /** Every bundle applied, project scope and the person's own both. */
  applied(): Promise<AppliedBundle[]>
  apply(scope: BundleScope, bundle: Bundle): Promise<void>
  remove(scope: BundleScope, source: string, name: string): Promise<void>
}

/**
 * Where each setting is written: what the model runs on and how the host runs
 * it belong to the person; what the agent may do and how a project is checked
 * belong to the workspace.
 */
const TARGETS: Record<SettingKey | 'profiles' | 'providers', SettingsTarget> = {
  activeProfile: 'user',
  profiles: 'user',
  providers: 'user',
  nodePath: 'user',
  traceEngine: 'user',
  compactAtTokens: 'user',
  'permissions.allow': 'workspace',
  'permissions.deny': 'workspace',
  'permissions.denyGitWrites': 'workspace',
  verify: 'workspace',
  verifyFailureBudget: 'workspace',
  'cleanup.functionLines': 'workspace',
  'cleanup.typeLines': 'workspace',
  'cleanup.fileLines': 'workspace',
  'cleanup.tests': 'workspace',
  'cleanup.testFunctionLines': 'workspace',
  'cleanup.testTypeLines': 'workspace',
  'cleanup.testFileLines': 'workspace',
  'cleanup.ignore': 'workspace',
  planIgnore: 'workspace',
  cutCoveredDocs: 'workspace',
}

/**
 * Reads the model settings, migrating the one-model-per-profile shape on the
 * way. Shared with the session factory so a session and the settings page can
 * never disagree about what is configured.
 */
export function readModelSettings(config: ConfigPort): ModelSettings {
  const providers = config.get<Provider[]>('providers', [])
  const profiles = config.get<Profile[]>('profiles', [])
  const active = config.get('activeProfile', '')
  if (!needsMigration(providers)) return { providers, profiles, activeProfile: active }
  return migrateModelSettings(config.get<LegacyProfile[]>('profiles', []), active, config.get('planProfile', ''))
}

/** The cleanup's size limits, shared with the sweep so it and the settings page read the same defaults. */
export function readCleanupLimits(config: ConfigPort): Limits {
  return {
    source: {
      functionLines: config.get('cleanup.functionLines', 25),
      typeLines: config.get('cleanup.typeLines', 200),
      fileLines: config.get('cleanup.fileLines', 400),
    },
    tests: {
      functionLines: config.get('cleanup.testFunctionLines', 60),
      typeLines: config.get('cleanup.testTypeLines', 600),
      fileLines: config.get('cleanup.testFileLines', 1200),
    },
    testGlobs: config.get<string[]>('cleanup.tests', DEFAULT_TEST_GLOBS),
  }
}

export class SettingsStore {
  constructor(
    private readonly config: ConfigPort,
    private readonly secrets: SecretPort,
    private readonly memory: MemoryPort,
    private readonly bundles: BundlePort,
  ) {}

  async snapshot(): Promise<SettingsSnapshot> {
    const { providers, profiles, activeProfile } = this.models()
    const names = providers.map((p) => p.name)
    return {
      providers,
      profiles,
      activeProfile,
      keys: await Promise.all(names.map(async (name) => ({ name, stored: await this.secrets.has(name) }))),
      permissions: {
        allow: this.config.get<string[]>('permissions.allow', []),
        deny: this.config.get<string[]>('permissions.deny', []),
        denyGitWrites: this.config.get('permissions.denyGitWrites', false),
      },
      verify: this.config.get<VerifyRule[]>('verify', []),
      verifyFailureBudget: this.config.get('verifyFailureBudget', 3),
      cleanup: this.cleanup(),
      planIgnore: this.config.get<string[]>('planIgnore', []),
      cutCoveredDocs: this.config.get('cutCoveredDocs', false),
      memories: await this.memory.list(),
      bundles: await this.bundleSnapshot(),
      nodePath: this.config.get('nodePath', ''),
      traceEngine: this.config.get('traceEngine', false),
      compactAtTokens: this.config.get('compactAtTokens', DEFAULT_COMPACT_AT_TOKENS),
      hasWorkspace: this.config.hasWorkspace(),
    }
  }

  profileDefaults(): ProfileDefaults {
    const { profiles, activeProfile } = this.models()
    return { names: profiles.map((p) => p.name), active: activeProfile }
  }

  async save<K extends SettingKey>(key: K, value: EditableSettings[K]): Promise<void> {
    const target = TARGETS[key]
    if (target === 'workspace' && !this.config.hasWorkspace()) throw new Error(`"${key}" is a workspace setting; open a folder to change it.`)
    await this.config.update(key, cleaned(value), target)
  }

  /** Saves the provider at `index`, or adds it at the end; a rename follows into the profiles that chose it and carries its stored key along. */
  async saveProvider(index: number, provider: Provider): Promise<void> {
    const { providers } = this.models()
    if (index < 0 || index > providers.length) throw new Error(`No provider at position ${index}.`)
    const saved = validProvider(provider)
    if (providers.some((p, i) => i !== index && p.name === saved.name)) throw new Error(`A provider named "${saved.name}" already exists.`)
    const previous = providers[index]
    await this.write('providers', [...providers.slice(0, index), saved, ...providers.slice(index + 1)])
    if (previous && previous.name !== saved.name) {
      await this.renameProvider(previous.name, saved.name)
      await this.secrets.move(previous.name, saved.name)
    }
  }

  async removeProvider(index: number): Promise<void> {
    const { providers, profiles } = this.models()
    const provider = providers[index]
    if (!provider) throw new Error(`No provider at position ${index}.`)
    const users = profiles.filter((profile) => choices(profile).some((c) => c.provider === provider.name)).map((p) => p.name)
    if (users.length > 0) throw new Error(`"${provider.name}" is the provider for ${users.join(', ')}; point those profiles elsewhere first.`)
    await this.write('providers', providers.filter((_, i) => i !== index))
    await this.secrets.delete(provider.name)
  }

  /** Saves the profile at `index`, or adds it at the end; a rename follows into the default that named it. */
  async saveProfile(index: number, profile: Profile): Promise<void> {
    const { providers, profiles } = this.models()
    if (index < 0 || index > profiles.length) throw new Error(`No profile at position ${index}.`)
    const saved = validProfile(profile, providers)
    if (profiles.some((p, i) => i !== index && p.name === saved.name)) throw new Error(`A profile named "${saved.name}" already exists.`)
    const previous = profiles[index]
    await this.write('profiles', [...profiles.slice(0, index), saved, ...profiles.slice(index + 1)])
    // Nothing named the profile before it existed; the first one saved becomes what new sessions run on.
    if (!previous && profiles.length === 0) await this.write('activeProfile', saved.name)
    if (previous && previous.name !== saved.name && this.config.get('activeProfile', '') === previous.name) await this.write('activeProfile', saved.name)
  }

  async removeProfile(index: number): Promise<void> {
    const { profiles, activeProfile } = this.models()
    const profile = profiles[index]
    if (!profile) throw new Error(`No profile at position ${index}.`)
    if (activeProfile === profile.name) throw new Error(`"${profile.name}" is what new sessions run on; pick another first.`)
    await this.write('profiles', profiles.filter((_, i) => i !== index))
  }

  async setApiKey(name: string, value: string): Promise<void> {
    if (!name.trim()) throw new Error('An API key needs the provider it belongs to.')
    // Empty means no key: a Claude provider then runs on the editor's login again.
    await (value === '' ? this.secrets.delete(name) : this.secrets.store(name, value))
  }

  async forgetMemory(scope: MemoryScope, title: string): Promise<void> {
    await this.memory.forget(scope, title)
  }

  private models(): ModelSettings {
    return readModelSettings(this.config)
  }

  private cleanup(): SettingsSnapshot['cleanup'] {
    const { source, tests, testGlobs } = readCleanupLimits(this.config)
    return {
      ...source,
      tests: testGlobs,
      testFunctionLines: tests.functionLines,
      testTypeLines: tests.typeLines,
      testFileLines: tests.fileLines,
      ignore: this.config.get<string[]>('cleanup.ignore', []),
    }
  }

  /**
   * Writes a model setting, and the migrated shape with it: a page that saves
   * one provider must not leave the rest to be migrated again from keys the
   * next save would contradict.
   */
  private async write(key: 'providers' | 'profiles' | 'activeProfile', value: unknown): Promise<void> {
    const migrated = this.models()
    if (needsMigration(this.config.get<Provider[]>('providers', []))) {
      await this.config.update('providers', migrated.providers, TARGETS.providers)
      await this.config.update('profiles', migrated.profiles, TARGETS.profiles)
      await this.config.update('activeProfile', migrated.activeProfile, TARGETS.activeProfile)
    }
    await this.config.update(key, value, TARGETS[key])
  }

  private async renameProvider(from: string, to: string): Promise<void> {
    const { profiles } = this.models()
    const renamed = profiles.map((profile) => ({
      ...profile,
      default: profile.default.provider === from ? { ...profile.default, provider: to } : profile.default,
      ...(profile.steps
        ? { steps: Object.fromEntries(Object.entries(profile.steps).map(([step, c]) => [step, c.provider === from ? { ...c, provider: to } : c])) }
        : {}),
    }))
    await this.write('profiles', renamed)
  }
}

/** Every model choice a profile makes: its default and any step that overrides it. */
const choices = (profile: Profile): StepChoice[] => [profile.default, ...Object.values(profile.steps ?? {})]

/** A list row left empty is a row, not a rule. */
function cleaned<V>(value: V): V {
  if (!Array.isArray(value)) return value
  return value.filter((item) => (typeof item === 'string' ? item.trim() !== '' : isRule(item))).map((item) => (typeof item === 'string' ? item.trim() : item)) as V
}

const isRule = (item: unknown): item is VerifyRule =>
  typeof item === 'object' && item !== null && typeof (item as VerifyRule).match === 'string' && (item as VerifyRule).match.trim() !== '' && typeof (item as VerifyRule).command === 'string' && (item as VerifyRule).command.trim() !== ''

function validProvider(provider: Provider): Provider {
  const name = provider.name.trim()
  if (!name) throw new Error('A provider needs a name.')
  const models = [...new Set(provider.models.map((m) => m.trim()).filter((m) => m !== ''))]
  // A limit for a model the provider no longer lists, or one that is no size, would only linger unseen.
  const limits = Object.entries(provider.compactAtTokens ?? {}).filter(([model, tokens]) => models.includes(model) && Number.isInteger(tokens) && tokens >= 0)
  const base: Provider = { name, engine: provider.engine, models, ...(limits.length > 0 ? { compactAtTokens: Object.fromEntries(limits) } : {}) }
  if (provider.engine === 'claude-sdk') return base
  const baseUrl = provider.baseUrl?.trim()
  if (!baseUrl) throw new Error(`Provider "${name}" needs a base URL.`)
  return { ...base, baseUrl, ...(provider.reasoningControl ? { reasoningControl: provider.reasoningControl } : {}) }
}

function validProfile(profile: Profile, providers: Provider[]): Profile {
  const name = profile.name.trim()
  if (!name) throw new Error('A profile needs a name.')
  const fallback = validChoice(profile.name, 'every step', profile.default, providers)
  const overrides = STEPS.map(({ step }) => [step, profile.steps?.[step]] as const)
    .filter(([, choice]) => choice !== undefined)
    .map(([step, choice]) => [step, validStepChoice(profile.name, stepLabel(step), choice!, fallback, providers)] as const)
    .filter(([, choice]) => Object.keys(choice).length > 0)
  return { name, default: fallback, ...(overrides.length > 0 ? { steps: Object.fromEntries(overrides) } : {}) }
}

/**
 * A step's own model is kept only where it differs from the default's, since
 * one that matches would drift the moment the default moves. Its effort is
 * kept either way: without it the step runs the effort suggested for it.
 */
function validStepChoice(profile: string, where: string, choice: StepChoice, fallback: ModelChoice, providers: Provider[]): StepChoice {
  const effort = choice.effort ? { effort: choice.effort } : {}
  if (!choice.provider?.trim() && !choice.model?.trim()) return effort
  const own = validChoice(profile, where, { provider: choice.provider ?? '', model: choice.model ?? '', ...(choice.systemPromptFile ? { systemPromptFile: choice.systemPromptFile } : {}) }, providers)
  const sameModel = own.provider === fallback.provider && own.model === fallback.model && own.systemPromptFile === fallback.systemPromptFile
  return sameModel ? effort : { ...own, ...effort }
}

const stepLabel = (step: string): string => STEPS.find((s) => s.step === step)?.label ?? step

function validChoice(profile: string, where: string, choice: ModelChoice, providers: Provider[]): ModelChoice {
  const provider = choice.provider.trim()
  const model = choice.model.trim()
  if (!provider) throw new Error(`Profile "${profile}" needs a provider for ${where}.`)
  if (!model) throw new Error(`Profile "${profile}" needs a model for ${where}.`)
  if (!providers.some((p) => p.name === provider)) throw new Error(`Profile "${profile}" names provider "${provider}" for ${where}, which is not configured.`)
  const systemPromptFile = choice.systemPromptFile?.trim()
  return { provider, model, ...(choice.effort ? { effort: choice.effort } : {}), ...(systemPromptFile ? { systemPromptFile } : {}) }
}
