import type { SessionEvent } from '../../agent/session/code-session'
import { renderAnsi } from './ansi'
import { AssistantBubbles } from './assistant-bubbles'
import { PromptSubmittedEvent } from './events'
import { PermissionCard } from './permission-card'
import { PromptCards } from './prompt-cards'
import { isQuestionTool, QuestionCard } from './question-card'
import { ToolSteps } from './tool-steps'
import { agentMessage, block, compactionMarker, copyButton, switchMarker, turnLine } from './transcript-blocks'
import { type Activity, WorkingRow } from './working-row'

const WAITING_ON_MODEL = 'Waiting on model'
const STARTING = 'Starting the session'
const NEEDS_APPROVAL = 'Waiting for you to allow or deny'
const NEEDS_ANSWER = 'Waiting for your answer'

const atWork = (label: string): Activity => ({ label, needsUser: false })
const awaitingUser = (label: string): Activity => ({ label, needsUser: true })

/**
 * The conversation as an append-only stream. Events patch the DOM directly:
 * streamed text lands in the bubble it belongs to, tool results attach to
 * their call, permission cards resolve in place. `reset()` replays history.
 */
export class ChatTranscript extends HTMLElement {
  /** What scrolls as the conversation grows: this element, or the container a tab's several runs share. */
  scrollHost: HTMLElement = this
  private readonly bubbles = new AssistantBubbles(
    (element, parentToolUseId) => this.insert(element, parentToolUseId),
    (parentToolUseId) => this.steps.agentLabel(parentToolUseId),
  )
  private readonly steps = new ToolSteps()
  private readonly cards = new PromptCards()
  private readonly workingRow = new WorkingRow()
  private statusLine!: HTMLElement
  /** What the session is doing right now, or what it needs from the user; nothing when idle. */
  private activity: Activity | undefined
  /** The offer to carry on a turn that stopped short; it stands only until the conversation moves on. */
  private resume: HTMLButtonElement | undefined
  /** The model the session is running on now, to tell a restart on the same model from a switch to another (B13). */
  private currentModel: string | undefined

  connectedCallback(): void {
    this.ensureStatusLine()
  }

  /** The status line is the transcript's own first child; history can be replayed into it before it is on screen. */
  private ensureStatusLine(): void {
    if (this.statusLine) return
    this.statusLine = document.createElement('p')
    this.statusLine.className = 'status'
    this.appendChild(this.statusLine)
  }

  /**
   * Replays a run's log. `live` says whether its engine is still there: a turn
   * the log leaves unfinished was cut off with the last window and nothing is
   * at work on it, where a card left open is still the user's to answer and
   * reaches the session as its next prompt.
   */
  reset(events: SessionEvent[], live: boolean): void {
    this.ensureStatusLine()
    this.replaceChildren(this.statusLine)
    this.bubbles.clear()
    this.steps.clear()
    this.cards.clear()
    this.resume = undefined
    this.currentModel = undefined
    this.workingRow.clear()
    this.activity = undefined
    this.setStatus('')
    for (const event of events) this.apply(event, false)
    this.bubbles.renderStreamed()
    if (!live) this.dropWork()
    this.showWorking()
    this.scrollToEnd()
  }

  /** The engine behind the log is gone, so nothing is at work on it; a card it left open still waits on the user, who answers it a turn late. */
  private dropWork(): void {
    if (!this.activity?.needsUser) this.activity = undefined
  }

  /** A question card still waiting on the user. */
  get hasOpenQuestion(): boolean {
    return this.cards.hasOpenQuestion
  }

  /** The first card still waiting on the user, a permission prompt or a question. */
  openCard(): HTMLElement | undefined {
    return this.cards.openCard()
  }

  apply(event: SessionEvent, live = true): void {
    this.ensureStatusLine()
    this.handle(event, live)
    if (live) {
      this.showWorking()
      this.scrollToEnd()
    }
  }

