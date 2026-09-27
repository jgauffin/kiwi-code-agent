import type { PlanState, RunRef, RunSection, ToWebview } from '../protocol'
import type { SessionEvent } from '../../agent/session/code-session'
import { onMessage, post } from './vscode-api'
import { ChatComposer } from './chat-composer'
import { ChatTranscript } from './chat-transcript'
import { NewSessionView } from './new-session-view'
import { PlanBar } from './plan-bar'
import { PlanTabs } from './plan-tabs'
import { PlanView } from './plan-view'
import { planStep, tabFor, type Step, type Tab } from './plan-step'
import { LinkedFilesRow } from './linked-files-row'
import { SessionTabs } from './session-tabs'
import {
  AllowWritesToggledEvent,
  CleanupDecidedEvent,
  CleanupStoppedEvent,
  DefaultProfileChangedEvent,
  ImplementRequestedEvent,
  InterruptRequestedEvent,
  LinkOpenFileRequestedEvent,
  McpReconnectRequestedEvent,
  NewSessionRequestedEvent,
  NewSessionViewRequestedEvent,
  PermissionDecidedEvent,
  PlanFocusRequestedEvent,
  PlanResumeRequestedEvent,
  PlanStepSelectedEvent,
  PlanViewSelectedEvent,
  PromptSubmittedEvent,
  QuestionAnsweredEvent,
  ReviewActionEvent,
  ReviewSubmittedEvent,
  RulingsSentEvent,
  SessionClosedEvent,
  SessionModelChangedEvent,
  SessionSelectedEvent,
  SpecApprovedEvent,
  SpecMapRequestedEvent,
  SpecMapStoppedEvent,
  SpecRemapRequestedEvent,
  SpecRepairRequestedEvent,
  SweepRequestedEvent,
  VerifyRequestedEvent,
  type PlanFocus,
  type ViewTab,
} from './events'

/** One run's section of the tab: the fold it sits in, and the conversation inside it. */
type RunSectionView = { details: HTMLDetailsElement; transcript: ChatTranscript }

/**
 * Root of the chat UI. Talks to the extension host; children talk to it
 * through events. Shows the new-session screen, or the active session: its
 * transcript, or in a feature session one tab of the plan or the transcript,
 * picked on the strip under the plan bar.
 */
export class ChatApp extends HTMLElement {
  private readonly tabs = new SessionTabs()
  private readonly planBar = new PlanBar()
  private readonly planTabs = new PlanTabs()
  private readonly planView = new PlanView()
  private readonly newSession = new NewSessionView()
  /** The tab's conversations, one section per run, oldest first; the current run's is the open one. */
  private readonly runs = document.createElement('div')
  private readonly sections = new Map<string, RunSectionView>()
  private readonly composer = new ChatComposer()
  private activeSessionId: string | undefined
  private creating = false
  private plan: PlanState | undefined
  private view: ViewTab = 'chat'
  /** The plan tab last shown, so leaving the chat comes back to it. */
  private planTab: Tab = 'spec'
  /** The step the plan tab was last chosen for; a new step opens its own tab, otherwise the reader's choice holds. */
  private step: Step | undefined
  /** The conversation moved on while another tab was open; its tab is marked until the reader goes there. */
  private chatMoved = false
  /** The row waiting for the host to name the open file. */
  private linkTarget: LinkedFilesRow | undefined

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.tabs.className = 'tabs'
    this.planBar.className = 'plan-bar'
    this.planBar.hidden = true
    this.planTabs.className = 'plan-tabs'
    this.planTabs.hidden = true
    this.planView.className = 'plan-view'
    this.planView.hidden = true
    this.newSession.className = 'new-session'
    this.runs.className = 'runs'
    this.composer.className = 'composer'
    this.append(this.tabs, this.planBar, this.planTabs, this.newSession, this.planView, this.runs, this.composer)

