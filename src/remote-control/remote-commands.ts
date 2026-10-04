/**
 * What a paired phone may ask the agent to do while the person is away: answer a
 * question or a permission prompt, steer a running session with a prompt or an
 * interrupt, settle a draft's approval and rulings, or pick up a draft's planning
 * session. Nothing else starts from the phone: writing a spec, commenting on a
 * review and changing settings stay at the desk.
 */

import type { PermissionDecision } from '../agent/session/code-session'
import type { QuestionOutcome } from '../agent/session/user-question'
import type { RemoteMessage } from './remote-link'

export type RemoteCommand =
  | { type: 'answer_question'; sessionId: string; requestId: string; outcome: QuestionOutcome }
  | { type: 'answer_permission'; sessionId: string; requestId: string; decision: PermissionDecision }
  | { type: 'send_prompt'; sessionId: string; text: string }
  | { type: 'interrupt_session'; sessionId: string }
  | { type: 'approve_spec'; feature: string }
  | { type: 'send_rulings'; feature: string }
  | { type: 'rule_decision'; feature: string; decision: string; ruling: string }
  | { type: 'start_draft_session'; feature: string }

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

function questionOutcome(value: unknown): QuestionOutcome | undefined {
  const outcome = value as Partial<QuestionOutcome> | undefined
  if (outcome?.kind === 'unanswered') return { kind: 'unanswered', ...(str(outcome.reason) ? { reason: outcome.reason } : {}) }
  if (outcome?.kind === 'answered' && Array.isArray(outcome.answers)) return { kind: 'answered', answers: outcome.answers }
  return undefined
}

function permissionDecision(value: unknown): PermissionDecision | undefined {
  const decision = value as Partial<PermissionDecision> | undefined
  if (decision?.kind === 'allow') return { kind: 'allow' }
  if (decision?.kind === 'deny') return { kind: 'deny', ...(str((decision as { message?: unknown }).message) ? { message: (decision as { message?: string }).message } : {}) }
  return undefined
}

/** The command a message from the phone carries, or nothing when it is not one the phone may send, or is shaped wrong. */
export function parseRemoteCommand(message: RemoteMessage): RemoteCommand | undefined {
  const sessionId = str(message.sessionId)
  const feature = str(message.feature)
  switch (message.type) {
    case 'answer_question': {
      const requestId = str(message.requestId)
      const outcome = questionOutcome(message.outcome)
      return sessionId && requestId && outcome ? { type: 'answer_question', sessionId, requestId, outcome } : undefined
    }
    case 'answer_permission': {
      const requestId = str(message.requestId)
      const decision = permissionDecision(message.decision)
      return sessionId && requestId && decision ? { type: 'answer_permission', sessionId, requestId, decision } : undefined
    }
    case 'send_prompt': {
      const text = str(message.text)
      return sessionId && text ? { type: 'send_prompt', sessionId, text } : undefined
    }
    case 'interrupt_session':
      return sessionId ? { type: 'interrupt_session', sessionId } : undefined
    case 'approve_spec':
      return feature ? { type: 'approve_spec', feature } : undefined
    case 'send_rulings':
      return feature ? { type: 'send_rulings', feature } : undefined
    case 'rule_decision': {
      const decision = str(message.decision)
      const ruling = str(message.ruling)
      return feature && decision && ruling !== undefined ? { type: 'rule_decision', feature, decision, ruling } : undefined
    }
    case 'start_draft_session':
      return feature ? { type: 'start_draft_session', feature } : undefined
    default:
      return undefined
  }
}
