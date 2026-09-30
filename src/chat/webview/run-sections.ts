import type { RunRef, RunSection } from '../protocol'
import type { SessionEvent } from '../../agent/session/code-session'
import { ChatTranscript } from './chat-transcript'

type Section = { details: HTMLDetailsElement; transcript: ChatTranscript }

/**
 * A phase's conversations, one fold per run, oldest first. The run typed to
 * is open and marked; the rest fold away when that changes and stay as the
 * reader leaves them while it holds. `only` hides the rest instead, for a
 * phase that shows one conversation at a time.
 */
export class RunSections extends HTMLElement {
  private readonly sections = new Map<string, Section>()
  private target: string | undefined
  private only = false

  reset(runs: RunSection[]): void {
    this.replaceChildren()
    this.sections.clear()
    for (const run of runs) this.sectionFor(run).transcript.reset(run.events)
    this.arrange(true)
  }

  apply(run: RunRef, event: SessionEvent): void {
    const section = this.sectionFor(run)
    section.transcript.apply(event)
    // A run the reader has folded away still says that it moved, on its own header.
    if (!section.details.open) section.details.classList.add('moved')
  }

  get isEmpty(): boolean {
    return this.sections.size === 0
  }

  /** The run typed to; its fold opens, and the others fold away when it changed. */
  point(target: string | undefined, only: boolean): void {
    const changed = target !== this.target || only !== this.only
    this.target = target
    this.only = only
    this.arrange(changed)
  }

  /** Coming back to the chat shows the run typed to and folds the rest, whatever the reader left open. */
  foldToTarget(): void {
    for (const [id, section] of this.sections) {
      section.details.classList.remove('moved')
      section.details.open = id === this.target
    }
  }

  /** A card waiting on the person, and the run it sits in. */
  openCard(): { sessionId: string; card: HTMLElement } | undefined {
    for (const [sessionId, section] of this.sections) {
      const card = section.transcript.openCard()
      if (card) return { sessionId, card }
    }
    return undefined
  }

  hasOpenQuestion(sessionId: string): boolean {
    return this.sections.get(sessionId)?.transcript.hasOpenQuestion ?? false
  }

  private arrange(refold: boolean): void {
    for (const [id, section] of this.sections) {
      const isTarget = id === this.target
      section.details.classList.toggle('current', isTarget)
      section.details.hidden = this.only && !isTarget
      if (isTarget) {
        section.details.open = true
        section.details.classList.remove('moved')
      } else if (refold && !section.details.classList.contains('moved')) section.details.open = false
    }
  }

  private sectionFor(run: RunRef): Section {
    const existing = this.sections.get(run.sessionId)
    if (existing) return existing
    const details = document.createElement('details')
    details.className = 'run'
    details.dataset.session = run.sessionId
    const summary = document.createElement('summary')
    summary.className = 'run-head'
    summary.textContent = run.title
    details.addEventListener('toggle', () => {
      if (details.open) details.classList.remove('moved')
    })
    const transcript = new ChatTranscript()
    transcript.className = 'transcript'
    transcript.scrollHost = this
    details.append(summary, transcript)
    this.append(details)
    const section = { details, transcript }
    this.sections.set(run.sessionId, section)
    this.arrange(false)
    return section
  }
}

customElements.define('run-sections', RunSections)
