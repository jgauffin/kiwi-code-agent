import type { PermissionDecision } from '../../agent/session/code-session'

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
  constructor(public readonly profileName: string) {
    super(NewSessionRequestedEvent.type, { bubbles: true })
  }
}

export class SessionSelectedEvent extends Event {
  static readonly type = 'session-selected'
  constructor(public readonly sessionId: string) {
    super(SessionSelectedEvent.type, { bubbles: true })
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
    [SessionSelectedEvent.type]: SessionSelectedEvent
    [SessionRemovedEvent.type]: SessionRemovedEvent
  }
}