  private handle(event: SessionEvent, live: boolean): void {
    switch (event.type) {
      case 'session_started':
        this.sessionStarted(event)
        break
      case 'user_message':
        this.userMessage(event)
        break
      // What a subagent is doing never renames the row: the main thread is waiting on
      // the step that spawned it, and several threads renaming the one row in turn reads
      // as a stall, the time spent restarting at every change of name.
      case 'assistant_text':
        this.bubbles.appendText(event, live)
        if (!event.parentToolUseId) this.activity = atWork('Writing')
        break
      case 'assistant_thinking':
        this.bubbles.appendThinking(event)
        if (!event.parentToolUseId) this.activity = atWork('Thinking')
        break
      case 'assistant_message':
        this.bubbles.finish(event)
        // The tool calls the message carries, if any, follow right after and take over.
        if (!event.parentToolUseId) this.activity = atWork(WAITING_ON_MODEL)
        break
      case 'tool_call':
        this.toolCalled(event)
        break
      case 'tool_result':
        this.toolResulted(event)
        break
      case 'permission_request':
        // A prompt stands where the call it asks about stands, so one raised inside a
        // subagent is read in that agent's step and not at the foot of the transcript.
        this.cards.requestPermission(event, (card) => this.insert(card, event.toolUseId ? this.steps.threadOf(event.toolUseId) : undefined))
        this.activity = this.currentActivity()
        break
      case 'permission_resolved':
        this.cards.resolvePermission(event)
        this.activity = this.currentActivity()
        break
      case 'question_request':
        this.cards.requestQuestion(event, (card) => this.insert(card))
        this.activity = this.currentActivity()
        break
      case 'question_resolved':
        this.cards.resolveQuestion(event)
        this.activity = this.currentActivity()
        break
      case 'status':
        this.statusChanged(event)
        break
      case 'compacted':
        this.insert(compactionMarker(event))
        break
      case 'turn_done':
        this.activity = undefined
        this.insert(turnLine(event))
        break
      case 'error':
        this.errored(event)
        break
      case 'agent_message':
        this.insert(agentMessage(event))
        break
      case 'agent_exchange_capped':
        this.insert(block('error', `The agents exchanged ${event.limit} messages with ${event.workspace} without a word from you, so the next one was refused. Write in this chat to let them go on.`))
        break
      case 'ended':
        this.activity = undefined
        this.cards.leaveOpenCardsLate()
        this.insert(block('ended', 'Engine stopped. The next prompt resumes the conversation.'))
        break
    }
  }

  private sessionStarted(event: Extract<SessionEvent, { type: 'session_started' }>): void {
    // A restart on the same model (a reconnect, a resumed turn) says nothing new; a switch
    // to another model is marked in the scrolling transcript, not only in the status line,
    // so a reader can tell after the fact which part of the conversation it produced (B13).
    if (this.currentModel !== undefined && this.currentModel !== event.model) this.insert(switchMarker(event))
    this.currentModel = event.model
    this.setStatus(`${event.model} · Claude Code ${event.engineVersion ?? ''}`.trim())
    // The engine is up, so what the turn waits on takes over from the start-up.
    if (this.activity) this.activity = this.currentActivity()
  }

  private userMessage(event: Extract<SessionEvent, { type: 'user_message' }>): void {
    this.resume?.remove()
    this.resume = undefined
    // What the extension sent on the person's behalf is named, not quoted; the host never passes its text on.
    if (event.label) this.insert(block('turn kickoff', event.label))
    else {
      const message = block('user', event.text, renderAnsi)
      message.appendChild(copyButton(() => event.text))
      this.insert(message)
    }
    this.activity = atWork(WAITING_ON_MODEL)
  }

  private toolCalled(event: Extract<SessionEvent, { type: 'tool_call' }>): void {
    // The question is put as a card, so its call and its result are not shown as a tool step.
    if (isQuestionTool(event.name)) {
      this.steps.markQuestionCall(event.toolUseId)
      return
    }
    const details = this.steps.call(event)
    this.insert(details, event.parentToolUseId)
    if (event.parentToolUseId) return
    this.steps.trackPending(event, details)
    this.activity = this.currentActivity()
  }

