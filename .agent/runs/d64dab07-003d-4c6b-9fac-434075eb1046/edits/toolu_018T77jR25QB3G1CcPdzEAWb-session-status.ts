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

/** The engine is at work on a turn, not stopped on the user. */
export const underWay = (status: SessionStatus): boolean => status === 'planning' || status === 'implementing'

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

/** What a turn the user stopped reports as its error; stopping is not a failure. */
const INTERRUPTED = 'interrupted'

/**
 * Why the session's last turn failed, if it did: a turn that ended in error,
 * or an engine that never came up. Nothing retries either, so the dev must be
 * told. The next prompt starts over.
 */
export function lastFailure(current: string | undefined, event: SessionEvent): string | undefined {
  switch (event.type) {
    case 'user_message':
      return undefined
    case 'error':
      return event.fatal ? event.message : current
    case 'turn_done': {
      if (!event.isError) return undefined
      const errors = event.errors.filter((e) => e !== INTERRUPTED)
      if (event.errors.length > 0 && errors.length === 0) return undefined
      return errors.join('; ') || 'the turn ended with an error'
    }
    default:
      return current
  }
}

/** Derives the next status from an event. Pure, so both the extension host and tests share it. */
export function nextStatus(current: SessionStatus, mode: SessionMode, event: SessionEvent): SessionStatus {
  switch (event.type) {
    case 'user_message':
      return working(mode)
    case 'status':
      // A compaction between turns ends without a turn_done to say the session is free again.
      if (event.status === 'idle' || event.status === 'compacting') return current
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
      // A cleanup's outcome is the plan bar's line; the user can chat on from there but owes it nothing.
      return mode === 'chat' || mode === 'cleanup' ? 'idle' : 'needs_human'
    case 'error':
      return event.fatal ? 'error' : current
    case 'ended':
      return current === 'error' || waiting(current) ? current : 'idle'
    default:
      return current
  }
}
