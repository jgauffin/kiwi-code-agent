import type { PermissionDecision, SessionEvent } from '../agent/session/code-session'
import type { PlanItem, Review } from '../agent/phases/plan-review'
import type { SessionMode } from '../agent/session/session-manager'
import type { SessionStatus } from '../agent/session/session-status'

/** One tab: a session that is live, or the one being looked at. */
export type SessionTab = {
  id: string
  title: string
  mode: SessionMode
  profileName: string
  status: SessionStatus
  active: boolean
}

/** The active planning session's spec: the approval bar and the plan view. */
export type PlanState = {
  /** Workspace-relative path of the spec file. */
  specPath: string
  status: 'missing' | 'draft' | 'approved'
  /** Spec markdown without its front matter; absent while no spec is written. */
  body?: string
  /** A code check can be started from here: a plan session with a draft spec and no check running. */
  checkable: boolean
  /** The check run under this plan session: what it is doing, or how the last one ended. Absent before the first. */
  check?: CheckState
  /** Implementation can be started from here: a plan session with an approved spec. */
  implementable: boolean
  /** The plan's items by id, what a comment or a strike is attached to. */
  items: PlanItem[]
  /** Comments, strikes and resolutions so far; kept after approval as the record of how the plan was reached. */
  review: Review
  /** Comments can be attached: the artifact is a draft. */
  commentable: boolean
  /** No comment is open, so the plan may be approved. */
  approvable: boolean
  /** Amendments to product intent this feature settled; absent when none were proposed. */
  intent?: IntentState
}

/** One line on the check: its current step while it runs, its outcome once it ended. */
export type CheckState = { live: boolean; text: string }

/** The proposed write-back to `docs/**`: what the agent wrote, what the human has yet to apply. */
export type IntentState = {
  /** Workspace-relative path of the amendment file. */
  path: string
  /** Amendments not yet written into `docs/`. */
  pending: number
  /** Amendments already written, kept as the record of what intent owes this feature. */
  applied: number
  /** The write-back can be run from here: the spec is approved and something is pending. */
  applicable: boolean
}

export type ToWebview =
  | {
      type: 'state'
      tabs: SessionTab[]
      /** Verify-on-stop for the active session; absent when no verification rules are configured or no session is active. */
      verify?: boolean
      /** Present when the active session is a plan session. */
      plan?: PlanState
    }
  /** Full history of the active session, sent on switch. */
  | { type: 'transcript'; sessionId: string; events: SessionEvent[] }
  /** Show the new-session screen (from the Sessions view's + button). */
  | { type: 'show_new_session' }
  | { type: 'event'; sessionId: string; event: SessionEvent }

/** The user's answer to a permission prompt; `allow_project` also writes `rules` into the workspace's allow list. */
export type UserPermissionDecision = PermissionDecision | { kind: 'allow_project'; rules: string[] }

/** What the human does while reviewing a draft plan. */
export type ReviewAction =
  /** `target` is an item id or `plan` for the artifact as a whole. */
  | { type: 'add_comment'; target: string; text: string }
  | { type: 'edit_comment'; commentId: string; text: string }
  | { type: 'remove_comment'; commentId: string }
  | { type: 'strike_item'; itemId: string }
  | { type: 'unstrike_item'; itemId: string }
  /** Hands the plan and the pending review to the session that owns the plan, or a fresh one of its phase. */
  | { type: 'submit_review' }
  /** Closes a comment by accepting the agent's resolution. */
  | { type: 'accept_resolution'; commentId: string }

export type FromWebview =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'permission'; requestId: string; decision: UserPermissionDecision }
  | { type: 'interrupt' }
  | { type: 'set_verify'; enabled: boolean }
  | { type: 'switch_session'; sessionId: string }
  /** Stops the engine; the session stays in the list and resumes on the next prompt. */
  | { type: 'close_session'; sessionId: string }
  /** `prompt`, when given, is sent as the first message. */
  | { type: 'new_session'; mode: SessionMode; feature?: string; prompt?: string }
  | { type: 'approve_spec' }
  | ReviewAction
  /** Starts a check of the active plan session's spec as a run under it; the plan bar shows its progress. */
  | { type: 'check_spec' }
  /** Stops the check running under the active plan session. */
  | { type: 'stop_check' }
  /** Starts an implement session on the approved spec and switches to it; refused on a draft. */
  | { type: 'implement_spec' }
  /** Writes the pending intent amendments into `docs/`; refused on a draft. */
  | { type: 'update_intent' }
