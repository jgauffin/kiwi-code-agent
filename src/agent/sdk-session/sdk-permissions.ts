import type { Options, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { permissionResolved, type PermissionDecision, type SessionEvent } from '../session/code-session'
import type { AsyncQueue } from '../session/async-queue'
import type { PermissionShown } from '../permissions/gate'
import type { QuestionOutcome, UserQuestionRequest } from '../session/user-question'
import { bareToolName } from './tool-server'

type PendingPermission = {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
  /** Set on a question a script's own call put; the user's answer goes here as given, not through the engine's result. */
  decided?: (decision: PermissionDecision) => void
}

/** The prompts a session has put to the user and is still waiting on: permissions and questions. */
export class SdkPermissions {
  private readonly pending = new Map<string, PendingPermission>()
  /** Questions this session's tools put to the user, by request id. */
  private readonly questions = new Map<string, (outcome: QuestionOutcome) => void>()

  constructor(
    private readonly output: AsyncQueue<SessionEvent>,
    private readonly signal: AbortSignal,
  ) {}

  respondToPermission(requestId: string, decision: PermissionDecision): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false
    this.pending.delete(requestId)
    this.output.push(permissionResolved(requestId, decision))
    if (pending.decided) pending.decided(decision)
    else pending.resolve(toPermissionResult(decision, pending.input))
    return true
  }

  respondToQuestion(requestId: string, outcome: QuestionOutcome): boolean {
    const resolve = this.questions.get(requestId)
    if (!resolve) return false
    this.questions.delete(requestId)
    this.output.push({ type: 'question_resolved', requestId, outcome })
    resolve(outcome)
    return true
  }

  request(toolName: string, input: Record<string, unknown>, ctx: Parameters<NonNullable<Options['canUseTool']>>[2]): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const requestId = ctx.toolUseID
      this.pending.set(requestId, { resolve, input })
      ctx.signal.addEventListener('abort', () => {
        if (this.pending.delete(requestId)) resolve({ behavior: 'deny', message: 'Cancelled' })
      })
      const reason = ctx.decisionReason ?? (ctx.blockedPath ? `Touches ${ctx.blockedPath}` : undefined)
      this.output.push({
        type: 'permission_request',
        requestId,
        toolUseId: ctx.toolUseID,
        toolName: bareToolName(toolName),
        input,
        ...(ctx.title ? { title: ctx.title } : {}),
        ...(ctx.description ? { description: ctx.description } : {}),
        ...(reason ? { reason } : {}),
      })
    })
  }

  askScript(requestId: string, toolName: string, input: unknown, shown: PermissionShown = {}): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      const ended = (result: PermissionResult) => resolve({ kind: 'deny', message: result.behavior === 'deny' ? result.message : 'Cancelled' })
      this.pending.set(requestId, { resolve: ended, input: {}, decided: resolve })
      this.signal.addEventListener('abort', () => {
        if (this.pending.delete(requestId)) resolve({ kind: 'deny', message: 'Cancelled' })
      })
      this.output.push({ type: 'permission_request', requestId, toolUseId: requestId, toolName, input, ...shown })
    })
  }

  /**
   * A question from one of this session's own tools. The wait has no deadline:
   * the card decides when it settles. Should the engine give up on the tool
   * call before then — its request timeout is its own — the card stays
   * answerable, and the answer reaches the session as its next prompt.
   */
  askUser(request: UserQuestionRequest): Promise<QuestionOutcome> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()
      this.questions.set(requestId, resolve)
      this.output.push({ type: 'question_request', requestId, request })
    })
  }

  /** Nothing is left waiting: every open question ends unanswered, never with a choice the user did not make. */
  cancelQuestions(reason: string): void {
    for (const [id, resolve] of this.questions) {
      this.questions.delete(id)
      const outcome: QuestionOutcome = { kind: 'unanswered', reason }
      if (!this.output.isEnded) this.output.push({ type: 'question_resolved', requestId: id, outcome })
      resolve(outcome)
    }
  }

  denyAllPending(message: string): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.resolve({ behavior: 'deny', message })
    }
  }
}

/**
 * The engine validates an allow as `{ updatedInput: record }`, so the
 * unchanged input is echoed back; the typings mark it optional but the
 * CLI does not.
 */
function toPermissionResult(decision: PermissionDecision, input: Record<string, unknown>): PermissionResult {
  switch (decision.kind) {
    case 'allow':
      return { behavior: 'allow', updatedInput: input, decisionClassification: 'user_temporary' }
    case 'deny':
      return { behavior: 'deny', message: `Denied by user${decision.message ? `: ${decision.message}` : ''}`, decisionClassification: 'user_reject' }
  }
}
