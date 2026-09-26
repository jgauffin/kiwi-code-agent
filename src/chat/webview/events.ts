import type { SessionMode } from '../../agent/session/session-manager'
import type { QuestionOutcome } from '../../agent/session/user-question'
import type { ReviewAction, UserPermissionDecision } from '../protocol'
import type { Step, Tab } from './plan-step'

export class PromptSubmittedEvent extends Event {
  static readonly type = 'prompt-submitted'
  constructor(
    public readonly text: string,
    /** The files linked on the composer when it was sent; the prompt tells the agent to read them. */
    public readonly files: string[] = [],
  ) {
    super(PromptSubmittedEvent.type, { bubbles: true })
  }
}

/** The composer's "Link open file": link whatever the editor has open. */
export class LinkOpenFileRequestedEvent extends Event {
  static readonly type = 'link-open-file-requested'
  constructor() {
    super(LinkOpenFileRequestedEvent.type, { bubbles: true })
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

/** One question card's Submit: every question of that request, answered at once. */
export class QuestionAnsweredEvent extends Event {
  static readonly type = 'question-answered'
  constructor(
    public readonly requestId: string,
    public readonly outcome: QuestionOutcome,
  ) {
    super(QuestionAnsweredEvent.type, { bubbles: true })
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

/** The plan bar's "Send rulings": hand every pending ruling to the planner. */
export class RulingsSentEvent extends Event {
  static readonly type = 'rulings-sent'
  constructor() {
    super(RulingsSentEvent.type, { bubbles: true })
  }
}

/** The plan bar's "Submit review": hand the pending round to the planner. */
export class ReviewSubmittedEvent extends Event {
  static readonly type = 'review-submitted'
  constructor() {
    super(ReviewSubmittedEvent.type, { bubbles: true })
  }
}

/** A reached step clicked on the stepper: open the tab it works in. */
export class PlanStepSelectedEvent extends Event {
  static readonly type = 'plan-step-selected'
  constructor(public readonly step: Step) {
    super(PlanStepSelectedEvent.type, { bubbles: true })
  }
}

/** Where to land on a tab: the first row that needs an act, or the item named. */
export type PlanFocus = { scroll?: boolean; item?: string }

/** Open a tab of the plan view and land somewhere on it: the bar's next-step link, or a link from one tab to a rule on another. */
export class PlanFocusRequestedEvent extends Event {
  static readonly type = 'plan-focus-requested'
  constructor(
    public readonly tab: Tab,
    public readonly where: PlanFocus = {},
  ) {
    super(PlanFocusRequestedEvent.type, { bubbles: true })
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

/** The plan bar's stop on a running cleanup. */
export class CleanupStoppedEvent extends Event {
  static readonly type = 'cleanup-stopped'
  constructor() {
    super(CleanupStoppedEvent.type, { bubbles: true })
  }
}

/** The plan bar's "Repair": bring the plan files to the contract, by rule and through the planner. */
export class SpecRepairRequestedEvent extends Event {
  static readonly type = 'spec-repair-requested'
  constructor() {
    super(SpecRepairRequestedEvent.type, { bubbles: true })
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

/** Any review gesture on the plan view, on its way to the extension host. */
export class ReviewActionEvent extends Event {
  static readonly type = 'review-action'
  constructor(public readonly action: ReviewAction) {
    super(ReviewActionEvent.type, { bubbles: true })
  }
}

/** What the feature session shows: one tab of the plan, or the conversation. */
export type ViewTab = Tab | 'chat'

/** A tab picked on the strip. */
export class PlanViewSelectedEvent extends Event {
  static readonly type = 'plan-view-selected'
  constructor(public readonly view: ViewTab) {
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

/** The composer's reconnect on one of the active session's MCP servers. */
export class McpReconnectRequestedEvent extends Event {
  static readonly type = 'mcp-reconnect-requested'
  constructor(public readonly server: string) {
    super(McpReconnectRequestedEvent.type, { bubbles: true })
  }
}

/** A picker on the new-session screen: what new sessions of that kind run on from now. */
export class DefaultProfileChangedEvent extends Event {
  static readonly type = 'default-profile-changed'
  constructor(
    public readonly role: 'work' | 'plan',
    public readonly name: string,
  ) {
    super(DefaultProfileChangedEvent.type, { bubbles: true })
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
    [LinkOpenFileRequestedEvent.type]: LinkOpenFileRequestedEvent
    [InterruptRequestedEvent.type]: InterruptRequestedEvent
    [PermissionDecidedEvent.type]: PermissionDecidedEvent
    [QuestionAnsweredEvent.type]: QuestionAnsweredEvent
    [NewSessionRequestedEvent.type]: NewSessionRequestedEvent
    [NewSessionViewRequestedEvent.type]: NewSessionViewRequestedEvent
    [PlanResumeRequestedEvent.type]: PlanResumeRequestedEvent
    [SessionSelectedEvent.type]: SessionSelectedEvent
    [SessionClosedEvent.type]: SessionClosedEvent
    [SpecApprovedEvent.type]: SpecApprovedEvent
    [RulingsSentEvent.type]: RulingsSentEvent
    [ReviewSubmittedEvent.type]: ReviewSubmittedEvent
    [PlanStepSelectedEvent.type]: PlanStepSelectedEvent
    [PlanFocusRequestedEvent.type]: PlanFocusRequestedEvent
    [SpecMapRequestedEvent.type]: SpecMapRequestedEvent
    [SpecMapStoppedEvent.type]: SpecMapStoppedEvent
    [CleanupStoppedEvent.type]: CleanupStoppedEvent
    [SpecRepairRequestedEvent.type]: SpecRepairRequestedEvent
    [VerifyRequestedEvent.type]: VerifyRequestedEvent
    [ImplementRequestedEvent.type]: ImplementRequestedEvent
    [PlanViewSelectedEvent.type]: PlanViewSelectedEvent
    [ReviewActionEvent.type]: ReviewActionEvent
    [SessionRemovedEvent.type]: SessionRemovedEvent
    [AllowWritesToggledEvent.type]: AllowWritesToggledEvent
    [McpReconnectRequestedEvent.type]: McpReconnectRequestedEvent
    [DefaultProfileChangedEvent.type]: DefaultProfileChangedEvent
  }
}
