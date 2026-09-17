import type { ModelProfile } from '../agent/session/model-profile'
import type { VerifyRule } from '../agent/phases/verification'

/** Whether a key the profiles name is in secret storage; the key itself never leaves the host. */
export type ApiKeyState = { name: string; stored: boolean }

/** Every setting the panel edits, as the host reads it. */
export type SettingsSnapshot = {
  profiles: ModelProfile[]
  activeProfile: string
  planProfile: string
  keys: ApiKeyState[]
  permissions: { allow: string[]; deny: string[] }
  verify: VerifyRule[]
  verifyFailureBudget: number
  cleanup: { functionLines: number; typeLines: number; fileLines: number; ignore: string[] }
  planIgnore: string[]
  nodePath: string
  traceEngine: boolean
  /** Workspace-scoped settings need a folder open to be written. */
  hasWorkspace: boolean
}

/** The settings saved one at a time, by their `kiwiAgent.` key; profiles have their own messages. */
export type EditableSettings = {
  activeProfile: string
  planProfile: string
  nodePath: string
  traceEngine: boolean
  'permissions.allow': string[]
  'permissions.deny': string[]
  verify: VerifyRule[]
  verifyFailureBudget: number
  'cleanup.functionLines': number
  'cleanup.typeLines': number
  'cleanup.fileLines': number
  'cleanup.ignore': string[]
  planIgnore: string[]
}

export type SettingKey = keyof EditableSettings

export type SettingsTarget = 'user' | 'workspace'

export type SaveSetting = { [K in SettingKey]: { type: 'save'; key: K; value: EditableSettings[K] } }[SettingKey]

export type ToSettingsWebview = { type: 'settings'; snapshot: SettingsSnapshot }

export type FromSettingsWebview =
  | { type: 'ready' }
  | SaveSetting
  /** `index` at the end of the list adds the profile. */
  | { type: 'save_profile'; index: number; profile: ModelProfile }
  | { type: 'remove_profile'; index: number }
  | { type: 'set_api_key'; name: string; value: string }
  /** Opens the settings.json behind a tab, for what the panel does not edit. */
  | { type: 'open_settings_file'; target: SettingsTarget }
