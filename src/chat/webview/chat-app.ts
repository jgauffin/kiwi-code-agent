import type { PlanState, RunControls, SessionTab, ToWebview } from '../protocol'
import type { SessionEvent } from '../../agent/session/code-session'
import { PHASE_LABEL, phaseOfRun, phaseOfStep, recipient, refusal, type ChatPhase } from '../phase-runs'
import { onMessage, post, rememberTab } from './vscode-api'
import { ChatComposer } from './chat-composer'
import { NewSessionView } from './new-session-view'
import { PlanBar } from './plan-bar'
import { PlanTabs } from './plan-tabs'
import { PlanView } from './plan-view'
import { SingleRunChat, TaskRunChat, type PhaseChat } from './phase-chat'
import { planStep, shownSteps, tabFor, type Step, type Tab } from './plan-step'
import { LinkedFilesRow } from './linked-files-row'
import type { ContextUsage } from './context-meter'
import {
  AllowWritesToggledEvent,
  ChatTargetChangedEvent,
  CleanupDecidedEvent,
  CleanupStoppedEvent,
  CompactRequestedEvent,
  ContinueInChatRequestedEvent,
  DefaultProfileChangedEvent,
  ImplementRequestedEvent,
  InterruptRequestedEvent,
  LinkOpenFileRequestedEvent,
  McpReconnectRequestedEvent,
  NewSessionRequestedEvent,
  PermissionDecidedEvent,
  PhaseProfileChangedEvent,
  PlanFocusRequestedEvent,
  PlanResumeRequestedEvent,
  PlanStepSelectedEvent,
  PlanViewSelectedEvent,
  PromptSubmittedEvent,
  QuestionAnsweredEvent,
  ReviewActionEvent,
  ReviewSubmittedEvent,
  RulingsSentEvent,
  SessionModelChangedEvent,
  SessionSelectedEvent,
  SpecApprovedEvent,
  SpecCheckRequestedEvent,
  SpecCheckStoppedEvent,
  SpecRepairRequestedEvent,
  SweepRequestedEvent,
  VerifyRequestedEvent,
  type PlanFocus,
  type ViewTab,
} from './events'

/**
 * Root of the chat UI, one editor tab's worth. Talks to the extension host;
 * children talk to it through events. Shows the new-session screen until a
 * session is started on the tab, then that session: its conversation, or in
 * a feature session one tab of the plan or the chat of the phase picked on
 * the stepper, which is the conversation what the person types reaches.
 */
export class ChatApp extends HTMLElement {
  private readonly planBar = new PlanBar()
  private readonly planTabs = new PlanTabs()
  private readonly planView = new PlanView()
  private readonly newSession = new NewSessionView()
  private readonly chats = new Map<ChatPhase, PhaseChat>([
    ['plan', new SingleRunChat('plan', 'The planner has not started.')],
    ['implement', new TaskRunChat()],
    ['verify', new SingleRunChat('verify', 'No fix run: the tests have not failed.')],
    ['cleanup', new SingleRunChat('cleanup', 'No cleanup has run. Pick files to split on the Cleanup tab.')],
    ['session', new SingleRunChat('session', '')],
  ])
  private readonly chatsHost = document.createElement('div')
  private readonly composer = new ChatComposer()
  /** The session this editor tab shows, absent while it shows the new-session screen. */
  private tabId: string | undefined
  private tab: SessionTab | undefined
  private models: string[] = []
  private creating = false
  private plan: PlanState | undefined
  /** Every run under the tab as the host last described it. */
  private runs: RunControls[] = []
  /** Every configured profile's name, for the plan bar's per-phase pickers (B1). */
  private profileNames: string[] = []
  private view: ViewTab = 'chat'
  /** The plan tab last shown, so leaving the chat comes back to it. */
  private planTab: Tab = 'spec'
  /** The step the flow is at as last seen; when it moves on, the pick moves with it. */
  private step: Step | undefined
  /** The step picked on the stepper; its phase's chat is shown and typed to. */
  private selected: Step | undefined
  /** The picked phase's conversation moved while a plan tab was open; the chat tab is marked until the reader goes there. */
  private chatMoved = false
  /** Phases whose chat moved while another was picked; their steps are marked. */
  private readonly movedPhases = new Set<ChatPhase>()
  /** The row waiting for the host to name the open file. */
  private linkTarget: LinkedFilesRow | undefined
  /** Each run's window as its engine last reported it; the composer shows the one of the run it reaches. */
  private readonly contextUsage = new Map<string, ContextUsage>()

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.planBar.className = 'plan-bar'
    this.planBar.hidden = true
    this.planTabs.className = 'plan-tabs'
    this.planTabs.hidden = true
    this.planView.className = 'plan-view'
    this.planView.hidden = true
    this.newSession.className = 'new-session'
    // Hidden until the host says the tab has no session: `creating` is false here, and the DOM has to agree.
    this.newSession.hidden = true
    this.chatsHost.className = 'chats'
    this.chatsHost.append(...this.chats.values())
    this.composer.className = 'composer'
    this.append(this.planBar, this.planTabs, this.newSession, this.planView, this.chatsHost, this.composer)

