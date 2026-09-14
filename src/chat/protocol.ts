import type { PermissionDecision, SessionEvent } from '../agent/session/code-session'
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

/** The active plan session's spec, for the approval bar. */
export type PlanState = {
  /** Workspace-relative path of the spec file. */
  specPath: string
  status: 'missing' | 'draft' | 'approved'
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

export type FromWebview =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'permission'; requestId: string; decision: PermissionDecision }
  | { type: 'interrupt' }
  | { type: 'set_verify'; enabled: boolean }
  | { type: 'switch_session'; sessionId: string }
  /** Stops the engine; the session stays in the list and resumes on the next prompt. */
  | { type: 'close_session'; sessionId: string }
  /** `prompt`, when given, is sent as the first message. */
  | { type: 'new_session'; mode: SessionMode; feature?: string; prompt?: string }
  | { type: 'approve_spec' }
  | { type: 'open_spec' }
