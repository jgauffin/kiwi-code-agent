import type { McpServerState, PermissionDecision, SessionEvent } from '../agent/session/code-session'
import type { QuestionOutcome } from '../agent/session/user-question'
import type { Decision } from '../agent/phases/decisions'
import type { CommentRef, Review } from '../agent/phases/plan-review'
import type { PlanStage } from '../agent/phases/plan-stage'
import type { Spec } from '../agent/phases/spec-model'
import type { Task, VerificationRecord } from '../agent/phases/tasks-file'
import type { SessionMode } from '../agent/session/session-manager'
import type { SessionStatus } from '../agent/session/session-status'
import type { ProfileDefaults } from '../settings/settings-store'

/** One tab: a session that is live, or the one being looked at. */
export type SessionTab = {
  id: string
  title: string
  mode: SessionMode
  profileName: string
  status: SessionStatus
  active: boolean
}

/** The active feature's plan: the plan bar and the plan view follow its stage. */
export type PlanState = {
  /** Workspace-relative path of the spec file. */
  specPath: string
  /** Workspace-relative path of the tasks file, whether or not it exists yet. */
  tasksPath: string
  /** Workspace-relative path of the decisions file, whether or not it exists yet. */
  decisionsPath: string
  /** Where the feature stands, derived from its files. */
  stage: PlanStage
  /** The spec's front-matter status; `missing` while no spec is written. */
  status: 'missing' | 'draft' | 'approved'
  /** Spec markdown without its front matter; absent while no spec is written. */
  body?: string
  /** The spec as the contract reads it; absent while no spec is written. */
  spec?: Spec
  /** The board predates the spec as it stands; it is re-mapped when the plan session's turn ends. */
  stale: boolean
  /** The spec is off contract and can be repaired: a plan session is active to do it. */
  repairable: boolean
  /** Mapping can be started from here: a plan session with a draft spec nobody has commented on, and no run live. */
  mappable: boolean
  /** The mapping run under this plan session: what it is doing, or how the last one ended. Absent before the first. */
  mapping?: RunState
  /** Implementation can be started from here: a plan session with an approved, mapped spec whose board is not all tested. */
  implementable: boolean
  /** The test run can be started from here: every task is tested and no run is live. */
  verifiable: boolean
  /** The test run: what it is doing, or how the last one in this window ended. Absent before the first. */
  verification?: RunState
  /** The cleanup run after the tests passed: what it is splitting, or how it ended. Absent before the first and once a new test run starts. */
  cleanup?: RunState
  /** The newest record in the tasks file, the outcome that stands. */
  lastVerification?: VerificationRecord
  /** The task board; empty until the spec is mapped. */
  tasks: Task[]
  /** Comments, strikes and resolutions so far; kept after approval as the record of how the plan was reached. */
  review: Review
  /** Comments can be attached: the artifact is a draft. */
  commentable: boolean
  /** The plan is mapped and no comment is open, so it may be approved. */
  approvable: boolean
  /** What the mapping found, in file order, with the planner's options and the user's rulings; empty until the spec is mapped. */
  decisions: Decision[]
  /** Decisions not yet applied to the rules: the open ones and those ruled but still with the planner. */
  pendingDecisions: number
  /** The rulings are with the planner; Approve is offered again once that turn ends. */
  applyingRulings: boolean
  /** The planner is listing what the docs should now say, right after approval; Implement is offered once that turn ends. */
  reviewingDocs: boolean
}

/** One line on a run under the plan: its current step while it runs, its outcome once it ended. */
export type RunState = { live: boolean; text: string }

/** A plan on disk the new-session screen offers to pick up; verified ones are finished and not offered. */
export type ResumablePlan = { feature: string; status: 'draft' | 'approved' }

