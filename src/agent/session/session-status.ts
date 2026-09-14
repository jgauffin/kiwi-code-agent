import type { SessionEvent } from './code-session'
import type { SessionMode } from './session-manager'

/** What a session is doing right now, as far as the UI needs to know. */
export type SessionStatus = 'idle' | 'planning' | 'implementing' | 'verifying' | 'needs_human' | 'error'

const working = (mode: SessionMode): SessionStatus => (mode === 'plan' ? 'planning' : 'implementing')

/** Derives the next status from an event. Pure, so both the extension host and tests share it. */
export function nextStatus(current: SessionStatus, mode: SessionMode, event: SessionEvent): SessionStatus {
  switch (event.type) {
    case 'user_message':
      return working(mode)
    case 'status':
      if (event.status === 'verifying') return 'verifying'
      if (event.status === 'idle') return current === 'verifying' ? working(mode) : current
      return current === 'needs_human' ? current : working(mode)
    case 'permission_request':
      return 'needs_human'
    case 'permission_resolved':
      return working(mode)
    case 'verification_started':
      return 'verifying'
    case 'turn_done':
      // A planner that stops has either a spec to approve or questions to answer.
      if (event.isError) return 'error'
      return mode === 'plan' ? 'needs_human' : 'idle'
    case 'error':
      return event.fatal ? 'error' : current
    case 'ended':
      return current === 'error' || current === 'needs_human' ? current : 'idle'
    default:
      return current
  }
}
