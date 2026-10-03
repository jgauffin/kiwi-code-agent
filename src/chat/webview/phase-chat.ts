import type { RunControls, RunRef, RunSection } from '../protocol'
import type { SessionEvent } from '../../agent/session/code-session'
import { defaultTarget, type ChatPhase } from '../phase-runs'
import { el } from './dom'
import { ChatTargetChangedEvent } from './events'
import { RunSections } from './run-sections'

/**
 * One phase's chat: the conversations of its runs and the one of them the
 * composer reaches. The tab keeps one per phase and shows the one the step
 * picked on the stepper belongs to.
 */
export interface PhaseChat extends HTMLElement {
  readonly phase: ChatPhase
  /** The run what the person types reaches; undefined while the phase has none. */
  readonly target: RunControls | undefined
  readonly targetHasOpenQuestion: boolean
  /** The phase's runs as the host last described them, oldest first. */
  update(runs: RunControls[]): void
  reset(runs: RunSection[]): void
  apply(run: RunRef, event: SessionEvent): void
  /** A card waiting on the person, made visible; undefined when none waits. */
  revealOpenCard(): HTMLElement | undefined
  readonly hasOpenCard: boolean
  /** The chat is shown again: the run typed to is the one open. */
  enter(): void
  /** Another phase is picked. */
  leave(): void
}

/** A run known from its conversation before the host described it: it has just started. */
const described = (run: RunRef, runs: RunControls[]): RunControls =>
  runs.find((r) => r.sessionId === run.sessionId) ?? { ...run, profileName: '', live: true, settled: false }

const withRun = (runs: RunControls[], run: RunRef): RunControls[] => (runs.some((r) => r.sessionId === run.sessionId) ? runs : [...runs, described(run, runs)])

/**
 * The runs of one phase and their conversations: the runs as the host
 * described them, the fold each one speaks in, and the line standing in while
 * the phase has none. Which run is typed to is the chat's own rule, so it is
 * asked for; `only` hides every conversation but that one, for a phase that
 * shows one at a time.
 */
class RunConversations {
  private readonly sections = new RunSections()
  private readonly empty: HTMLElement
  private known: RunControls[] = []

  constructor(
    private readonly chooseTarget: (runs: RunControls[]) => RunControls | undefined,
    emptyText: string,
    private readonly only = false,
  ) {
    this.sections.className = 'runs'
    this.empty = el('p', 'empty', emptyText)
  }

  /** In the order the chat lays them out, around whatever chrome it adds of its own. */
  get elements(): HTMLElement[] {
    return [this.empty, this.sections]
  }

  get runs(): RunControls[] {
    return this.known
  }

  get target(): RunControls | undefined {
    return this.chooseTarget(this.known)
  }

  get targetHasOpenQuestion(): boolean {
    const target = this.target
    return target !== undefined && this.sections.hasOpenQuestion(target.sessionId)
  }

  openCard(): { sessionId: string; card: HTMLElement } | undefined {
    return this.sections.openCard()
  }

  update(runs: RunControls[]): void {
    this.known = runs
    this.refresh()
  }

  reset(runs: RunSection[]): void {
    this.sections.reset(runs)
    for (const run of runs) this.known = withRun(this.known, run)
    this.refresh()
  }

  apply(run: RunRef, event: SessionEvent): void {
    this.known = withRun(this.known, run)
    this.sections.apply(run, event)
    this.refresh()
  }

  foldToTarget(): void {
    this.sections.foldToTarget()
  }

  refresh(): void {
    this.sections.point(this.target?.sessionId, this.only)
    this.empty.hidden = !this.sections.isEmpty
  }
}

/**
 * A phase spoken with one run at a time: the planner (the checks folded in
 * beside it), the newest fix run, the cleanup, or a tab's only session.
 * Earlier runs of the phase stay folded above as history.
 */
export class SingleRunChat extends HTMLElement implements PhaseChat {
  private readonly conversations: RunConversations

