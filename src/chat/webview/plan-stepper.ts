import type { PlanState } from '../protocol'
import { PlanStepSelectedEvent } from './events'
import { STEPS, STEP_LABEL, planStep, type Step } from './plan-step'

/**
 * The plan flow as one row: every step in order, the current one marked,
 * the ones behind it done. A reached step is a button that opens the tab
 * it works in; a step ahead is inert, so the row also says how far the
 * plan can be taken from here.
 */
export class PlanStepper extends HTMLElement {
  private drawn = ''

  update(plan: PlanState | undefined): void {
    this.hidden = plan === undefined
    if (!plan) return
    const { current, reached } = planStep(plan)
    const signature = `${current}|${reached.join(',')}`
    if (signature === this.drawn) return
    this.drawn = signature
    this.replaceChildren()
    const currentIndex = STEPS.indexOf(current)
    for (const [index, step] of STEPS.entries()) {
      const state = step === current ? 'current' : index < currentIndex ? 'done' : reached.includes(step) ? 'reached' : 'future'
      this.append(this.stepNode(step, state))
    }
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
}

customElements.define('plan-stepper', PlanStepper)
