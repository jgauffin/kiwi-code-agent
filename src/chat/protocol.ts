import type { McpServerState, PermissionDecision, SessionEvent } from '../agent/session/code-session'
import type { QuestionOutcome } from '../agent/session/user-question'
import type { Decision } from '../agent/phases/decisions'
import type { CommentRef, Review } from '../agent/phases/plan-review'
import type { PlanStage } from '../agent/phases/plan-stage'
import type { Spec } from '../agent/phases/spec-model'
import type { CleanupDecision, Task, VerificationRecord } from '../agent/phases/tasks-file'
import type { UnitKind } from '../agent/cleanup/unit-size'
import type { ModelProfile } from '../agent/session/model-profile'
import type { PhaseStepName } from '../agent/session/phase-choices'
import type { SessionMode } from '../agent/session/session-manager'
import type { RunBlock, SessionStatus } from '../agent/session/session-status'
import type { ProfileDefaults } from '../settings/settings-store'

/** The session an editor tab shows; its `title` is what the tab is named. */
export type SessionTab = {
  id: string
  title: string
  mode: SessionMode
  profileName: string
  status: SessionStatus
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
  status: 'missing' | 'draft' | 'approved' | 'implemented'
  /** Spec markdown without its front matter; absent while no spec is written. */
  body?: string
  /** The spec as the contract reads it; absent while no spec is written. */
  spec?: Spec
  /** The board predates the spec as it stands; the spec is checked again and the board re-derived. */
  stale: boolean
  /** The spec is off contract and can be repaired: a plan session is active to do it. */
  repairable: boolean
  /** The check against the code can be started again from here: the approved spec needs one, nothing is pending and no check is live. */
  checkable: boolean
  /** The check against the code under this plan session: what it is doing, or how the last one ended. Absent before the first. */
  check?: RunState
  /** Implementation can be started from here: a plan session with an approved spec whose derived board is not all tested. */
  implementable: boolean
  /** The test run can be started from here: every task is tested and no run is live. */
  verifiable: boolean
  /** The test run: what it is doing, or how the last one in this window ended. Absent before the first. */
  verification?: RunState
  /** The cleanup run after the tests passed: what it is splitting, or how it ended. Absent before the first and once a new test run starts. */
  cleanup?: RunState
  /** What the size sweep found after the tests passed; absent until one has run in this window. */
  cleanupSweep?: CleanupSweep
  /** What the user said about the cleanup, as the tasks file records it; absent while the offer stands open. */
  cleanupDecision?: CleanupDecision
  /** The newest record in the tasks file, the outcome that stands. */
  lastVerification?: VerificationRecord
  /** The task board; empty until the approved spec is checked clean. */
  tasks: Task[]
  /** Comments, strikes and resolutions so far; kept after approval as the record of how the plan was reached. */
  review: Review
  /** Comments can be attached: the artifact is a draft. */
  commentable: boolean
  /** A draft with no comment open, so it may be approved. */
  approvable: boolean
  /** What the check found, in file order, with the planner's options and the user's rulings; empty until it found something. */
  decisions: Decision[]
  /** Decisions not yet applied to the rules: the open ones and those ruled but still with the planner. */
  pendingDecisions: number
  /** The rulings are with the planner; the check runs again once that turn ends. */
  applyingRulings: boolean
  /** The planner is listing what the docs should now say, right after the clean check; the build starts once that turn ends. */
  reviewingDocs: boolean
  /** Some run of the feature is at work: a turn in flight, or a check, test run or cleanup live. False means the next act is the dev's. */
  atWork: boolean
  /** A run of the feature is stopped mid-turn on the dev: a question to answer or a call to allow or deny. */
  blocked?: RunBlock
  /** A run of the feature whose last turn failed, and why: nothing retries it, so the dev has to be told. */
  failure?: RunFailure
  /** The profile each phase will run on next, by step; `isDefault` marks one running on the settings default rather than a choice made for this feature (B8). */
  phaseProfiles: PhaseProfileState[]
}

/** One phase's resolved profile as the plan view shows it (B8), or the configuration it refused to start on (B6). */
export type PhaseProfileState = { step: PhaseStepName; name: string; isDefault: boolean } | { step: PhaseStepName; missing: string }

export type RunFailure = { mode: SessionMode; message: string }

/** One line on a run under the plan: its current step while it runs, its outcome once it ended. */
export type RunState = { live: boolean; text: string }

/** One unit the size sweep flagged, its path workspace-relative. */
export type CleanupUnit = { path: string; line: number; name: string; kind: UnitKind; lines: number; threshold: number }

/** What the last sweep found, in file order; empty when every unit is within its limit. */
export type CleanupSweep = { units: CleanupUnit[] }

/**
 * One run under a tab: the planner, a mapping, an implementer, a cleanup.
 * Each keeps its own conversation; the tab shows them one under the other,
 * and only the current one takes what the user types.
 */
export type RunRef = { sessionId: string; mode: SessionMode; title: string; current: boolean }

