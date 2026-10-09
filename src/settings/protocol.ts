import type { AppliedBundle, Bundle, BundleScope } from '../agent/instructions/bundles'
import type { MemoryEntry, MemoryScope } from '../agent/memory/memories'
import type { Profile, Provider } from '../agent/session/model-profile'
import type { ModelMove } from './model-upgrade'
import type { VerifyRule } from '../agent/phases/verification'
import type { PairedPhone } from '../remote-control/pairing'
import type { Grant } from '../agent/permissions/grants'

/** Whether a key the providers name is in secret storage; the key itself never leaves the host. */
export type ApiKeyState = { name: string; stored: boolean }

/** Where the research sub agent's search provider key is stored, and shown, under: the same name wherever it is read, written or displayed. */
export const SEARCH_PROVIDER_SECRET_NAME = 'Brave Search'

/** Every setting the panel edits, as the host reads it. */
export type SettingsSnapshot = {
  providers: Provider[]
  profiles: Profile[]
  activeProfile: string
  keys: ApiKeyState[]
  /** The answers kept for this workspace and for the person, each read as the sentence it was kept as. */
  permissions: { workspace: Grant[]; person: Grant[]; denyGitWrites: boolean }
  verify: VerifyRule[]
  verifyFailureBudget: number
  cleanup: {
    functionLines: number
    functionComplexity: number
    typeLines: number
    fileLines: number
    tests: string[]
    testFunctionLines: number
    testFunctionComplexity: number
    testTypeLines: number
    testFileLines: number
    ignore: string[]
  }
  planIgnore: string[]
  cutCoveredDocs: boolean
  /** Every memory kept, for this project and for the person, each already named by its own scope. */
  memories: { project: MemoryEntry[]; user: MemoryEntry[] }
  bundles: {
    /** Every bundle in the catalog, for browsing and applying at any time. */
    available: Bundle[]
    /** Every bundle applied, project scope and the person's own both. */
    applied: AppliedBundle[]
    /** The catalog narrowed to what this workspace holds, for the one-time offer. */
    suggested: Bundle[]
    /** Whether the suggestion is still due: no bundle applied yet, something to suggest, and not dismissed. */
    offerPending: boolean
  }
  nodePath: string
  /** The Claude Code found on this machine, by path, or absent when it has none: what decides whether the installed-Claude engine is offered at all. */
  installedClaude?: string
  /** The newer models on offer, absent when there are none to offer or the person turned the offer down. */
  modelUpgrade?: { provider: string; providerIsNew: boolean; moves: ModelMove[] }
  traceEngine: boolean
  /** The conversation size at which a session compacts, when that comes before the window runs short; 0 for none. */
  compactAtTokens: number
  /** Workspace-scoped settings need a folder open to be written. */
  hasWorkspace: boolean
  remoteControl: {
    enabled: boolean
    serviceUrl: string
    /** Whether a session started at the desk may push until the person sets it for that session; one started from the phone pushes regardless. */
    pushByDefault: boolean
    /** Every phone paired with this workspace, by the name it gave and when it last connected. */
    phones: PairedPhone[]
  }
}

/** The settings saved one at a time, by their `kiwiAgent.` key; providers and profiles have their own messages. */
export type EditableSettings = {
  activeProfile: string
  nodePath: string
  traceEngine: boolean
  compactAtTokens: number
  'permissions.grants': Grant[]
  'permissions.denyGitWrites': boolean
  verify: VerifyRule[]
  verifyFailureBudget: number
  'cleanup.functionComplexity': number
  'cleanup.functionLines': number
  'cleanup.typeLines': number
  'cleanup.fileLines': number
  'cleanup.tests': string[]
  'cleanup.testFunctionComplexity': number
  'cleanup.testFunctionLines': number
  'cleanup.testTypeLines': number
  'cleanup.testFileLines': number
  'cleanup.ignore': string[]
  planIgnore: string[]
  cutCoveredDocs: boolean
  'remoteControl.enabled': boolean
  'remoteControl.serviceUrl': string
  'remoteControl.pushByDefault': boolean
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
  /** Answers `request_pairing_code`: the code the agent just produced, as text and as a QR code carrying it. */
  | { type: 'pairing_code'; code: string; qrDataUrl: string; expiresAt: number }

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
  /** Opens a memory's own file, to change it by hand. */
  | { type: 'open_memory'; scope: MemoryScope; file: string }
  /** The note and its index line go for a project memory; the matching bullet goes for a user one. */
  | { type: 'forget_memory'; scope: MemoryScope; title: string }
  /** Applies a catalog bundle in the chosen scope; the bundle travels with the message rather than naming it by an index into a catalog the host might answer differently by the time this arrives. */
  | { type: 'apply_bundle'; scope: BundleScope; bundle: Bundle }
  | { type: 'remove_bundle'; scope: BundleScope; source: string; name: string }
  /** Ends the one-time suggestion for this workspace without applying anything. */
  | { type: 'dismiss_bundle_offer' }
  /** Takes the newer models: adds the provider on the installed engine and points the profiles at it. */
  | { type: 'upgrade_models' }
  /** Turns the newer-models offer down for good. */
  | { type: 'dismiss_model_upgrade' }
  /** "Pair a phone": produces a fresh code, answered with a `pairing_code` message. */
  | { type: 'request_pairing_code' }
  /** "Unpair" on a paired phone's row. */
  | { type: 'unpair_phone'; id: string }
  /** Replaces the answers the person keeps for themselves, honoured in every workspace. */
  | { type: 'save_person_grants'; grants: Grant[] }
