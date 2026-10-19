import type { SessionEvent } from '../../agent/session/code-session'
import { PermissionCard } from './permission-card'
import { QuestionCard } from './question-card'

type Place = (element: HTMLElement) => void

/** The permission and question cards of a transcript, and which of them still wait on the user. */
export class PromptCards {
  private readonly permissions = new Map<string, PermissionCard>()
  private readonly questions = new Map<string, QuestionCard>()
  /** Tool calls the user allowed at a prompt: they have read what the call would do. */
  private readonly approvedByHand = new Set<string>()
  /** Cards left open when their engine stopped: still answerable, a turn late, but nothing waits on them. */
  private readonly late = new Set<HTMLElement>()

  clear(): void {
    this.permissions.clear()
    this.questions.clear()
    this.approvedByHand.clear()
    this.late.clear()
  }

  /** A question card still waiting on the user. */
  get hasOpenQuestion(): boolean {
    return [...this.questions.values()].some((card) => !card.isResolved)
  }

  /** The first card still waiting on the user, a permission prompt or a question. */
  openCard(): HTMLElement | undefined {
    return this.waitingCards()[0]
  }

  /** Cards the turn waits on: open, and raised by the engine still running. */
  waitingCards(): (PermissionCard | QuestionCard)[] {
    return [...this.permissions.values(), ...this.questions.values()].filter((card) => !card.isResolved && !this.late.has(card))
  }

  isApprovedByHand(toolUseId: string): boolean {
    return this.approvedByHand.has(toolUseId)
  }

  requestPermission(event: Extract<SessionEvent, { type: 'permission_request' }>, place: Place): void {
    const card = new PermissionCard()
    card.className = 'permission'
    place(card)
    card.show(event)
    this.permissions.set(event.requestId, card)
  }

  resolvePermission(event: Extract<SessionEvent, { type: 'permission_resolved' }>): void {
    const card = this.permissions.get(event.requestId)
    card?.resolve(event.decision, event.message)
    if (event.decision === 'allow' && card?.toolUseId) this.approvedByHand.add(card.toolUseId)
  }

  requestQuestion(event: Extract<SessionEvent, { type: 'question_request' }>, place: Place): void {
    const card = new QuestionCard()
    card.className = 'question-card'
    place(card)
    card.show(event)
    this.questions.set(event.requestId, card)
  }

  resolveQuestion(event: Extract<SessionEvent, { type: 'question_resolved' }>): void {
    this.questions.get(event.requestId)?.resolve(event.outcome)
  }

  /**
   * A call is shown once. The prompt stands for the call until the call's own
   * step reports what it did, and then goes: what the user allowed is the step
   * they see. A refused call has no step to speak for it, so its prompt stays.
   */
  dropAnsweredPrompt(toolUseId: string): void {
    if (!this.approvedByHand.has(toolUseId)) return
    for (const [requestId, card] of this.permissions) {
      if (card.toolUseId !== toolUseId) continue
      card.remove()
      this.permissions.delete(requestId)
    }
  }

  /**
   * The engine stopped with cards still open. They can still be answered, the
   * answer reaching the model as the next message, but nothing waits on them,
   * so the row below stops saying so.
   */
  leaveOpenCardsLate(): void {
    for (const card of [...this.permissions.values(), ...this.questions.values()]) {
      if (card.isResolved || this.late.has(card)) continue
      this.late.add(card)
      card.classList.add('late')
      const note = document.createElement('p')
      note.className = 'late-note'
      note.textContent = 'The session stopped before this was answered. An answer now reaches the model as your next message.'
      card.prepend(note)
    }
  }
}
