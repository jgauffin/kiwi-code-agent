import type { SessionEvent } from './code-session'
import { isPlanning, type SessionMode } from './session-manager'

/**
 * What a session is doing right now, as far as the UI needs to know.
 * `needs_answer` is a question waiting on the user, kept apart from
 * `needs_human`: a turn that simply ended and a session blocked on a question
 * are acted on differently.
 */
export type SessionStatus = 'idle' | 'planning' | 'implementing' | 'needs_human' | 'needs_answer' | 'error'

const working = (mode: SessionMode): SessionStatus => (isPlanning(mode) ? 'planning' : 'implementing')

/** Statuses that are the user's turn: engine noise does not take them away. */
const waiting = (status: SessionStatus): boolean => status === 'needs_human' || status === 'needs_answer'

/** Derives the next status from an event. Pure, so both the extension host and tests share it. */
export function nextStatus(current: SessionStatus, mode: SessionMode, event: SessionEvent): SessionStatus {
  switch (event.type) {
    case 'user_message':
      return working(mode)
    case 'status':
      if (event.status === 'idle') return current
      return waiting(current) ? current : working(mode)
    case 'permission_request':
      return 'needs_human'
    case 'permission_resolved':
      return working(mode)
    case 'question_request':
      return 'needs_answer'
    case 'question_resolved':
      return working(mode)
    case 'turn_done':
      // A phase session that stops has a spec to approve, findings to rule on, questions, or work done or blocked.
      if (event.isError) return 'error'
      // A card still on screen outlives the turn that asked: it is answered, late, on the session's next turn.
      if (current === 'needs_answer') return current
      return mode === 'chat' ? 'idle' : 'needs_human'
    case 'error':
      return event.fatal ? 'error' : current
    case 'ended':
      return current === 'error' || waiting(current) ? current : 'idle'
    default:
      return current
  }
}
