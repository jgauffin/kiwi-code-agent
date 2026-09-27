import type { SessionEvent } from './code-session'
import { isPlanning, type SessionMode } from './session-manager'

/**
 * What a session is doing right now, as far as the UI needs to know.
 * `needs_answer` (a question) and `needs_approval` (a permission prompt) are
 * kept apart from `needs_human`: a turn that simply ended and a session
 * blocked mid-turn on the user are acted on differently.
 */
export type SessionStatus = 'idle' | 'planning' | 'implementing' | 'needs_human' | 'needs_approval' | 'needs_answer' | 'error'

const working = (mode: SessionMode): SessionStatus => (isPlanning(mode) ? 'planning' : 'implementing')

/** Statuses that are the user's turn: engine noise does not take them away. */
const waiting = (status: SessionStatus): boolean => status === 'needs_human' || status === 'needs_approval' || status === 'needs_answer'

/**
 * What a tab of several runs says about itself: the one status of them that
 * asks most of the user. A run waiting on an answer must not be hidden behind
 * another that is merely at work.
 */
const URGENCY: SessionStatus[] = ['idle', 'planning', 'implementing', 'error', 'needs_human', 'needs_approval', 'needs_answer']

export function mostUrgent(statuses: SessionStatus[]): SessionStatus {
  return statuses.reduce((worst, status) => (URGENCY.indexOf(status) > URGENCY.indexOf(worst) ? status : worst), 'idle')
}

/** A run stopped mid-turn on the user, and on what. */
export type RunBlock = { on: 'answer' | 'approval'; mode: SessionMode }

/** The run of several that is stopped on the user, a question before a prompt to allow; none when every run is free of them. */
export function blockOf(runs: { mode: SessionMode; status: SessionStatus }[]): RunBlock | undefined {
  const asking = runs.find((r) => r.status === 'needs_answer')
  if (asking) return { on: 'answer', mode: asking.mode }
  const approving = runs.find((r) => r.status === 'needs_approval')
  return approving ? { on: 'approval', mode: approving.mode } : undefined
}

/** Derives the next status from an event. Pure, so both the extension host and tests share it. */
export function nextStatus(current: SessionStatus, mode: SessionMode, event: SessionEvent): SessionStatus {
  switch (event.type) {
    case 'user_message':
      return working(mode)
    case 'status':
      if (event.status === 'idle') return current
      return waiting(current) ? current : working(mode)
    case 'permission_request':
      return 'needs_approval'
    case 'permission_resolved':
      return working(mode)
    case 'question_request':
      return 'needs_answer'
    case 'question_resolved':
      return working(mode)
    case 'turn_done':
      // A phase session that stops has a spec to approve, decisions to rule on, questions, or work done or blocked.
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