  /** `head` stands above the conversations: what the phase did that no run says, such as the test run Verify shows. */
  constructor(
    readonly phase: ChatPhase,
    emptyText: string,
    private readonly head?: HTMLElement,
  ) {
    super()
    this.conversations = new RunConversations((runs) => defaultTarget(phase, runs), emptyText)
  }

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.className = 'phase-chat'
    this.dataset.phase = this.phase
    if (this.head) this.append(this.head)
    this.append(...this.conversations.elements)
    this.conversations.refresh()
  }

  get target(): RunControls | undefined {
    return this.conversations.target
  }

  get targetHasOpenQuestion(): boolean {
    return this.conversations.targetHasOpenQuestion
  }

  get hasOpenCard(): boolean {
    return this.conversations.openCard() !== undefined
  }

  update(runs: RunControls[]): void {
    this.conversations.update(runs)
  }

  reset(runs: RunSection[]): void {
    this.conversations.reset(runs)
  }

  apply(run: RunRef, event: SessionEvent): void {
    this.conversations.apply(run, event)
  }

  revealOpenCard(): HTMLElement | undefined {
    const found = this.conversations.openCard()
    const details = found?.card.closest('details')
    if (details) details.open = true
    return found?.card
  }

  enter(): void {
    this.conversations.foldToTarget()
  }

  leave(): void {}
}

/**
 * The build: one run per task. The switcher names every task run and marks
 * the one building, and only the picked run's conversation shows, so what the
 * person types can only be for that task. A pick holds until the reader picks
 * again or leaves the phase; with none, the task being built is shown, so a
 * task run starting never takes the conversation from a run the reader chose.
 */
export class TaskRunChat extends HTMLElement implements PhaseChat {
  readonly phase = 'implement'
  private readonly switcher = el('div', 'run-switch')
  private readonly conversations = new RunConversations((runs) => runs.find((r) => r.sessionId === this.picked) ?? defaultTarget(this.phase, runs), 'No task has started.', true)
  private picked: string | undefined

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.className = 'phase-chat task-chat'
    this.dataset.phase = this.phase
    this.append(this.switcher, ...this.conversations.elements)
    this.refresh()
  }

  get target(): RunControls | undefined {
    return this.conversations.target
  }

  get targetHasOpenQuestion(): boolean {
    return this.conversations.targetHasOpenQuestion
  }

  get hasOpenCard(): boolean {
    return this.conversations.openCard() !== undefined
  }

  update(runs: RunControls[]): void {
    this.conversations.update(runs)
    this.drawSwitcher()
  }

  reset(runs: RunSection[]): void {
    this.conversations.reset(runs)
    this.drawSwitcher()
  }

  apply(run: RunRef, event: SessionEvent): void {
    this.conversations.apply(run, event)
    this.drawSwitcher()
  }

  /** The task whose run asks is picked, so its card is the one in sight. */
  revealOpenCard(): HTMLElement | undefined {
    const found = this.conversations.openCard()
    if (found && found.sessionId !== this.target?.sessionId) this.pick(found.sessionId)
    return found?.card
  }

  enter(): void {
    this.conversations.foldToTarget()
  }

  leave(): void {
    this.picked = undefined
    this.refresh()
  }

  private pick(sessionId: string): void {
    this.picked = sessionId
    this.refresh()
    this.dispatchEvent(new ChatTargetChangedEvent())
  }

  private refresh(): void {
    this.conversations.refresh()
    this.drawSwitcher()
  }

  private drawSwitcher(): void {
    const target = this.target?.sessionId
    const runs = this.conversations.runs
    this.switcher.hidden = runs.length === 0
    this.switcher.replaceChildren(...runs.map((run) => this.switchButton(run, run.sessionId === target)))
  }

  private switchButton(run: RunControls, picked: boolean): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.session = run.sessionId
    button.className = `task${picked ? ' selected' : ''}${run.live ? ' building' : ''}${run.settled ? ' settled' : ''}`
    button.setAttribute('aria-pressed', String(picked))
    const state = run.live ? ' · building' : run.settled ? ' · done' : ''
    button.textContent = `${run.task ?? run.title}${state}`
    button.title = `Show the conversation of ${run.task !== undefined ? `task ${run.task}` : run.title} and talk to it.`
    button.addEventListener('click', () => this.pick(run.sessionId))
    return button
  }
}

customElements.define('single-run-chat', SingleRunChat)
customElements.define('task-run-chat', TaskRunChat)
