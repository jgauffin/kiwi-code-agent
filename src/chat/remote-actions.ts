/**
 * Carries out what a paired phone asked for, through the same calls a desk act
 * would make, so the effect is the same either way. Each act is noted in the
 * session's log right alongside it, naming that it came from the phone.
 */

import type { PermissionDecision } from '../agent/session/code-session'
import type { SessionRecord } from '../agent/session/session-manager'
import type { QuestionOutcome } from '../agent/session/user-question'
import type { RemoteCommand } from '../remote-control/remote-commands'

/** The narrow slice of `SessionManager` acting from the phone needs. */
export type RemoteSessionPort = {
  get(sessionId: string): SessionRecord | undefined
  list(): SessionRecord[]
  send(sessionId: string, text: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  respondToPermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>
  respondToQuestion(sessionId: string, requestId: string, outcome: QuestionOutcome): Promise<void>
  /** False once whichever device got there first has already resolved the request. */
  isRequestOpen(sessionId: string, requestId: string): Promise<boolean>
  noteRemoteAct(sessionId: string, note: string): Promise<void>
}

/** The narrow slice of `PlanActions` that approving, ruling and picking up a draft need. */
export type RemotePlanPort = {
  approveSpec(shown: SessionRecord | undefined): Promise<void>
  sendRulings(shown: SessionRecord | undefined): Promise<void>
  ruleDecision(shown: SessionRecord | undefined, message: { type: 'rule_decision'; decision: string; ruling: string }): Promise<void>
  resumePlan(feature: string): Promise<void>
}

export type RemoteActionsDeps = {
  sessions: RemoteSessionPort
  plans: RemotePlanPort
  /** Whether the feature's spec is still a draft: the only session the phone may start. */
  isDraft: (feature: string) => Promise<boolean>
}

export class RemoteActions {
  constructor(private readonly deps: RemoteActionsDeps) {}

  async handle(command: RemoteCommand): Promise<void> {
    switch (command.type) {
      case 'answer_question':
        return this.answerQuestion(command)
      case 'answer_permission':
        return this.answerPermission(command)
      case 'send_prompt':
        return this.sendPrompt(command)
      case 'interrupt_session':
        return this.interruptSession(command)
      case 'approve_spec':
        return this.onPlan(command.feature, (record) => this.deps.plans.approveSpec(record), 'Approved the spec from the phone')
      case 'send_rulings':
        return this.onPlan(command.feature, (record) => this.deps.plans.sendRulings(record), 'Sent the rulings from the phone')
      case 'rule_decision':
        return this.onPlan(
          command.feature,
          (record) => this.deps.plans.ruleDecision(record, { type: 'rule_decision', decision: command.decision, ruling: command.ruling }),
          'Ruled a decision from the phone',
        )
      case 'start_draft_session':
        return this.startDraftSession(command)
    }
  }

  /**
   * The answers the phone gave, delivered exactly as an answer at the desk
   * would be. First answer wins: a request already resolved, by whichever
   * device got there first, is left alone rather than answered again.
   */
  private async answerQuestion(command: Extract<RemoteCommand, { type: 'answer_question' }>): Promise<void> {
    const { sessions } = this.deps
    if (!sessions.get(command.sessionId) || !(await sessions.isRequestOpen(command.sessionId, command.requestId))) return
    if (!(await this.act(() => sessions.respondToQuestion(command.sessionId, command.requestId, command.outcome)))) return
    await sessions.noteRemoteAct(command.sessionId, 'Answered a question from the phone')
  }

  /**
   * Allow or deny from the phone, with the same effect as at the desk. First
   * answer wins: a prompt already settled, by whichever device got there
   * first, is left alone rather than answered again.
   */
  private async answerPermission(command: Extract<RemoteCommand, { type: 'answer_permission' }>): Promise<void> {
    const { sessions } = this.deps
    if (!sessions.get(command.sessionId) || !(await sessions.isRequestOpen(command.sessionId, command.requestId))) return
    if (!(await this.act(() => sessions.respondToPermission(command.sessionId, command.requestId, command.decision)))) return
    await sessions.noteRemoteAct(command.sessionId, command.decision.kind === 'allow' ? 'Allowed a permission from the phone' : 'Denied a permission from the phone')
  }

  private async sendPrompt(command: Extract<RemoteCommand, { type: 'send_prompt' }>): Promise<void> {
    const { sessions } = this.deps
    if (!sessions.get(command.sessionId)) return
    await sessions.send(command.sessionId, command.text)
    await sessions.noteRemoteAct(command.sessionId, 'Sent from the phone')
  }

  private async interruptSession(command: Extract<RemoteCommand, { type: 'interrupt_session' }>): Promise<void> {
    const { sessions } = this.deps
    if (!sessions.get(command.sessionId)) return
    await sessions.interrupt(command.sessionId)
    await sessions.noteRemoteAct(command.sessionId, 'Interrupted from the phone')
  }

  /** Only a feature with a plan session open has rules or decisions to settle; nothing else is the phone's to act on. */
  private async onPlan(feature: string, act: (record: SessionRecord) => Promise<void>, note: string): Promise<void> {
    const record = this.planRecord(feature)
    if (!record) return
    await act(record)
    await this.deps.sessions.noteRemoteAct(record.id, note)
  }

  /** The only work the phone starts: picking up a feature whose spec is still a draft. */
  private async startDraftSession(command: Extract<RemoteCommand, { type: 'start_draft_session' }>): Promise<void> {
    if (!(await this.deps.isDraft(command.feature))) return
    await this.deps.plans.resumePlan(command.feature)
    const record = this.planRecord(command.feature)
    if (record) await this.deps.sessions.noteRemoteAct(record.id, 'Opened the draft from the phone')
  }

  private planRecord(feature: string): SessionRecord | undefined {
    return this.deps.sessions.list().find((r) => r.mode === 'plan' && r.feature === feature)
  }

  /** True once the act went through; false when the request was no longer open, so a later answer is quietly dropped (first answer wins). */
  private async act(call: () => Promise<void>): Promise<boolean> {
    try {
      await call()
      return true
    } catch {
      return false
    }
  }
}