export type ToWebview =
  | {
      type: 'state'
      tabs: SessionTab[]
      /** Allow-writes for the active session; absent when its phase decides writes itself or no session is active. */
      allowWrites?: boolean
      /** The active session's MCP servers as its engine last reported them; absent while it is not running or takes none. */
      mcp?: McpServerState[]
      /** Present when the active session is a plan session. */
      plan?: PlanState
      /** Plans under `plan/` still in progress, for the new-session screen. */
      plans: ResumablePlan[]
      /** The profiles by name and which of them new sessions get, for the new-session screen's pickers. */
      profiles: ProfileDefaults
    }
  /** Full history of the active session, sent on switch. */
  | { type: 'transcript'; sessionId: string; events: SessionEvent[] }
  /** Show the new-session screen (from the Sessions view's + button). */
  | { type: 'show_new_session' }
  | { type: 'event'; sessionId: string; event: SessionEvent }

/** The user's answer to a permission prompt, with the rules its lines were allowed by that later calls should pass on. */
export type UserPermissionDecision = PermissionDecision & { remember?: RememberedRules }

/** `session` rules hold for the coding session; `project` rules are written into the workspace's allow list. */
export type RememberedRules = { session: string[]; project: string[] }

/** What the human does on the plan view of a draft: the review, and the rulings on its decisions. */
export type ReviewAction =
  /** `target` is a rule's name or `plan` for the artifact as a whole. */
  | { type: 'add_comment'; target: string; text: string }
  | { type: 'edit_comment'; comment: CommentRef; text: string }
  | { type: 'remove_comment'; comment: CommentRef }
  | { type: 'strike_item'; item: string }
  | { type: 'unstrike_item'; item: string }
  /** Hands the plan and the pending review to the session that owns the plan, or a fresh one of its phase. */
  | { type: 'submit_review' }
  /** Closes a comment: the human has read the agent's resolution, agreed with or not. */
  | { type: 'resolve_comment'; comment: CommentRef }
  /** Writes the ruling under the decision: `keep`, a proposal's text, or the user's own. No turn is spent; Send rulings hands them over. */
  | { type: 'rule_decision'; decision: string; ruling: string }

export type FromWebview =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'permission'; requestId: string; decision: UserPermissionDecision }
  /** The card's answers to a question the model asked, or that the user left it unanswered. */
  | { type: 'question'; requestId: string; outcome: QuestionOutcome }
  | { type: 'interrupt' }
  /** File writes in the active session go through without a prompt while on. */
  | { type: 'set_allow_writes'; enabled: boolean }
  /** Tries one of the active session's MCP servers again. */
  | { type: 'reconnect_mcp'; server: string }
  | { type: 'switch_session'; sessionId: string }
  /** Stops the engine; the session stays in the list and resumes on the next prompt. */
  | { type: 'close_session'; sessionId: string }
  /** `prompt`, when given, is sent as the first message. */
  | { type: 'new_session'; mode: SessionMode; feature?: string; prompt?: string }
  /** Sets the profile new sessions of that kind run on; `plan` with an empty name follows `work`. */
  | { type: 'set_default_profile'; role: 'work' | 'plan'; name: string }
  /** Opens the plan session behind a spec on disk, or starts one on it when none remains; what it offers follows the spec's status. */
  | { type: 'resume_plan'; feature: string }
  /** Approves the mapped draft; refused while a decision is pending or a comment open. */
  | { type: 'approve_spec' }
  /** Hands the rulings to the plan session to apply; refused while a decision is still open. */
  | { type: 'send_rulings' }
  | ReviewAction
  /** Maps the active plan session's spec against the code as a run under it; the plan bar shows its progress. */
  | { type: 'map_spec' }
  /** Stops the mapping running under the active plan session. */
  | { type: 'stop_map' }
  /** Stops the cleanup running on the active feature. */
  | { type: 'stop_cleanup' }
  /** Migrates the active feature's plan files to the contract: mechanically where possible, through the planner for the rest. */
  | { type: 'repair_spec' }
  /** Starts an implement session on the approved spec and switches to it; refused on a draft. */
  | { type: 'implement_spec' }
  /** Runs the test commands over the tasks' files again, whatever the last record says. */
  | { type: 'verify_spec' }
  /** Opens an edited file, at the line the edit changed when one is known. */
  | { type: 'open_file'; path: string; line?: number }
  /** Opens the whole edit in the editor's diff view: the pre-edit snapshot against the file as it now stands. */
  | { type: 'open_edit_diff'; snapshot: string; path: string; label: string }