    this.addEventListener(SpecApprovedEvent.type, () => post({ type: 'approve_spec' }))
    this.addEventListener(RulingsSentEvent.type, () => post({ type: 'send_rulings' }))
    this.addEventListener(ReviewSubmittedEvent.type, () => post({ type: 'submit_review' }))
    this.addEventListener(ReviewActionEvent.type, (e) => post(e.action))
    this.addEventListener(PlanStepSelectedEvent.type, (e) => {
      if (this.plan) this.focusPlan(tabFor(e.step, this.plan))
    })
    this.addEventListener(PlanFocusRequestedEvent.type, (e) => this.focusPlan(e.tab, e.where))
    this.addEventListener(SpecMapRequestedEvent.type, () => post({ type: 'map_spec' }))
    this.addEventListener(SpecMapStoppedEvent.type, () => post({ type: 'stop_map' }))
    this.addEventListener(SpecRemapRequestedEvent.type, (e) => post({ type: 'redo_map', ...(e.note ? { note: e.note } : {}) }))
    this.addEventListener(CleanupStoppedEvent.type, () => post({ type: 'stop_cleanup' }))
    this.addEventListener(CleanupDecidedEvent.type, (e) => post({ type: 'cleanup_decision', decision: e.decision, ...(e.paths ? { paths: e.paths } : {}) }))
    this.addEventListener(SweepRequestedEvent.type, () => post({ type: 'sweep_sizes' }))
    this.addEventListener(SpecRepairRequestedEvent.type, () => post({ type: 'repair_spec' }))
    this.addEventListener(ImplementRequestedEvent.type, () => post({ type: 'implement_spec' }))
    this.addEventListener(VerifyRequestedEvent.type, () => post({ type: 'verify_spec' }))
    this.addEventListener(PlanViewSelectedEvent.type, (e) => this.show(e.view))

    this.addEventListener(PromptSubmittedEvent.type, (e) =>
      post({ type: 'send', text: e.text, ...(e.files.length > 0 ? { files: e.files } : {}) }),
    )
    this.addEventListener(LinkOpenFileRequestedEvent.type, (e) => {
      this.linkTarget = e.target instanceof LinkedFilesRow ? e.target : undefined
      post({ type: 'link_open_file' })
    })
    this.addEventListener(InterruptRequestedEvent.type, () => post({ type: 'interrupt' }))
    this.addEventListener(PermissionDecidedEvent.type, (e) => {
      const sessionId = this.runOf(e.target)
      if (sessionId) post({ type: 'permission', sessionId, requestId: e.requestId, decision: e.decision })
    })
    this.addEventListener(QuestionAnsweredEvent.type, (e) => {
      const sessionId = this.runOf(e.target)
      if (sessionId) post({ type: 'question', sessionId, requestId: e.requestId, outcome: e.outcome })
    })
    this.addEventListener(AllowWritesToggledEvent.type, (e) => post({ type: 'set_allow_writes', enabled: e.enabled }))
    this.addEventListener(SessionModelChangedEvent.type, (e) => post({ type: 'set_session_model', name: e.name }))
    this.addEventListener(McpReconnectRequestedEvent.type, (e) => post({ type: 'reconnect_mcp', server: e.server }))
    this.addEventListener(SessionSelectedEvent.type, (e) => {
      this.showCreating(false)
      post({ type: 'switch_session', sessionId: e.sessionId })
    })
    this.addEventListener(SessionClosedEvent.type, (e) => post({ type: 'close_session', sessionId: e.sessionId }))
    this.addEventListener(NewSessionViewRequestedEvent.type, () => this.showCreating(true))
    this.addEventListener(PlanResumeRequestedEvent.type, (e) => post({ type: 'resume_plan', feature: e.feature }))
    this.addEventListener(DefaultProfileChangedEvent.type, (e) => post({ type: 'set_default_profile', name: e.name }))
    this.addEventListener(NewSessionRequestedEvent.type, (e) =>
      post({
        type: 'new_session',
        mode: e.mode,
        ...(e.feature ? { feature: e.feature } : {}),
        ...(e.prompt ? { prompt: e.prompt } : {}),
        ...(e.files.length > 0 ? { files: e.files } : {}),
      }),
    )

