import type { SessionEvent } from './code-session'
import { isPlanning, type SessionMode } from './session-manager'

/** What a session is doing right now, as far as the UI needs to know. */
export type SessionStatus = 'idle' | 'planning' | 'implementing' | 'needs_human' | 'error'

const working = (mode: SessionMode): SessionStatus => (isPlanning(mode) ? 'planning' : 'implementing')

/** Derives the next status from an event. Pure, so both the extension host and tests share it. */
export function nextStatus(current: SessionStatus, mode: SessionMode, event: SessionEvent): SessionStatus {
  switch (event.type) {
    case 'user_message':
      return working(mode)
    case 'status':
      if (event.status === 'idle') return current
      return current === 'needs_human' ? current : working(mode)
    case 'permission_request':
      return 'needs_human'
    case 'permission_resolved':
      return working(mode)
    case 'turn_done':
      // A phase session that stops has a spec to approve, findings to rule on, questions, or work done or blocked.
      if (event.isError) return 'error'
      return mode === 'chat' ? 'idle' : 'needs_human'
    case 'error':
      return event.fatal ? 'error' : current
    case 'ended':
      return current === 'error' || current === 'needs_human' ? current : 'idle'
    default:
      return current
  }
}