    this.addEventListener(SpecApprovedEvent.type, () => post({ type: 'approve_spec' }))
    this.addEventListener(RulingsSentEvent.type, () => post({ type: 'send_rulings' }))
    this.addEventListener(ReviewSubmittedEvent.type, () => post({ type: 'submit_review' }))
    this.addEventListener(ReviewActionEvent.type, (e) => post(e.action))
    this.addEventListener(PlanStepSelectedEvent.type, (e) => this.stepPicked(e.step))
    this.addEventListener(PlanFocusRequestedEvent.type, (e) => this.focusPlan(e.tab, e.where))
    this.addEventListener(SpecCheckRequestedEvent.type, () => post({ type: 'check_spec' }))
    this.addEventListener(SpecCheckStoppedEvent.type, () => post({ type: 'stop_check' }))
    this.addEventListener(CleanupStoppedEvent.type, () => post({ type: 'stop_cleanup' }))
    this.addEventListener(CleanupDecidedEvent.type, (e) => post({ type: 'cleanup_decision', decision: e.decision, ...(e.paths ? { paths: e.paths } : {}) }))
    this.addEventListener(SweepRequestedEvent.type, () => post({ type: 'sweep_sizes' }))
    this.addEventListener(SpecRepairRequestedEvent.type, () => post({ type: 'repair_spec' }))
    this.addEventListener(ImplementRequestedEvent.type, () => post({ type: 'implement_spec' }))
    this.addEventListener(VerifyRequestedEvent.type, () => post({ type: 'verify_spec' }))
    this.addEventListener(PlanViewSelectedEvent.type, (e) => this.show(e.view))
    this.addEventListener(ChatTargetChangedEvent.type, () => this.showTarget())

