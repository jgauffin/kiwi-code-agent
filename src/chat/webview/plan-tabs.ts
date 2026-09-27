import type { PlanState } from '../protocol'
import { PlanViewSelectedEvent } from './events'
import { planStep, presentTabs, tabLabel, type ViewTab } from './plan-step'

/**
 * The strip under the plan bar: the plan's tabs, each there once it has
 * content and counted when it needs the reader, and the conversation as
 * the last tab. One strip, so the spec and the chat are siblings, not a
 * toggle over a second row of tabs. The tab the person's next act is on is
 * marked apart from a chat that merely moved.
 */
export class PlanTabs extends HTMLElement {
  /** `chatMoved`: the conversation has gone on while another tab was open, so its tab is marked instead of taking over. */
  update(plan: PlanState | undefined, active: ViewTab, chatMoved = false): void {
    this.hidden = plan?.body === undefined
    this.replaceChildren()
    if (!plan?.body) return
    const attention = actOn(plan)
    const tabs: ViewTab[] = [...presentTabs(plan), 'chat']
    for (const tab of tabs) {
      const node = document.createElement('button')
      node.type = 'button'
      const mark = tab === attention ? ' attention' : tab === 'chat' && chatMoved ? ' moved' : ''
      node.className = `tab${tab === active ? ' active' : ''}${mark}`
      node.textContent = tab === 'chat' ? 'Chat' : tabLabel(tab, plan)
      node.addEventListener('click', () => this.dispatchEvent(new PlanViewSelectedEvent(tab)))
      this.append(node)
    }
  }
}

/** The tab the person's next act is on; none when the act is a bar button alone or nothing is theirs. */
function actOn(plan: PlanState): ViewTab | undefined {
  const step = planStep(plan)
  if (step.next.kind === 'goto') return step.next.tab
  return step.goto?.tab
}

customElements.define('plan-tabs', PlanTabs)
