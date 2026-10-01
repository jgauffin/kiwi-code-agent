import type { MemoryScope } from '../../agent/memory/memories'
import type { Profile, Provider } from '../../agent/session/model-profile'
import type { EditableSettings, SettingKey, SettingsTarget } from '../protocol'

export type SettingsTab = 'models' | 'permissions' | 'project' | 'memories' | 'advanced'

export class SettingsTabSelectedEvent extends Event {
  static readonly type = 'settings-tab-selected'
  constructor(public readonly tab: SettingsTab) {
    super(SettingsTabSelectedEvent.type, { bubbles: true })
  }
}

/** Within the Models tab: the catalog (Providers) or what a session runs on (Profiles). */
export type ModelsSubTab = 'providers' | 'profiles'

export class ModelsSubTabSelectedEvent extends Event {
  static readonly type = 'models-subtab-selected'
  constructor(public readonly tab: ModelsSubTab) {
    super(ModelsSubTabSelectedEvent.type, { bubbles: true })
  }
}

/** A field changed: the setting it edits, with the whole value the host should now hold. */
export class SettingSavedEvent<K extends SettingKey = SettingKey> extends Event {
  static readonly type = 'setting-saved'
  constructor(
    public readonly key: K,
    public readonly value: EditableSettings[K],
  ) {
    super(SettingSavedEvent.type, { bubbles: true })
  }
}

/** A profile card's form submitted; `index` at the end of the list adds one. */
export class ProfileSavedEvent extends Event {
  static readonly type = 'profile-saved'
  constructor(
    public readonly index: number,
    public readonly profile: Profile,
  ) {
    super(ProfileSavedEvent.type, { bubbles: true })
  }
}

export class ProfileRemovedEvent extends Event {
  static readonly type = 'profile-removed'
  constructor(public readonly index: number) {
    super(ProfileRemovedEvent.type, { bubbles: true })
  }
}

/** A provider card's form submitted; `index` at the end of the list adds one. */
export class ProviderSavedEvent extends Event {
  static readonly type = 'provider-saved'
  constructor(
    public readonly index: number,
    public readonly provider: Provider,
  ) {
    super(ProviderSavedEvent.type, { bubbles: true })
  }
}

export class ProviderRemovedEvent extends Event {
  static readonly type = 'provider-removed'
  constructor(public readonly index: number) {
    super(ProviderRemovedEvent.type, { bubbles: true })
  }
}

/** "Refresh" on a provider's form: ask the host what its endpoint serves, off the fields as typed. */
export class ModelsRefreshRequestedEvent extends Event {
  static readonly type = 'models-refresh-requested'
  constructor(
    public readonly name: string,
    public readonly baseUrl: string,
    public readonly apiKeyValue: string,
  ) {
    super(ModelsRefreshRequestedEvent.type, { bubbles: true })
  }
}

export class ApiKeySetEvent extends Event {
  static readonly type = 'api-key-set'
  constructor(
    public readonly name: string,
    public readonly value: string,
  ) {
    super(ApiKeySetEvent.type, { bubbles: true })
  }
}

/** The values of a rule list after an edit, empty rows left out. */
export class RuleListChangedEvent extends Event {
  static readonly type = 'rule-list-changed'
  constructor(public readonly values: string[]) {
    super(RuleListChangedEvent.type, { bubbles: true })
  }
}

export class SettingsFileRequestedEvent extends Event {
  static readonly type = 'settings-file-requested'
  constructor(public readonly scope: SettingsTarget) {
    super(SettingsFileRequestedEvent.type, { bubbles: true })
  }
}

/** "Open" on a memory: its own file, to change it by hand. */
export class MemoryOpenedEvent extends Event {
  static readonly type = 'memory-opened'
  constructor(
    public readonly scope: MemoryScope,
    public readonly file: string,
  ) {
    super(MemoryOpenedEvent.type, { bubbles: true })
  }
}

/** "Forget" on a memory: it and its index line go, in its own scope. */
export class MemoryForgottenEvent extends Event {
  static readonly type = 'memory-forgotten'
  constructor(
    public readonly scope: MemoryScope,
    public readonly title: string,
  ) {
    super(MemoryForgottenEvent.type, { bubbles: true })
  }
}

declare global {
  interface HTMLElementEventMap {
    [SettingsTabSelectedEvent.type]: SettingsTabSelectedEvent
    [ModelsSubTabSelectedEvent.type]: ModelsSubTabSelectedEvent
    [SettingSavedEvent.type]: SettingSavedEvent
    [ProfileSavedEvent.type]: ProfileSavedEvent
    [ProfileRemovedEvent.type]: ProfileRemovedEvent
    [ProviderSavedEvent.type]: ProviderSavedEvent
    [ProviderRemovedEvent.type]: ProviderRemovedEvent
    [ModelsRefreshRequestedEvent.type]: ModelsRefreshRequestedEvent
    [ApiKeySetEvent.type]: ApiKeySetEvent
    [RuleListChangedEvent.type]: RuleListChangedEvent
    [SettingsFileRequestedEvent.type]: SettingsFileRequestedEvent
    [MemoryOpenedEvent.type]: MemoryOpenedEvent
    [MemoryForgottenEvent.type]: MemoryForgottenEvent
  }
}