    this.addEventListener(PromptSubmittedEvent.type, (e) => {
      // A Resume button speaks for the run it sits under; the composer for the run the phase's chat talks to.
      const sessionId = this.runOf(e.target) ?? this.target()?.sessionId
      post({ type: 'send', text: e.text, ...(e.files.length > 0 ? { files: e.files } : {}), ...(sessionId ? { sessionId } : {}) })
    })
    this.addEventListener(LinkOpenFileRequestedEvent.type, (e) => {
      this.linkTarget = e.target instanceof LinkedFilesRow ? e.target : undefined
      post({ type: 'link_open_file' })
    })
    this.addEventListener(InterruptRequestedEvent.type, () => this.toTarget((sessionId) => post({ type: 'interrupt', sessionId })))
    this.addEventListener(CompactRequestedEvent.type, () => this.toTarget((sessionId) => post({ type: 'compact', sessionId })))
    this.addEventListener(PermissionDecidedEvent.type, (e) => {
      const sessionId = this.runOf(e.target)
      if (sessionId) post({ type: 'permission', sessionId, requestId: e.requestId, decision: e.decision })
    })
    this.addEventListener(QuestionAnsweredEvent.type, (e) => {
      const sessionId = this.runOf(e.target)
      if (sessionId) post({ type: 'question', sessionId, requestId: e.requestId, outcome: e.outcome })
    })
    this.addEventListener(AllowWritesToggledEvent.type, (e) => this.toTarget((sessionId) => post({ type: 'set_allow_writes', sessionId, enabled: e.enabled })))
    this.addEventListener(SessionModelChangedEvent.type, (e) => post({ type: 'set_session_model', name: e.name }))
    this.addEventListener(ContinueInChatRequestedEvent.type, () => post({ type: 'continue_in_chat' }))
    this.addEventListener(McpReconnectRequestedEvent.type, (e) => this.toTarget((sessionId) => post({ type: 'reconnect_mcp', sessionId, server: e.server })))
    this.addEventListener(SessionSelectedEvent.type, (e) => post({ type: 'switch_session', sessionId: e.sessionId }))
    this.addEventListener(PlanResumeRequestedEvent.type, (e) => post({ type: 'resume_plan', feature: e.feature }))
    this.addEventListener(DefaultProfileChangedEvent.type, (e) => post({ type: 'set_default_profile', name: e.name }))
    this.addEventListener(PhaseProfileChangedEvent.type, (e) => post({ type: 'set_phase_profile', step: e.step, ...(e.name ? { name: e.name } : {}) }))
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
        const tab = message.tab
        if (tab?.id !== this.tabId) {
          this.tabId = tab?.id
          rememberTab(this.tabId)
        }
        // What the tab shows follows what it is: a session, or no session yet.
        if ((tab === undefined) !== this.creating) this.showCreating(tab === undefined)
        this.newSession.update(message.profiles, { plans: message.plans, chats: message.chats, unfiled: message.unfiled })
        this.profileNames = message.profiles.names
        this.tab = tab
        this.models = message.models.map((m) => m.name)
        this.runs = message.runs
        this.plan = message.plan
        for (const [phase, chat] of this.chats) chat.update(this.runs.filter((r) => phaseOfRun(r) === phase))
        this.followStep()
        this.showTarget()
        this.layout()
        break
      }
      case 'transcript':
        if (message.sessionId !== this.tabId) return
        this.showCreating(false)
        for (const [phase, chat] of this.chats) chat.reset(message.runs.filter((r) => phaseOfRun(r) === phase))
        this.contextUsage.clear()
        for (const run of message.runs) {
          const last = [...run.events].reverse().find((e) => e.type === 'context_usage')
          if (last?.type === 'context_usage') {
            const { usedTokens, windowTokens, compactAtTokens } = last
            this.contextUsage.set(run.sessionId, { usedTokens, windowTokens, compactAtTokens })
          }
        }
        this.movedPhases.clear()
        // A spec that exists is what the session is about; the conversation is one click away.
        this.chatMoved = false
        this.show(this.plan?.body ? this.planTab : 'chat')
        this.showTarget()
        this.composer.focusInput()
        break
      case 'event': {
        if (message.sessionId !== this.tabId) return
        const phase = phaseOfRun(message.run)
        this.chats.get(phase)!.apply(message.run, message.event)
        if (message.event.type === 'context_usage') {
          const { usedTokens, windowTokens, compactAtTokens } = message.event
          this.contextUsage.set(message.run.sessionId, { usedTokens, windowTokens, compactAtTokens })
        }
        if (phase === this.phase()) this.follow(message.event)
        else if (speaks(message.event) && !this.movedPhases.has(phase)) {
          // Another phase's run spoke: its step is marked, and the chat the reader picked stays put.
          this.movedPhases.add(phase)
          this.layout()
        }
        this.showTarget()
        break
      }
      case 'linked_file':
        // The answer belongs to the row that asked: the composer's, or the new-session card's.
        if (this.linkTarget?.isConnected) this.linkTarget.link(message.path)
        break
    }
  }

  /** The phase whose chat is shown: the picked step's, or the one chat of a tab without a feature. */
  private phase(): ChatPhase {
    if (!this.plan) return 'session'
    return phaseOfStep(this.selected ?? planStep(this.plan).current)
  }

  private shownChat(): PhaseChat {
    return this.chats.get(this.phase())!
  }

  private target(): RunControls | undefined {
    return this.shownChat().target
  }

  /** A composer act for the run the phase's chat talks to; with none there is nobody to act on. */
  private toTarget(act: (sessionId: string) => void): void {
    const target = this.target()
    if (target) act(target.sessionId)
  }

  /** The composer names the run it reaches, and takes its switches, window and question hold from that run alone. */
  private showTarget(): void {
    const chat = this.shownChat()
    const target = chat.target
    const tab = this.tab
    this.composer.setTarget(target && this.plan ? recipient(target) : undefined, target ? refusal(target) : 'No conversation in this phase to talk to.')
    this.composer.setSwitches({
      allowWrites: target?.allowWrites,
      mcp: target?.mcp,
      // A chat session's model is its own to switch (B9); a feature's run names the profile its phase runs on
      // with no switch here — that lives on the plan bar, one per phase (E2).
      model: tab?.mode === 'chat' ? { current: tab.profileName, options: this.models } : target && this.plan ? { current: target.profileName } : undefined,
      continueInChat: tab?.mode === 'docs' || tab?.mode === 'code-plan',
      compactable: target?.live ?? false,
    })
    this.composer.setContext(target ? this.contextUsage.get(target.sessionId) : undefined)
    this.composer.setHeldByQuestion(chat.targetHasOpenQuestion)
  }

  /** The run a card sits in: a tab holds several conversations, and only the one that asked can be answered. */
  private runOf(target: EventTarget | null): string | undefined {
    return target instanceof Element ? (target.closest<HTMLElement>('[data-session]')?.dataset.session ?? undefined) : undefined
  }

  /** The chat shows while the phase's run works; the finished plan tab takes over when the turn ends. */
  private follow(event: SessionEvent): void {
    if (!this.plan) return
    if (speaks(event)) this.chatWent()
    else if (event.type === 'turn_done' && !event.isError) this.show(this.planTab)
  }

  /** A new step opens the tab it works in and picks its chat; while the step holds, the reader's own picks do. */
  private followStep(): void {
    if (!this.plan) {
      this.step = undefined
      this.selected = undefined
      return
    }
    const step = planStep(this.plan).current
    if (step === this.step) return
    this.step = step
    this.select(step)
    this.planTab = tabFor(step, this.plan)
    if (this.view !== 'chat') this.view = this.planTab
  }

  /** A step clicked on the stepper: its phase's chat is the one shown; on the chat that is all, elsewhere its tab opens. */
  private stepPicked(step: Step): void {
    if (!this.plan) return
    this.select(step)
    if (this.view === 'chat') this.layout()
    else this.focusPlan(tabFor(step, this.plan))
  }

  private select(step: Step): void {
    const before = this.phase()
    this.selected = step
    const after = this.phase()
    if (after !== before) {
      this.chats.get(before)!.leave()
      this.chats.get(after)!.enter()
      this.chatMoved = false
    }
    this.movedPhases.delete(after)
    this.showTarget()
  }

  /** Reading the plan is not interrupted by the conversation: the chat tab is marked and the reader decides when to look. */
  private chatWent(): void {
    if (this.view === 'chat') return
    if (this.chatMoved) return
    this.chatMoved = true
    this.layout()
  }

  private show(view: ViewTab): void {
    const opening = view === 'chat' && this.view !== 'chat'
    this.view = view
    if (view !== 'chat') this.planTab = view
    else this.chatMoved = false
    this.layout()
    if (opening) this.shownChat().enter()
  }

  /**
   * A step, the bar's next-step link or a link between tabs opens a tab and
   * lands somewhere on it; in the chat, on the card waiting for the person,
   * in whichever phase's chat it sits.
   */
  private focusPlan(tab: ViewTab, where: PlanFocus = {}): void {
    if (tab === 'chat' && this.plan) {
      const holder = [...this.chats.values()].find((c) => c.hasOpenCard)
      if (holder && holder.phase !== this.phase()) this.select(stepOf(holder.phase, this.plan))
    }
    this.show(tab)
    if (tab !== 'chat') {
      this.planView.land(where)
      return
    }
    this.shownChat().revealOpenCard()?.scrollIntoView?.({ block: 'center' })
  }

  private layout(): void {
    const plan = this.creating ? undefined : this.plan
    const planShown = this.view !== 'chat' && plan?.body !== undefined
    const phase = this.phase()
    this.planView.hidden = !planShown
    this.chatsHost.hidden = this.creating || planShown
    for (const [p, chat] of this.chats) chat.hidden = p !== phase
    const moved = plan ? [...this.movedPhases].map((p) => stepOf(p, plan)) : []
    this.planBar.update(plan, this.profileNames, { ...(this.selected ? { selected: this.selected } : {}), moved })
    this.planTabs.update(plan, planShown ? this.view : 'chat', this.chatMoved, `Chat · ${PHASE_LABEL[phase]}`)
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

/** Something the reader would want to see: the run is at work or waits on them. */
function speaks(event: SessionEvent): boolean {
  switch (event.type) {
    case 'assistant_text':
    case 'assistant_thinking':
    case 'assistant_message':
    case 'tool_call':
    case 'permission_request':
    // A question waits on the person, so the conversation it was asked in is what they are shown.
    case 'question_request':
    case 'error':
      return true
    case 'status':
      return event.status !== 'idle'
    default:
      return false
  }
}

/** The step that stands for a phase: the one the flow is at when it is that phase's, else the first of it on the stepper. */
function stepOf(phase: ChatPhase, plan: PlanState): Step {
  const current = planStep(plan).current
  if (phaseOfStep(current) === phase) return current
  return shownSteps(plan).find((s) => phaseOfStep(s) === phase) ?? current
}

customElements.define('chat-app', ChatApp)
