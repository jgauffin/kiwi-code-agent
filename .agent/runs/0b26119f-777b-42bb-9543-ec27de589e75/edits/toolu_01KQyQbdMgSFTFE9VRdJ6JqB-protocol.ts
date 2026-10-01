import type { MemoryEntry, MemoryScope } from '../agent/memory/memories'
import type { Profile, Provider } from '../agent/session/model-profile'
import type { VerifyRule } from '../agent/phases/verification'

/** Whether a key the providers name is in secret storage; the key itself never leaves the host. */
export type ApiKeyState = { name: string; stored: boolean }

/** Every setting the panel edits, as the host reads it. */
export type SettingsSnapshot = {
  providers: Provider[]
  profiles: Profile[]
  activeProfile: string
  keys: ApiKeyState[]
  permissions: { allow: string[]; deny: string[]; denyGitWrites: boolean }
  verify: VerifyRule[]
  verifyFailureBudget: number
  cleanup: {
    functionLines: number
    typeLines: number
    fileLines: number
    tests: string[]
    testFunctionLines: number
    testTypeLines: number
    testFileLines: number
    ignore: string[]
  }
  planIgnore: string[]
  cutCoveredDocs: boolean
  /** Every memory kept, for this project and for the person, each already named by its own scope. */
  memories: { project: MemoryEntry[]; user: MemoryEntry[] }
  nodePath: string
  traceEngine: boolean
  /** The conversation size at which a session compacts, when that comes before the window runs short; 0 for none. */
  compactAtTokens: number
  /** Workspace-scoped settings need a folder open to be written. */
  hasWorkspace: boolean
}

/** The settings saved one at a time, by their `kiwiAgent.` key; providers and profiles have their own messages. */
export type EditableSettings = {
  activeProfile: string
  nodePath: string
  traceEngine: boolean
  compactAtTokens: number
  'permissions.allow': string[]
  'permissions.deny': string[]
  'permissions.denyGitWrites': boolean
  verify: VerifyRule[]
  verifyFailureBudget: number
  'cleanup.functionLines': number
  'cleanup.typeLines': number
  'cleanup.fileLines': number
  'cleanup.tests': string[]
  'cleanup.testFunctionLines': number
  'cleanup.testTypeLines': number
  'cleanup.testFileLines': number
  'cleanup.ignore': string[]
  planIgnore: string[]
  cutCoveredDocs: boolean
}

export type SettingKey = keyof EditableSettings

export type SettingsTarget = 'user' | 'workspace'

export type SaveSetting = { [K in SettingKey]: { type: 'save'; key: K; value: EditableSettings[K] } }[SettingKey]

export type ToSettingsWebview =
  | { type: 'settings'; snapshot: SettingsSnapshot }
  /**
   * What a provider says it serves. Sent on its own rather than in the
   * snapshot: the panel re-sends the snapshot after every message, and an
   * offer the user has not accepted yet must survive that.
   */
  | { type: 'models'; provider: string; models: string[] }

export type FromSettingsWebview =
  | { type: 'ready' }
  | SaveSetting
  /** `index` at the end of the list adds the provider. */
  | { type: 'save_provider'; index: number; provider: Provider }
  | { type: 'remove_provider'; index: number }
  /**
   * Asks what an OpenAI-compatible endpoint serves, off the form as typed
   * rather than what was last saved; answered with a `models` message.
   * `apiKeyValue` empty falls back to what is already stored under `name`.
   */
  | { type: 'refresh_models'; name: string; baseUrl: string; apiKeyValue: string }
  /** `index` at the end of the list adds the profile. */
  | { type: 'save_profile'; index: number; profile: Profile }
  | { type: 'remove_profile'; index: number }
  | { type: 'set_api_key'; name: string; value: string }
  /** Opens the settings.json behind a tab, for what the panel does not edit. */
  | { type: 'open_settings_file'; target: SettingsTarget }
