import type { ModelOption, RunControls, SessionTab, ToWebview } from '../protocol'
import type { SessionEvent } from '../../agent/session/code-session'
import { phaseOfRun, recipient, refusal, type ChatPhase } from '../phase-runs'
import { onMessage, post, rememberTab } from './vscode-api'
import { ChatComposer } from './chat-composer'
import { NewSessionView } from './new-session-view'
import { PlanBar } from './plan-bar'
import { PlanTabs } from './plan-tabs'
import { PlanView } from './plan-view'
import { SingleRunChat, TaskRunChat, type PhaseChat } from './phase-chat'
import { TestRunView } from './test-run-view'
import type { Step } from './plan-step'
import { LinkedFilesRow } from './linked-files-row'
import { AgentsMdOverlay } from './agents-md-overlay'
import type { ContextUsage } from './context-meter'
import { wireChatEvents } from './chat-app-events'
import { PlanNavigator, speaks } from './plan-navigator'
import type { PlanFocus, ViewTab } from './events'

/**
 * Root of the chat UI in the sidebar view. Talks to the extension host;
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
  private readonly testRun = new TestRunView()
  private readonly chats = new Map<ChatPhase, PhaseChat>([
    ['plan', new SingleRunChat('plan', 'The planner has not started.')],
    ['implement', new TaskRunChat()],
    ['verify', new SingleRunChat('verify', 'No fix run: no test run has failed.', this.testRun)],
    ['cleanup', new SingleRunChat('cleanup', 'No cleanup has run. Pick files to split on the Cleanup tab.')],
    ['session', new SingleRunChat('session', '')],
  ])
  private readonly chatsHost = document.createElement('div')
  private readonly nav = new PlanNavigator(this.chats, this.planBar, this.planTabs, this.planView, this.chatsHost, () => this.showTarget())
  private readonly composer = new ChatComposer()
  private readonly agentsMd = new AgentsMdOverlay()
  /** The session the view shows, absent while it shows the new-session screen. */
  private tabId: string | undefined
  private tab: SessionTab | undefined
  private models: ModelOption[] = []
  /** Every run under the tab as the host last described it. */
  private runs: RunControls[] = []
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
    this.append(this.planBar, this.planTabs, this.newSession, this.planView, this.chatsHost, this.composer, this.agentsMd)

    wireChatEvents(this, {
      stepPicked: (step) => this.stepPicked(step),
      focusPlan: (tab, where) => this.focusPlan(tab, where),
      show: (view) => this.show(view),
      showTarget: () => this.showTarget(),
      toTarget: (act) => this.toTarget(act),
      target: () => this.target(),
      setLinkTarget: (target) => {
        this.linkTarget = target
      },
    })

    onMessage((message) => this.receive(message))
    post({ type: 'ready' })
  }

  private receive(message: ToWebview): void {
    switch (message.type) {
      case 'state':
        this.receiveState(message)
        break
      case 'transcript':
        this.receiveTranscript(message)
        break
      case 'event':
        this.receiveEvent(message)
        break
      case 'linked_file':
        // The answer belongs to the row that asked: the composer's, or the new-session card's.
        if (this.linkTarget?.isConnected) this.linkTarget.link(message.path)
        break
    }
  }

  private receiveState(message: Extract<ToWebview, { type: 'state' }>): void {
    const tab = message.tab
    if (tab?.id !== this.tabId) {
      this.tabId = tab?.id
      rememberTab(this.tabId)
    }
    // What the tab shows follows what it is: a session, or no session yet.
    if ((tab === undefined) !== this.nav.creating) this.showCreating(tab === undefined)
    this.newSession.update(message.profiles, { plans: message.plans, chats: message.chats, unfiled: message.unfiled })
    this.tab = tab
    this.models = message.models
    this.runs = message.runs
    this.nav.plan = message.plan
    this.testRun.update(this.nav.plan)
    this.agentsMd.show(message.agentsMd)
    for (const [phase, chat] of this.chats) chat.update(this.runs.filter((r) => phaseOfRun(r) === phase))
    this.followStep()
    this.showTarget()
    this.layout()
  }

  private receiveTranscript(message: Extract<ToWebview, { type: 'transcript' }>): void {
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
    // A spec that exists is what the session is about; the conversation is one click away.
    this.nav.clearMoved()
    this.show(this.nav.plan?.body ? this.nav.shownPlanTab() : 'chat')
    this.showTarget()
    this.composer.focusInput()
  }

  private receiveEvent(message: Extract<ToWebview, { type: 'event' }>): void {
    if (message.sessionId !== this.tabId) return
    const phase = phaseOfRun(message.run)
    this.chats.get(phase)!.apply(message.run, message.event)
    if (message.event.type === 'context_usage') {
      const { usedTokens, windowTokens, compactAtTokens } = message.event
      this.contextUsage.set(message.run.sessionId, { usedTokens, windowTokens, compactAtTokens })
    }
    if (phase === this.phase()) this.follow(message.event)
    else if (speaks(message.event)) this.nav.noteOtherPhaseSpoke(phase)
    this.showTarget()
  }

  /** The phase whose chat is shown: the picked step's, or the one chat of a tab without a feature. */
  private phase(): ChatPhase {
    return this.nav.phase()
  }

  private shownChat(): PhaseChat {
    return this.nav.shownChat()
  }

  private target(): RunControls | undefined {
    return this.nav.target()
  }

  /** A composer act for the run the phase's chat talks to; with none there is nobody to act on. */
  private toTarget(act: (sessionId: string) => void): void {
    this.nav.toTarget(act)
  }

  /** The composer names the run it reaches, and takes its switches, window and question hold from that run alone. */
  private showTarget(): void {
    const chat = this.shownChat()
    const target = chat.target
    const tab = this.tab
    this.composer.setTarget(target && this.nav.plan ? recipient(target) : undefined, target ? refusal(target) : 'No conversation in this phase to talk to.')
    this.composer.setSwitches(switchesFor(target, tab, this.models, this.nav.plan !== undefined))
    this.composer.setContext(target ? this.contextUsage.get(target.sessionId) : undefined)
    this.composer.setHeldByQuestion(chat.targetHasOpenQuestion)
  }

  /** The chat shows while the phase's run works; the finished plan tab takes over when the turn ends. */
  private follow(event: SessionEvent): void {
    this.nav.follow(event)
  }

  /** A new step picks its chat, and opens the tab it works in for a reader who stayed on the last step's; while the step holds, the reader's own picks do. */
  private followStep(): void {
    this.nav.followStep()
  }

  /** A step clicked on the stepper: its phase's chat is the one shown; on the chat that is all, elsewhere its tab opens. */
  private stepPicked(step: Step): void {
    this.nav.stepPicked(step)
  }

  private show(view: ViewTab): void {
    this.nav.show(view)
  }

  /**
   * A step, the bar's next-step link or a link between tabs opens a tab and
   * lands somewhere on it; in the chat, on the card waiting for the person,
   * in whichever phase's chat it sits.
   */
  private focusPlan(tab: ViewTab, where?: PlanFocus): void {
    this.nav.focusPlan(tab, where)
  }

  private layout(): void {
    this.nav.layout()
  }

  private showCreating(creating: boolean): void {
    this.nav.creating = creating
    this.newSession.hidden = !creating
    this.composer.hidden = creating
    if (creating) this.newSession.reset()
    this.layout()
  }
}

/**
 * The composer's switches for the run its chat talks to: a chat session's
 * model is its own to switch (B9), as is one granted full access; a
 * feature's run names the profile its phase runs on with no switch here —
 * that lives on the plan bar, one per phase (E2). `hasPlan` is whether the
 * tab is a feature's, since only then does a run's own model switch show.
 */
function switchesFor(target: RunControls | undefined, tab: SessionTab | undefined, models: ModelOption[], hasPlan: boolean) {
  return {
    allowWrites: target?.allowWrites,
    mcp: target?.mcp,
    model:
      tab?.mode === 'chat' || tab?.access === 'full'
        ? {
            current: tab.profileName,
            options: models.map((m) => m.name),
            efforts: models.find((m) => m.name === tab.profileName)?.efforts ?? [],
            ...(tab.effort ? { effort: tab.effort } : {}),
          }
        : target && hasPlan
          ? { current: target.profileName, ...(target.effort ? { effort: target.effort } : {}) }
          : undefined,
    // Only a code plan waits on an approval, and it is the only session that is granted full access.
    approvePlan: tab?.mode === 'code-plan' && tab.access === 'scoped',
    compactable: target?.live ?? false,
  }
}

customElements.define('chat-app', ChatApp)
