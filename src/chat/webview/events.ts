import type { SessionMode } from '../../agent/session/session-manager'
import type { QuestionOutcome } from '../../agent/session/user-question'
import type { BundleScope } from '../../agent/instructions/bundles'
import type { AgentsMdAnswer, ReviewAction, UserPermissionDecision } from '../protocol'
import type { Step, ViewTab } from './plan-step'

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

export class CompactRequestedEvent extends Event {
  static readonly type = 'compact-requested'
  constructor() {
    super(CompactRequestedEvent.type, { bubbles: true })
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
    /** Files linked on the card; the first prompt tells the session to read them. */
    public readonly files: string[] = [],
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

/** Open a tab of the plan view, or the chat, and land somewhere on it: the bar's next-step link, or a link from one tab to a rule on another. */
export class PlanFocusRequestedEvent extends Event {
  static readonly type = 'plan-focus-requested'
  constructor(
    public readonly tab: ViewTab,
    public readonly where: PlanFocus = {},
  ) {
    super(PlanFocusRequestedEvent.type, { bubbles: true })
  }
}

/** The plan bar's "Check again": check the approved spec against the code after a check failed or was stopped. */
export class SpecCheckRequestedEvent extends Event {
  static readonly type = 'spec-check-requested'
  constructor() {
    super(SpecCheckRequestedEvent.type, { bubbles: true })
  }
}

/** The plan bar's stop on a running check. */
export class SpecCheckStoppedEvent extends Event {
  static readonly type = 'spec-check-stopped'
  constructor() {
    super(SpecCheckStoppedEvent.type, { bubbles: true })
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

/** What the user said about the units the size sweep found, on the Cleanup tab; a split names the files picked. */
export class CleanupDecidedEvent extends Event {
  static readonly type = 'cleanup-decided'
  constructor(
    public readonly decision: 'run' | 'postpone' | 'skip',
    public readonly paths?: string[],
  ) {
    super(CleanupDecidedEvent.type, { bubbles: true })
  }
}

/** The plan bar's "Check sizes": measure the feature's files against the limits again. */
export class SweepRequestedEvent extends Event {
  static readonly type = 'sweep-requested'
  constructor() {
    super(SweepRequestedEvent.type, { bubbles: true })
  }
}

/** The plan bar's "Implement": start an implement session on the approved spec. */
export class ImplementRequestedEvent extends Event {
  static readonly type = 'implement-requested'
  constructor() {
    super(ImplementRequestedEvent.type, { bubbles: true })
  }
}

/** A comment or ruling box closed: the text as written, or nothing when it was cancelled. */
export class EditorClosedEvent extends Event {
  static readonly type = 'editor-closed'
  constructor(public readonly text?: string) {
    super(EditorClosedEvent.type, { bubbles: true })
  }
}

/** Any review gesture on the plan view, on its way to the extension host. */
export class ReviewActionEvent extends Event {
  static readonly type = 'review-action'
  constructor(public readonly action: ReviewAction) {
    super(ReviewActionEvent.type, { bubbles: true })
  }
}

export type { ViewTab }

/** A tab picked on the strip. */
export class PlanViewSelectedEvent extends Event {
  static readonly type = 'plan-view-selected'
  constructor(public readonly view: ViewTab) {
    super(PlanViewSelectedEvent.type, { bubbles: true })
  }
}

/** Switch the view to a session it is not showing. */
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

/** The composer's model switch, on a chat session only: the model to run it on from now. */
export class SessionModelChangedEvent extends Event {
  static readonly type = 'session-model-changed'
  constructor(public readonly name: string) {
    super(SessionModelChangedEvent.type, { bubbles: true })
  }
}

/** The composer's "Approve plan", on a code plan only: the session goes on to build it with the full tool set. */
export class PlanApprovedEvent extends Event {
  static readonly type = 'plan-approved'
  constructor() {
    super(PlanApprovedEvent.type, { bubbles: true })
  }
}

/** The composer's reconnect on one of the active session's MCP servers. */
export class McpReconnectRequestedEvent extends Event {
  static readonly type = 'mcp-reconnect-requested'
  constructor(public readonly server: string) {
    super(McpReconnectRequestedEvent.type, { bubbles: true })
  }
}

/** The picker on the new-session screen: the profile new sessions run on from now. */
export class DefaultProfileChangedEvent extends Event {
  static readonly type = 'default-profile-changed'
  constructor(public readonly name: string) {
    super(DefaultProfileChangedEvent.type, { bubbles: true })
  }
}

/** A phase's chat now talks to another of its runs: the reader picked one, so the composer follows. */
export class ChatTargetChangedEvent extends Event {
  static readonly type = 'chat-target-changed'
  constructor() {
    super(ChatTargetChangedEvent.type, { bubbles: true })
  }
}

export class SessionRemovedEvent extends Event {
  static readonly type = 'session-removed'
  constructor(public readonly sessionId: string) {
    super(SessionRemovedEvent.type, { bubbles: true })
  }
}

/** The person's answer to the `AGENTS.md` offer shown over the chat. */
export class AgentsMdAnsweredEvent extends Event {
  static readonly type = 'agents-md-answered'
  constructor(
    public readonly scope: BundleScope,
    public readonly answer: AgentsMdAnswer,
  ) {
    super(AgentsMdAnsweredEvent.type, { bubbles: true })
  }
}

declare global {
  interface HTMLElementEventMap {
    [PromptSubmittedEvent.type]: PromptSubmittedEvent
    [LinkOpenFileRequestedEvent.type]: LinkOpenFileRequestedEvent
    [InterruptRequestedEvent.type]: InterruptRequestedEvent
    [CompactRequestedEvent.type]: CompactRequestedEvent
    [PermissionDecidedEvent.type]: PermissionDecidedEvent
    [QuestionAnsweredEvent.type]: QuestionAnsweredEvent
    [NewSessionRequestedEvent.type]: NewSessionRequestedEvent
    [PlanResumeRequestedEvent.type]: PlanResumeRequestedEvent
    [SessionSelectedEvent.type]: SessionSelectedEvent
    [SpecApprovedEvent.type]: SpecApprovedEvent
    [RulingsSentEvent.type]: RulingsSentEvent
    [ReviewSubmittedEvent.type]: ReviewSubmittedEvent
    [PlanStepSelectedEvent.type]: PlanStepSelectedEvent
    [PlanFocusRequestedEvent.type]: PlanFocusRequestedEvent
    [SpecCheckRequestedEvent.type]: SpecCheckRequestedEvent
    [SpecCheckStoppedEvent.type]: SpecCheckStoppedEvent
    [CleanupStoppedEvent.type]: CleanupStoppedEvent
    [CleanupDecidedEvent.type]: CleanupDecidedEvent
    [SweepRequestedEvent.type]: SweepRequestedEvent
    [SpecRepairRequestedEvent.type]: SpecRepairRequestedEvent
    [VerifyRequestedEvent.type]: VerifyRequestedEvent
    [ImplementRequestedEvent.type]: ImplementRequestedEvent
    [PlanViewSelectedEvent.type]: PlanViewSelectedEvent
    [ReviewActionEvent.type]: ReviewActionEvent
    [EditorClosedEvent.type]: EditorClosedEvent
    [SessionRemovedEvent.type]: SessionRemovedEvent
    [ChatTargetChangedEvent.type]: ChatTargetChangedEvent
    [AllowWritesToggledEvent.type]: AllowWritesToggledEvent
    [SessionModelChangedEvent.type]: SessionModelChangedEvent
    [PlanApprovedEvent.type]: PlanApprovedEvent
    [McpReconnectRequestedEvent.type]: McpReconnectRequestedEvent
    [DefaultProfileChangedEvent.type]: DefaultProfileChangedEvent
    [AgentsMdAnsweredEvent.type]: AgentsMdAnsweredEvent
  }
}