    onMessage((message) => this.receive(message))
    post({ type: 'ready' })
  }

  private receive(message: ToWebview): void {
    switch (message.type) {
      case 'state': {
        const active = message.tabs.find((t) => t.active)
        this.activeSessionId = active?.id
        if (!active && !this.creating) this.showCreating(true)
        this.tabs.update(message.tabs, this.creating)
        this.newSession.update(message.plans, message.profiles)
        this.composer.setSwitches({
          allowWrites: message.allowWrites,
          mcp: message.mcp,
          model: active?.mode === 'chat' ? { current: active.profileName, options: message.models.map((m) => m.name) } : undefined,
        })
        this.plan = message.plan
        this.followStep()
        this.layout()
        break
      }
      case 'transcript':
        if (message.sessionId !== this.activeSessionId) return
        this.showCreating(false)
        this.drawRuns(message.runs)
        this.composer.setHeldByQuestion(this.anyOpenQuestion)
        // A spec that exists is what the session is about; the conversation is one click away.
        this.chatMoved = false
        this.show(this.plan?.body ? this.planTab : 'chat')
        this.composer.focusInput()
        break
      case 'event': {
        if (message.sessionId !== this.activeSessionId) return
        const section = this.sectionFor(message.run)
        section.transcript.apply(message.event)
        this.composer.setHeldByQuestion(this.anyOpenQuestion)
        // A run the reader has folded away still says that it moved, on its own header.
        if (!section.details.open) section.details.classList.add('moved')
        this.follow(message.event)
        break
      }
      case 'linked_file':
        // The answer belongs to the row that asked: the composer's, or the new-session card's.
        if (this.linkTarget?.isConnected) this.linkTarget.link(message.path)
        break
      case 'show_new_session':
        this.showCreating(true)
        break
    }
  }

  /**
   * The tab's runs as they came from the host: one section each, the current
   * one open and the ones before it folded away. They are separate
   * conversations kept in one place, so what the reader types reaches the
   * current run alone.
   */
  private drawRuns(runs: RunSection[]): void {
    this.runs.replaceChildren()
    this.sections.clear()
    for (const run of runs) this.sectionFor(run).transcript.reset(run.events)
  }

  private sectionFor(run: RunRef): RunSectionView {
    const existing = this.sections.get(run.sessionId)
    if (existing) {
      if (run.current) this.makeCurrent(existing)
      return existing
    }
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
    transcript.scrollHost = this.runs
    details.append(summary, transcript)
    this.runs.append(details)
    const section = { details, transcript }
    this.sections.set(run.sessionId, section)
    // A run that arrives while the tab is open is the newest: it takes the floor, and the one before it folds away.
    if (run.current || this.sections.size === 1) this.makeCurrent(section)
    return section
  }

  /** One section at a time is the conversation in play; the rest are history until the reader opens one. */
  private makeCurrent(current: RunSectionView): void {
    for (const section of this.sections.values()) {
      const isCurrent = section === current
      section.details.classList.toggle('current', isCurrent)
      if (isCurrent) {
        section.details.open = true
        section.details.classList.remove('moved')
      } else if (!section.details.classList.contains('moved')) section.details.open = false
    }
  }

  private get anyOpenQuestion(): boolean {
    return [...this.sections.values()].some((s) => s.transcript.hasOpenQuestion)
  }

  /** The run a card sits in: a tab holds several conversations, and only the one that asked can be answered. */
  private runOf(target: EventTarget | null): string | undefined {
    return target instanceof Element ? (target.closest<HTMLElement>('[data-session]')?.dataset.session ?? undefined) : undefined
  }

  /** The chat shows while the planner works; its finished spec takes over when the turn ends. */
  private follow(event: SessionEvent): void {
    if (!this.plan) return
    switch (event.type) {
      case 'assistant_text':
      case 'assistant_thinking':
      case 'assistant_message':
      case 'tool_call':
      case 'permission_request':
      // A question waits on the person, so the conversation it was asked in is what they are shown.
      case 'question_request':
      case 'error':
        this.chatWent()
        break
      case 'status':
        if (event.status !== 'idle') this.chatWent()
        break
      case 'turn_done':
        if (!event.isError) this.show(this.planTab)
        break
    }
  }

  /** A new step opens the tab it works in; while the step holds, the reader's own tab does. */
  private followStep(): void {
    if (!this.plan) {
      this.step = undefined
      return
    }
    const step = planStep(this.plan).current
    if (step === this.step) return
    this.step = step
    this.planTab = tabFor(step, this.plan)
    if (this.view !== 'chat') this.view = this.planTab
  }

  /** Reading the plan is not interrupted by the conversation: the chat tab is marked and the reader decides when to look. */
  private chatWent(): void {
    if (this.view === 'chat') return
    if (this.chatMoved) return
    this.chatMoved = true
    this.layout()
  }

  private show(view: ViewTab): void {
    this.view = view
    if (view !== 'chat') this.planTab = view
    else this.chatMoved = false
    this.layout()
  }

  /** A step, the bar's next-step link or a link between tabs opens a tab and lands somewhere on it; in the chat, on the card waiting for the person. */
  private focusPlan(tab: ViewTab, where: PlanFocus = {}): void {
    this.show(tab)
    if (tab !== 'chat') {
      this.planView.land(where)
      return
    }
    const card = [...this.sections.values()].map((s) => s.transcript.openCard()).find((c) => c !== undefined)
    if (!card) return
    const details = card.closest('details')
    if (details) details.open = true
    card.scrollIntoView?.({ block: 'center' })
  }

  private layout(): void {
    const plan = this.creating ? undefined : this.plan
    const planShown = this.view !== 'chat' && plan?.body !== undefined
    this.planView.hidden = !planShown
    this.runs.hidden = this.creating || planShown
    this.planBar.update(plan)
    this.planTabs.update(plan, planShown ? this.view : 'chat', this.chatMoved)
    this.planView.update(plan, this.planTab)
  }

  private showCreating(creating: boolean): void {
    this.creating = creating
    this.newSession.hidden = !creating
    this.composer.hidden = creating
    if (creating) this.newSession.reset()
    this.layout()
  }
}

customElements.define('chat-app', ChatApp)
