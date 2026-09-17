import type { ModelProfile } from '../../agent/session/model-profile'
import type { EditableSettings, SettingKey, SettingsTarget } from '../protocol'

export type SettingsTab = 'models' | 'permissions' | 'project' | 'advanced'

export class SettingsTabSelectedEvent extends Event {
  static readonly type = 'settings-tab-selected'
  constructor(public readonly tab: SettingsTab) {
    super(SettingsTabSelectedEvent.type, { bubbles: true })
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
    public readonly profile: ModelProfile,
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

declare global {
  interface HTMLElementEventMap {
    [SettingsTabSelectedEvent.type]: SettingsTabSelectedEvent
    [SettingSavedEvent.type]: SettingSavedEvent
    [ProfileSavedEvent.type]: ProfileSavedEvent
    [ProfileRemovedEvent.type]: ProfileRemovedEvent
    [ApiKeySetEvent.type]: ApiKeySetEvent
    [RuleListChangedEvent.type]: RuleListChangedEvent
    [SettingsFileRequestedEvent.type]: SettingsFileRequestedEvent
  }
}
