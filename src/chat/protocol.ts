import type { PermissionDecision, SessionEvent } from '../agent/session/code-session'
import type { Engine } from '../agent/session/model-profile'

/** What the session list shows. */
export type SessionSummary = {
  id: string
  title: string
  profileName: string
  engine: Engine
  live: boolean
}

export type ToWebview =
  | {
      type: 'state'
      sessions: SessionSummary[]
      activeSessionId?: string
      profiles: string[]
      /** Verify-on-stop for the active session; absent when no verification rules are configured. */
      verify?: boolean
    }
  /** Full history of the active session, sent on switch. */
  | { type: 'transcript'; sessionId: string; events: SessionEvent[] }
  | { type: 'event'; sessionId: string; event: SessionEvent }

export type FromWebview =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'permission'; requestId: string; decision: PermissionDecision }
  | { type: 'interrupt' }
  | { type: 'new_session'; profileName: string }
  | { type: 'switch_session'; sessionId: string }
  | { type: 'remove_session'; sessionId: string }
  | { type: 'set_verify'; enabled: boolean }