  private toolResulted(event: Extract<SessionEvent, { type: 'tool_result' }>): void {
    if (this.steps.isQuestionCall(event.toolUseId)) return
    this.steps.finishPending(event.toolUseId)
    this.cards.dropAnsweredPrompt(event.toolUseId)
    this.activity = this.currentActivity()
    this.steps.result(event, this.cards.isApprovedByHand(event.toolUseId), (element, parentToolUseId) => this.insert(element, parentToolUseId))
  }

  private statusChanged(event: Extract<SessionEvent, { type: 'status' }>): void {
    // 'idle' also arrives mid-turn (after compaction, between requests); only the turn's end clears the activity.
    // The row adds its own ellipsis to whatever phase it names.
    if (event.status === 'starting') this.activity = atWork(event.detail?.replace(/…$/, '') ?? STARTING)
    if (event.status === 'requesting') this.activity = atWork(WAITING_ON_MODEL)
    if (event.status === 'compacting') this.activity = atWork('Compacting context')
  }

  private errored(event: Extract<SessionEvent, { type: 'error' }>): void {
    const message = block(event.fatal ? 'error fatal' : 'error', event.message)
    if (event.resumable) this.offerResume(message)
    this.insert(message)
    if (event.fatal) this.activity = undefined
  }

  private offerResume(message: HTMLElement): void {
    this.resume?.remove()
    const button = document.createElement('button')
    button.className = 'resume'
    button.textContent = 'Resume'
    button.addEventListener('click', () => this.dispatchEvent(new PromptSubmittedEvent('Continue where you stopped.')))
    message.append(button)
    this.resume = button
  }

  /**
   * Who the turn is waiting on: the user while a card of theirs is open, else
   * the newest tool call still running, else the model.
   */
  private currentActivity(): Activity {
    const waiting = this.cards.waitingCards()
    if (waiting.some((card) => card instanceof PermissionCard)) return awaitingUser(NEEDS_APPROVAL)
    if (waiting.some((card) => card instanceof QuestionCard)) return awaitingUser(NEEDS_ANSWER)
    return atWork(this.steps.latestPending() ?? WAITING_ON_MODEL)
  }

  /** A pulsing row naming the current activity, with the time spent in it, kept last while the session is at work. */
  private showWorking(): void {
    this.workingRow.show(this, this.activity, () => this.revealOpenCard())
  }

  /**
   * Adds to the conversation, or to the step of the subagent it came from.
   * While a card waits on the person, what follows goes above it: calls made
   * alongside the one asked about would otherwise push the prompt out of sight
   * while the row below says the turn waits on it. A new card joins the
   * waiting ones in order, and unfolds the step it lands in: a prompt folded
   * away is a turn that waits on nothing anyone can see.
   */
  private insert(element: HTMLElement, parentToolUseId?: string): void {
    const container: HTMLElement = (parentToolUseId ? this.steps.step(parentToolUseId) : undefined) ?? this
    const isCard = element instanceof PermissionCard || element instanceof QuestionCard
    const waiting = isCard ? undefined : this.cards.waitingCards().find((card) => card.parentElement === container)
    if (waiting) container.insertBefore(element, waiting)
    else container.appendChild(element)
    if (isCard) for (let step = element.parentElement?.closest('details'); step; step = step.parentElement?.closest('details') ?? null) step.open = true
  }

  /** The waiting row points at what it waits on: the open card, its step unfolded, brought into view. */
  private revealOpenCard(): void {
    const card = this.openCard()
    if (!card) return
    for (let step = card.closest('details'); step; step = step.parentElement?.closest('details') ?? null) step.open = true
    card.scrollIntoView({ block: 'center' })
  }

  private setStatus(text: string): void {
    this.statusLine.textContent = text
    this.statusLine.hidden = text === ''
  }

  private scrollToEnd(): void {
    this.scrollHost.scrollTop = this.scrollHost.scrollHeight
  }
}

customElements.define('chat-transcript', ChatTranscript)
