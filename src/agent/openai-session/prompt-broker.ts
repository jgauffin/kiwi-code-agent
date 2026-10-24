import { permissionResolved, type FileEditChange, type PermissionDecision, type SessionEvent } from '../session/code-session'
import type { QuestionOutcome, UserQuestionRequest } from '../session/user-question'

/** The permission prompts and questions a session has put to the user and is still waiting on. */
export class PromptBroker {
  private readonly pending = new Map<string, (d: PermissionDecision) => void>()
  /** Questions the model put to the user, by the id of the tool call that asked. */
  private readonly questions = new Map<string, (outcome: QuestionOutcome) => void>()

  constructor(private readonly emit: (event: SessionEvent) => void) {}

  respondToPermission(requestId: string, decision: PermissionDecision): boolean {
    const resolve = this.pending.get(requestId)
    if (!resolve) return false
    this.pending.delete(requestId)
    this.emit(permissionResolved(requestId, decision))
    resolve(decision)
    return true
  }

  respondToQuestion(requestId: string, outcome: QuestionOutcome): boolean {
    const resolve = this.questions.get(requestId)
    if (!resolve) return false
    this.questions.delete(requestId)
    this.emit({ type: 'question_resolved', requestId, outcome })
    resolve(outcome)
    return true
  }

  denyPending(message: string): void {
    for (const [id, resolve] of this.pending) {
      this.pending.delete(id)
      resolve({ kind: 'deny', message })
    }
  }

  askPermission(
    toolUseId: string,
    toolName: string,
    input: unknown,
    signal: AbortSignal,
    shown: { title?: string; edits?: FileEditChange[] } = {},
  ): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      this.pending.set(toolUseId, resolve)
      signal.addEventListener('abort', () => {
        if (this.pending.delete(toolUseId)) resolve({ kind: 'deny', message: 'Interrupted' })
      })
      this.emit({ type: 'permission_request', requestId: toolUseId, toolUseId, toolName, input, ...shown })
    })
  }

  /**
   * The model's question to the user. The card decides when this settles, so
   * there is no deadline: the loop holds the tool call open, and the session
   * makes no further progress until the request is resolved one way or the
   * other. The tool call's id is the request's, so the answer comes back as
   * that call's own result.
   */
  askUser(requestId: string, request: UserQuestionRequest): Promise<QuestionOutcome> {
    return new Promise((resolve) => {
      this.questions.set(requestId, resolve)
      this.emit({ type: 'question_request', requestId, request })
    })
  }

  /** Every question still on screen goes unanswered; the model is never handed a choice the user did not make. */
  cancelQuestions(reason: string): void {
    for (const [id, resolve] of this.questions) {
      this.questions.delete(id)
      const outcome: QuestionOutcome = { kind: 'unanswered', reason }
      this.emit({ type: 'question_resolved', requestId: id, outcome })
      resolve(outcome)
    }
  }
}
