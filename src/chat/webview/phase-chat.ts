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
 * A phase spoken with one run at a time: the planner (the checks folded in
 * beside it), the newest fix run, the cleanup, or a tab's only session.
 * Earlier runs of the phase stay folded above as history.
 */
export class SingleRunChat extends HTMLElement implements PhaseChat {
  private readonly sections = new RunSections()
  private readonly empty: HTMLElement
  private runs: RunControls[] = []

  constructor(
    readonly phase: ChatPhase,
    emptyText: string,
  ) {
    super()
    this.empty = el('p', 'empty', emptyText)
  }

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.className = 'phase-chat'
    this.dataset.phase = this.phase
    this.sections.className = 'runs'
    this.append(this.empty, this.sections)
    this.refresh()
  }

  get target(): RunControls | undefined {
    return defaultTarget(this.phase, this.runs)
  }

  get targetHasOpenQuestion(): boolean {
    const target = this.target
    return target !== undefined && this.sections.hasOpenQuestion(target.sessionId)
  }

  get hasOpenCard(): boolean {
    return this.sections.openCard() !== undefined
  }

  update(runs: RunControls[]): void {
    this.runs = runs
    this.refresh()
  }

  reset(runs: RunSection[]): void {
    this.sections.reset(runs)
    for (const run of runs) this.runs = withRun(this.runs, run)
    this.refresh()
  }

  apply(run: RunRef, event: SessionEvent): void {
    this.runs = withRun(this.runs, run)
    this.sections.apply(run, event)
    this.refresh()
  }

  revealOpenCard(): HTMLElement | undefined {
    const found = this.sections.openCard()
    const details = found?.card.closest('details')
    if (details) details.open = true
    return found?.card
  }

  enter(): void {
    this.sections.foldToTarget()
  }

  leave(): void {}

  private refresh(): void {
    this.sections.point(this.target?.sessionId, false)
    this.empty.hidden = !this.sections.isEmpty
  }
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
  private readonly sections = new RunSections()
  private readonly empty = el('p', 'empty', 'No task has started.')
  private runs: RunControls[] = []
  private picked: string | undefined

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.className = 'phase-chat task-chat'
    this.dataset.phase = this.phase
    this.sections.className = 'runs'
    this.append(this.switcher, this.empty, this.sections)
    this.refresh()
  }

  get target(): RunControls | undefined {
    return this.runs.find((r) => r.sessionId === this.picked) ?? defaultTarget(this.phase, this.runs)
  }

  get targetHasOpenQuestion(): boolean {
    const target = this.target
    return target !== undefined && this.sections.hasOpenQuestion(target.sessionId)
  }

  get hasOpenCard(): boolean {
    return this.sections.openCard() !== undefined
  }

  update(runs: RunControls[]): void {
    this.runs = runs
    this.refresh()
  }

  reset(runs: RunSection[]): void {
    this.sections.reset(runs)
    for (const run of runs) this.runs = withRun(this.runs, run)
    this.refresh()
  }

  apply(run: RunRef, event: SessionEvent): void {
    this.runs = withRun(this.runs, run)
    this.sections.apply(run, event)
    this.refresh()
  }

  /** The task whose run asks is picked, so its card is the one in sight. */
  revealOpenCard(): HTMLElement | undefined {
    const found = this.sections.openCard()
    if (found && found.sessionId !== this.target?.sessionId) this.pick(found.sessionId)
    return found?.card
  }

  enter(): void {
    this.sections.foldToTarget()
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
    const target = this.target?.sessionId
    this.sections.point(target, true)
    this.empty.hidden = !this.sections.isEmpty
    this.switcher.hidden = this.runs.length === 0
    this.switcher.replaceChildren(...this.runs.map((run) => this.switchButton(run, run.sessionId === target)))
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
