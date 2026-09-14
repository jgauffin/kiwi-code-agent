import type { SessionMode } from '../../agent/session/session-manager'
import type { ReviewAction, UserPermissionDecision } from '../protocol'

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
    public readonly decision: UserPermissionDecision,
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

/** The new-session screen's pick of a plan already on disk. */
export class PlanResumeRequestedEvent extends Event {
  static readonly type = 'plan-resume-requested'
  constructor(public readonly feature: string) {
    super(PlanResumeRequestedEvent.type, { bubbles: true })
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

/** The plan bar's "Map against code": start a mapping run on the spec. */
export class SpecMapRequestedEvent extends Event {
  static readonly type = 'spec-map-requested'
  constructor() {
    super(SpecMapRequestedEvent.type, { bubbles: true })
  }
}

/** The plan bar's stop on a running mapping. */
export class SpecMapStoppedEvent extends Event {
  static readonly type = 'spec-map-stopped'
  constructor() {
    super(SpecMapStoppedEvent.type, { bubbles: true })
  }
}

/** The plan bar's "Verify again": run the test commands over the tasks' files once more. */
export class VerifyRequestedEvent extends Event {
  static readonly type = 'verify-requested'
  constructor() {
    super(VerifyRequestedEvent.type, { bubbles: true })
  }
}

/** The plan bar's "Implement": start an implement session on the approved spec. */
export class ImplementRequestedEvent extends Event {
  static readonly type = 'implement-requested'
  constructor() {
    super(ImplementRequestedEvent.type, { bubbles: true })
  }
}

/** The plan bar's "Update intent": write the proposed amendments into `docs/`. */
export class IntentUpdateRequestedEvent extends Event {
  static readonly type = 'intent-update-requested'
  constructor() {
    super(IntentUpdateRequestedEvent.type, { bubbles: true })
  }
}

/** Any review gesture on the plan view, on its way to the extension host. */
export class ReviewActionEvent extends Event {
  static readonly type = 'review-action'
  constructor(public readonly action: ReviewAction) {
    super(ReviewActionEvent.type, { bubbles: true })
  }
}

export type PlanView = 'plan' | 'chat'

/** The plan bar's Plan / Chat switch. */
export class PlanViewSelectedEvent extends Event {
  static readonly type = 'plan-view-selected'
  constructor(public readonly view: PlanView) {
    super(PlanViewSelectedEvent.type, { bubbles: true })
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

export class AllowWritesToggledEvent extends Event {
  static readonly type = 'allow-writes-toggled'
  constructor(public readonly enabled: boolean) {
    super(AllowWritesToggledEvent.type, { bubbles: true })
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
    [PlanResumeRequestedEvent.type]: PlanResumeRequestedEvent
    [SessionSelectedEvent.type]: SessionSelectedEvent
    [SessionClosedEvent.type]: SessionClosedEvent
    [SpecApprovedEvent.type]: SpecApprovedEvent
    [SpecMapRequestedEvent.type]: SpecMapRequestedEvent
    [SpecMapStoppedEvent.type]: SpecMapStoppedEvent
    [VerifyRequestedEvent.type]: VerifyRequestedEvent
    [ImplementRequestedEvent.type]: ImplementRequestedEvent
    [IntentUpdateRequestedEvent.type]: IntentUpdateRequestedEvent
    [PlanViewSelectedEvent.type]: PlanViewSelectedEvent
    [ReviewActionEvent.type]: ReviewActionEvent
    [SessionRemovedEvent.type]: SessionRemovedEvent
    [AllowWritesToggledEvent.type]: AllowWritesToggledEvent
  }
}
