import type { SessionEvent } from '../../agent/session/code-session'
import { PermissionCard } from './permission-card'
import type { PromptCards } from './prompt-cards'
import { QuestionCard } from './question-card'
import type { ToolSteps } from './tool-steps'
import type { Activity } from './working-row'

export const WAITING_ON_MODEL = 'Waiting on model'
const STARTING = 'Starting the session'
const NEEDS_APPROVAL = 'Waiting for you to allow or deny'
const NEEDS_ANSWER = 'Waiting for your answer'

export const atWork = (label: string): Activity => ({ label, needsUser: false })
const awaitingUser = (label: string): Activity => ({ label, needsUser: true })

/**
 * Who the turn is waiting on: the user while a card of theirs is open, else
 * the newest tool call still running, else the model.
 */
export function currentActivity(cards: PromptCards, steps: ToolSteps): Activity {
  const waiting = cards.waitingCards()
  if (waiting.some((card) => card instanceof PermissionCard)) return awaitingUser(NEEDS_APPROVAL)
  if (waiting.some((card) => card instanceof QuestionCard)) return awaitingUser(NEEDS_ANSWER)
  return atWork(steps.latestPending() ?? WAITING_ON_MODEL)
}

/**
 * The phase a status names, or nothing when it leaves the activity as it was:
 * 'idle' also arrives mid-turn (after compaction, between requests); only the turn's end clears the activity.
 * The row adds its own ellipsis to whatever phase it names.
 */
export function statusActivity(event: Extract<SessionEvent, { type: 'status' }>): Activity | undefined {
  if (event.status === 'starting') return atWork(event.detail?.replace(/…$/, '') ?? STARTING)
  if (event.status === 'requesting') return atWork(WAITING_ON_MODEL)
  if (event.status === 'compacting') return atWork('Compacting context')
  return undefined
}
