import type { PermissionDecision } from '../../agent/session/code-session'
import type { SessionMode } from '../../agent/session/session-manager'

export class PromptSubmittedEvent extends Event {
  static readonly type = 'prompt-submitted'
  constructor(public readonly text: string) {
    super(PromptSubmittedEvent.type, { bubbles: true })
  }
}

export class InterruptRequestedEvent extends Event {
  static readonly type = 'interrupt-requested'
  constructor() {
    super(InterruptRequestedEvent.type, { bubbles: true })
  }
}

export class PermissionDecidedEvent extends Event {
  static readonly type = 'permission-decided'
  constructor(
    public readonly requestId: string,
    public readonly decision: PermissionDecision,
  ) {
    super(PermissionDecidedEvent.type, { bubbles: true })
  }
}

export class NewSessionRequestedEvent extends Event {
  static readonly type = 'new-session-requested'
  constructor(
    public readonly mode: SessionMode,
    public readonly feature: string | undefined,
    public readonly prompt: string | undefined,
  ) {
    super(NewSessionRequestedEvent.type, { bubbles: true })
  }
}

/** The "+" tab: show the new-session screen. */
export class NewSessionViewRequestedEvent extends Event {
  static readonly type = 'new-session-view-requested'
  constructor() {
    super(NewSessionViewRequestedEvent.type, { bubbles: true })
  }
}

export class SpecApprovedEvent extends Event {
  static readonly type = 'spec-approved'
  constructor() {
    super(SpecApprovedEvent.type, { bubbles: true })
  }
}

export class SpecOpenRequestedEvent extends Event {
  static readonly type = 'spec-open-requested'
  constructor() {
    super(SpecOpenRequestedEvent.type, { bubbles: true })
  }
}

export class SessionClosedEvent extends Event {
  static readonly type = 'session-closed'
  constructor(public readonly sessionId: string) {
    super(SessionClosedEvent.type, { bubbles: true })
  }
}

export class SessionSelectedEvent extends Event {
  static readonly type = 'session-selected'
  constructor(public readonly sessionId: string) {
    super(SessionSelectedEvent.type, { bubbles: true })
  }
}

export class VerifyToggledEvent extends Event {
  static readonly type = 'verify-toggled'
  constructor(public readonly enabled: boolean) {
    super(VerifyToggledEvent.type, { bubbles: true })
  }
}

export class SessionRemovedEvent extends Event {
  static readonly type = 'session-removed'
  constructor(public readonly sessionId: string) {
    super(SessionRemovedEvent.type, { bubbles: true })
  }
}

declare global {
  interface HTMLElementEventMap {
    [PromptSubmittedEvent.type]: PromptSubmittedEvent
    [InterruptRequestedEvent.type]: InterruptRequestedEvent
    [PermissionDecidedEvent.type]: PermissionDecidedEvent
    [NewSessionRequestedEvent.type]: NewSessionRequestedEvent
    [NewSessionViewRequestedEvent.type]: NewSessionViewRequestedEvent
    [SessionSelectedEvent.type]: SessionSelectedEvent
    [SessionClosedEvent.type]: SessionClosedEvent
    [SpecApprovedEvent.type]: SpecApprovedEvent
    [SpecOpenRequestedEvent.type]: SpecOpenRequestedEvent
    [SessionRemovedEvent.type]: SessionRemovedEvent
    [VerifyToggledEvent.type]: VerifyToggledEvent
  }
}
