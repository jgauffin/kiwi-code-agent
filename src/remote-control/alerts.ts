/**
 * Whether, and what, a session stopped mid-turn on the person pushes to the
 * paired phones: a question asked or a permission prompt pending pushes, a
 * turn that merely ended or any other progress pushes nothing, and what is
 * pushed carries buttons only where one tap would settle the whole of it.
 */

import type { SessionEvent } from '../agent/session/code-session'
import type { Question, UserQuestionRequest } from '../agent/session/user-question'

/** One button the notification offers; tapping it settles the prompt with the same effect as at the desk. */
export type AlertButton = { label: string; value: string }

/**
 * What a push notification for a session stopped mid-turn carries: what is
 * being asked, and either buttons that settle it in one tap or a way straight
 * into the app's own prompt screen — both together where the choice needs a
 * screen to be judged even though it also settles in one tap.
 */
export type SessionAlert = {
  sessionId: string
  title: string
  body: string
  buttons?: AlertButton[]
  opensApp: boolean
}

/** Where a session's alert is sent, and where it is taken back once there is nothing left for it to ask. */
export interface RemoteAlertPort {
  send(alert: SessionAlert): void
  withdraw(sessionId: string): void
}

type PermissionRequestEvent = Extract<SessionEvent, { type: 'permission_request' }>

/** The one question a request carries when it is answerable in one tap: a single question, offering choices, taking exactly one of them. */
function singleTapQuestion(request: UserQuestionRequest): Question | undefined {
  if (request.questions.length !== 1) return undefined
  const question = request.questions[0]
  if (!question || question.multiSelect || !question.options?.length) return undefined
  return question
}

/**
 * The notification for a question asked of the person: buttons for its
 * options where one tap would settle the whole of it, else a way straight
 * into the app instead — a request holding several questions is answered
 * there one screen at a time, and a question taking more than a choice (free
 * text, several picks) needs the app just the same.
 */
export function questionAlert(sessionId: string, title: string, request: UserQuestionRequest): SessionAlert {
  const question = singleTapQuestion(request)
  if (question) {
    return {
      sessionId,
      title,
      body: `${question.header}: ${question.question}`,
      buttons: question.options!.map((o) => ({ label: o.label, value: o.label })),
      opensApp: false,
    }
  }
  const body = request.questions.map((q) => q.header).join(', ')
  return { sessionId, title, body, opensApp: true }
}

/** A permission's choice needs a screen when it proposes a file write: the diff has to be read before it can be judged. */
function needsScreen(request: PermissionRequestEvent): boolean {
  return request.edit !== undefined || (request.edits?.length ?? 0) > 0
}

/**
 * The notification for a permission prompt: Allow and Deny always settle it
 * in one tap, and a file write also carries the way into its diff, since the
 * choice cannot be judged from the notification alone.
 */
export function permissionAlert(sessionId: string, title: string, request: PermissionRequestEvent): SessionAlert {
  return {
    sessionId,
    title,
    body: request.description ?? request.title ?? request.toolName,
    buttons: [
      { label: 'Allow', value: 'allow' },
      { label: 'Deny', value: 'deny' },
    ],
    opensApp: needsScreen(request),
  }
}

/** The alert for whichever event stops a session mid-turn on the person; nothing for a turn that merely ended or any other progress. */
export function alertFor(sessionId: string, title: string, event: SessionEvent): SessionAlert | undefined {
  if (event.type === 'question_request') return questionAlert(sessionId, title, event.request)
  if (event.type === 'permission_request') return permissionAlert(sessionId, title, event)
  return undefined
}

/** Whether the event closes what an alert was about, so any alert sent for it is withdrawn rather than left offering buttons that do nothing. */
export function resolvesCompletion(event: SessionEvent): boolean {
  return event.type === 'question_resolved' || event.type === 'permission_resolved' || event.type === 'ended'
}

/**
 * Whether a session may push right now: the person's own choice for it when
 * they made one, else the default for where it started — a session started
 * from the phone may push regardless, one started at the desk follows the
 * workspace's standing default.
 */
export function mayPush(pushAllowed: boolean | undefined, startedFrom: 'phone' | 'desk' | undefined, workspaceDefault: boolean): boolean {
  if (pushAllowed !== undefined) return pushAllowed
  if (startedFrom === 'phone') return true
  return workspaceDefault
}