export type RunSection = RunRef & { events: SessionEvent[] }

/** A plan on disk the new-session screen offers to pick up; verified ones are finished and not offered. */
export type ResumablePlan = { feature: string; status: 'draft' | 'approved' }

/** A chat with no editor tab open the new-session screen offers to reopen; its transcript is the context it comes back with. */
export type ResumableChat = { sessionId: string; title: string; startedAt: string }

export type ToWebview =
  | {
      type: 'state'
      /** The session this editor tab shows; absent while it shows the new-session screen. */
      tab?: SessionTab
      /** Allow-writes for the active session; absent when its phase decides writes itself or no session is active. */
      allowWrites?: boolean
      /** The active session's MCP servers as its engine last reported them; absent while it is not running or takes none. */
      mcp?: McpServerState[]
      /** The run what the user types reaches has a running engine, so its conversation can be compacted. */
      compactable?: boolean
      /** Present when the active session is a plan session. */
      plan?: PlanState
      /** The run under the active tab that what the user types reaches; its section is the one open. */
      currentRun?: string
      /** Plans under `plan/` still in progress, for the new-session screen's pick-up list. */
      plans: ResumablePlan[]
      /** Chats with no editor tab open, newest first, for the same list. */
      chats: ResumableChat[]
      /** Decisions in `plan/unfiled-decisions.md` waiting to be filed into the specs and docs, for the same list. */
      unfiled: number
      /** The profiles by name and which of them new sessions get, for the new-session screen's pickers. */
      profiles: ProfileDefaults
      /** Every model a provider serves, for the composer's model switch on a chat session. */
      models: ModelProfile[]
    }
  /** Full history of the tab, one section per run under it, oldest first. */
  | { type: 'transcript'; sessionId: string; runs: RunSection[] }
  /** The file the editor had open when the composer asked to link it, as it will be named in the prompt. */
  | { type: 'linked_file'; path: string }
  | { type: 'event'; sessionId: string; run: RunRef; event: SessionEvent }

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
  /** `files` are the composer's linked files; the prompt tells the agent to read them. */
  | { type: 'send'; text: string; files?: string[] }
  /** Answers with `linked_file` for the file open in the editor, so the composer can link it. */
  | { type: 'link_open_file' }
  /** `sessionId` is the run whose section the card sits in: a tab holds several, and only that one asked. */
  | { type: 'permission'; sessionId: string; requestId: string; decision: UserPermissionDecision }
  /** The card's answers to a question the model asked, or that the user left it unanswered. */
  | { type: 'question'; sessionId: string; requestId: string; outcome: QuestionOutcome }
  | { type: 'interrupt' }
  /** Folds the current run's conversation into a summary to make room; a turn in flight carries on after it. */
  | { type: 'compact' }
  /** File writes in the active session go through without a prompt while on. */
  | { type: 'set_allow_writes'; enabled: boolean }
  /** Switches the active chat session to a model named as `models` on `state` lists it. */
  | { type: 'set_session_model'; name: string }
  /** Carries the active docs evaluation's conversation into a new chat with the full tool set. */
  | { type: 'continue_in_chat' }
  /** Tries one of the active session's MCP servers again. */
  | { type: 'reconnect_mcp'; server: string }
  /** Opens the session in its own editor tab, revealing the tab it already has. */
  | { type: 'switch_session'; sessionId: string }
  /** `prompt`, when given, is sent as the first message; `files` are linked files it should read. */
  | { type: 'new_session'; mode: SessionMode; feature?: string; prompt?: string; files?: string[] }
  /** Sets the profile new sessions run on. */
  | { type: 'set_default_profile'; name: string }
  /** Sets, or clears when `name` is absent, the profile the active plan's named phase runs on (B1, B7); clearing returns the phase to the settings default (B2). */
  | { type: 'set_phase_profile'; step: PhaseStepName; name?: string }
  /** Opens the plan session behind a spec on disk, or starts one on it when none remains; what it offers follows the spec's status. */
  | { type: 'resume_plan'; feature: string }
  /** Approves the draft and starts its check against the code; refused while a comment is open. */
  | { type: 'approve_spec' }
  /** Hands the rulings to the plan session to apply; refused while a decision is still open. */
  | { type: 'send_rulings' }
  | ReviewAction
  /** Checks the active plan session's approved spec against the code again, after a check failed or was stopped. */
  | { type: 'check_spec' }
  /** Stops the check running under the active plan session. */
  | { type: 'stop_check' }
  /** Stops the cleanup running on the active feature. */
  | { type: 'stop_cleanup' }
  /** What to do with the units the size sweep found: split them now, leave the offer for later, or settle the feature without splitting. `paths` narrows a split to the files picked; absent means every one. */
  | { type: 'cleanup_decision'; decision: 'run' | 'postpone' | 'skip'; paths?: string[] }
  /** Measures the feature's edited files again, for an offer this window has not made yet. */
  | { type: 'sweep_sizes' }
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
