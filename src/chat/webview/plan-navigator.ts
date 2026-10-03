import type { SessionEvent } from '../../agent/session/code-session'
import { PHASE_LABEL, phaseOfStep, type ChatPhase } from '../phase-runs'
import type { PlanState, RunControls } from '../protocol'
import type { PlanFocus, ViewTab } from './events'
import type { PhaseChat } from './phase-chat'
import type { PlanBar } from './plan-bar'
import { planStep, shownSteps, tabFor, type Step, type Tab } from './plan-step'
import type { PlanTabs } from './plan-tabs'
import type { PlanView } from './plan-view'

/**
 * Which chat and which plan tab is shown, and how a run's event moves them:
 * split out of `ChatApp` since it is the one part of it that reaches into
 * nearly all of the component's state on its own. `showTarget` is a callback
 * into the composer, which this does not otherwise reach.
 */
export class PlanNavigator {
  plan: PlanState | undefined
  creating = false
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

  constructor(
    private readonly chats: Map<ChatPhase, PhaseChat>,
    private readonly planBar: PlanBar,
    private readonly planTabs: PlanTabs,
    private readonly planView: PlanView,
    private readonly chatsHost: HTMLElement,
    private readonly showTarget: () => void,
  ) {}

  /** The plan tab last shown; read once a fresh transcript decides whether to land on it or on the chat. */
  shownPlanTab(): Tab {
    return this.planTab
  }

  /** A fresh transcript starts clean: nothing has moved while the reader was away from it. */
  clearMoved(): void {
    this.movedPhases.clear()
    this.chatMoved = false
  }

  /** Another phase's run spoke: its step is marked, and the chat the reader picked stays put. */
  noteOtherPhaseSpoke(phase: ChatPhase): void {
    if (this.movedPhases.has(phase)) return
    this.movedPhases.add(phase)
    this.layout()
  }

  /** The phase whose chat is shown: the picked step's, or the one chat of a tab without a feature. */
  phase(): ChatPhase {
    if (!this.plan) return 'session'
    return phaseOfStep(this.selected ?? planStep(this.plan).current)
  }

  shownChat(): PhaseChat {
    return this.chats.get(this.phase())!
  }

  target(): RunControls | undefined {
    return this.shownChat().target
  }

  /** A composer act for the run the phase's chat talks to; with none there is nobody to act on. */
  toTarget(act: (sessionId: string) => void): void {
    const target = this.target()
    if (target) act(target.sessionId)
  }

  /** The chat shows while the phase's run works; the finished plan tab takes over when the turn ends. */
  follow(event: SessionEvent): void {
    if (!this.plan) return
    if (speaks(event)) this.chatWent()
    else if (event.type === 'turn_done' && !event.isError) this.show(this.planTab)
  }

  /** A new step picks its chat, and opens the tab it works in for a reader who stayed on the last step's; while the step holds, the reader's own picks do. */
  followStep(): void {
    if (!this.plan) {
      this.step = undefined
      this.selected = undefined
      return
    }
    const step = planStep(this.plan).current
    if (step === this.step) return
    // A reader who went to another tab is reading it: only one still on the step's own tab is carried to the next step's.
    const carried = this.step === undefined || this.planTab === tabFor(this.step, this.plan)
    this.step = step
    this.select(step)
    if (!carried) return
    this.planTab = tabFor(step, this.plan)
    if (this.view !== 'chat') this.view = this.planTab
  }

  /** A step clicked on the stepper: its phase's chat is the one shown; on the chat that is all, elsewhere its tab opens. */
  stepPicked(step: Step): void {
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

  show(view: ViewTab): void {
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
  focusPlan(tab: ViewTab, where: PlanFocus = {}): void {
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

  layout(): void {
    const plan = this.creating ? undefined : this.plan
    const planShown = this.view !== 'chat' && plan?.body !== undefined
    const phase = this.phase()
    this.planView.hidden = !planShown
    this.chatsHost.hidden = this.creating || planShown
    for (const [p, chat] of this.chats) chat.hidden = p !== phase
    const moved = plan ? [...this.movedPhases].map((p) => stepOf(p, plan)) : []
    this.planBar.update(plan, { ...(this.selected ? { selected: this.selected } : {}), moved })
    this.planTabs.update(plan, planShown ? this.view : 'chat', this.chatMoved, `Chat · ${PHASE_LABEL[phase]}`)
    this.planView.update(plan, this.planTab)
  }
}

/** Something the reader would want to see: the run is at work or waits on them. */
export function speaks(event: SessionEvent): boolean {
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
