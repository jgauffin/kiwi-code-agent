import type { PhaseProfileState, PlanState } from '../protocol'
import { el } from './dom'
import {
  CleanupStoppedEvent,
  ImplementRequestedEvent,
  PhaseProfileChangedEvent,
  PlanFocusRequestedEvent,
  PlanStepSelectedEvent,
  ReviewSubmittedEvent,
  RulingsSentEvent,
  SpecApprovedEvent,
  SpecCheckRequestedEvent,
  SpecCheckStoppedEvent,
  SpecRepairRequestedEvent,
  SweepRequestedEvent,
  VerifyRequestedEvent,
} from './events'
import { STEP_LABEL, failureText, planStep, shownSteps, type NextAction, type Step } from './plan-step'

/** Labels the four phases a feature runs a model on carry in the picker row (B1); distinct from `plan-step`'s own step labels, which name the flow the person follows rather than what runs a model. */
const PHASE_LABEL: { plan: string; reconcile: string; implement: string; cleanup: string } = {
  plan: 'Blind plan',
  reconcile: 'Map against code',
  implement: 'Implement',
  cleanup: 'Cleanup',
}

/**
 * The feature session's header, one row: the flow as steps with the current
 * one lit, and at the right the one next thing. The next step is a button
 * when it moves the plan on, a link into the plan view when the act is on a
 * row there or into the chat when a run waits on the person, and a line of
 * text while someone else is at work. A run in
 * flight shows its progress and a Stop; Repair rides along while the spec is
 * off contract. A reached step is a button that opens the tab it works in.
 */
export class PlanBar extends HTMLElement {
  update(plan: PlanState | undefined): void {
    this.hidden = plan === undefined
    this.replaceChildren()
    if (!plan) return
    const step = planStep(plan)
    const steps = el('span', 'steps')
    const shown = shownSteps(plan)
    const currentIndex = shown.indexOf(step.current)
    for (const [index, name] of shown.entries()) {
      // The lit step says where the flow is; `yours` says it stands still until the person acts.
      const state = name === step.current ? `current${step.yours ? ' yours' : ''}` : index < currentIndex ? 'done' : step.reached.includes(name) ? 'reached' : 'future'
      steps.append(this.stepNode(name, state))
    }
    this.append(steps, ...this.run(plan), ...this.repair(plan), ...this.next(plan))
  }

  private stepNode(step: Step, state: string): HTMLElement {
    const node = document.createElement(state === 'future' ? 'span' : 'button')
    node.className = `step ${state}`
    node.textContent = STEP_LABEL[step]
    if (node instanceof HTMLButtonElement) {
      node.type = 'button'
      node.title = `Open what the ${STEP_LABEL[step]} step works in.`
      node.addEventListener('click', () => this.dispatchEvent(new PlanStepSelectedEvent(step)))
    }
    return node
  }

  /** A run in flight: its progress line and a Stop; otherwise how the last one ended, until the stage moves on. */
  private run(plan: PlanState): HTMLElement[] {
    const checking = plan.check?.live === true
    const cleaning = plan.cleanup?.live === true
    const verifying = plan.verification?.live === true
    const live = checking ? plan.check : cleaning ? plan.cleanup : verifying ? plan.verification : undefined
    if (live) {
      // A run's tool line says nothing about which run it is, and the step it sits under is not always the answer.
      const text = cleaning ? `Cleanup · ${live.text}` : live.text
      const nodes = [el('span', 'running', text)]
      nodes[0]!.title = text
      if (checking) nodes.push(button('Stop', () => this.dispatchEvent(new SpecCheckStoppedEvent()), 'stop', 'Stop the check against the code.'))
      if (cleaning) nodes.push(button('Stop', () => this.dispatchEvent(new CleanupStoppedEvent()), 'stop', 'Stop the cleanup.'))
      return nodes
    }
    // A failed turn is retried by nobody, so it outranks how an earlier run ended.
    if (plan.failure) {
      const text = failureText(plan.failure)
      const node = el('span', 'ran failed', text)
      node.title = text
      return [node]
    }
    // A cleanup outcome carries its test run's, so it comes first; a new test run clears it.
    const ran = plan.check?.text ?? plan.cleanup?.text ?? plan.verification?.text
    if (!ran) return []
    const node = el('span', 'ran', ran)
    node.title = ran
    return [node]
  }

  private repair(plan: PlanState): HTMLElement[] {
    if (!plan.repairable || !plan.spec) return []
    const problems = plan.spec.problems
    return [
      button(
        `Repair (${problems.length})`,
        () => this.dispatchEvent(new SpecRepairRequestedEvent()),
        'repair',
        `The spec is off contract:\n${problems.join('\n')}\n\nRepair moves a task section into the tasks file by rule and hands the rest to the planner, which rearranges the spec without changing its rules.`,
      ),
    ]
  }

  private next(plan: PlanState): HTMLElement[] {
    const step = planStep(plan)
    const next = step.next
    const nodes: HTMLElement[] = []
    const goto = next.kind === 'goto' ? next : step.goto
    if (goto) {
      const className = `next goto${plan.blocked ? ' blocked' : ''}`
      nodes.push(button(`${goto.label} ↓`, () => this.dispatchEvent(new PlanFocusRequestedEvent(goto.tab, { scroll: true })), className, goto.hint))
    }
    switch (next.kind) {
      case 'action':
        nodes.push(button(next.label, () => this.dispatchEvent(eventFor(next.action)), `next ${next.action}`, next.hint))
        break
      case 'waiting':
        // A run's own progress line already says who is at work.
        if (!isRunning(plan)) {
          const node = el('span', 'next waiting', next.text)
          node.title = next.text
          nodes.push(node)
        }
        break
      case 'done':
        nodes.push(el('span', 'next done', next.text))
        break
    }
    return nodes
  }
}

const isRunning = (plan: PlanState): boolean => plan.check?.live === true || plan.cleanup?.live === true || plan.verification?.live === true

function eventFor(action: NextAction): Event {
  switch (action) {
    case 'check':
      return new SpecCheckRequestedEvent()
    case 'submit_review':
      return new ReviewSubmittedEvent()
    case 'send_rulings':
      return new RulingsSentEvent()
    case 'approve':
      return new SpecApprovedEvent()
    case 'implement':
      return new ImplementRequestedEvent()
    case 'verify':
      return new VerifyRequestedEvent()
    case 'sweep':
      return new SweepRequestedEvent()
  }
}

function button(label: string, onClick: () => void, className: string, title: string): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = className
  node.textContent = label
  node.title = title
  node.addEventListener('click', onClick)
  return node
}

customElements.define('plan-bar', PlanBar)
