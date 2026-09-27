import type { PlanState } from '../protocol'
import { PlanViewSelectedEvent, type ViewTab } from './events'
import { presentTabs, tabLabel } from './plan-step'

/**
 * The strip under the plan bar: the plan's tabs, each there once it has
 * content and counted when it needs the reader, and the conversation as
 * the last tab. One strip, so the spec and the chat are siblings, not a
 * toggle over a second row of tabs.
 */
export class PlanTabs extends HTMLElement {
  /** `chatMoved`: the conversation has gone on while another tab was open, so its tab is marked instead of taking over. */
  update(plan: PlanState | undefined, active: ViewTab, chatMoved = false): void {
    this.hidden = plan?.body === undefined
    this.replaceChildren()
    if (!plan?.body) return
    const tabs: ViewTab[] = [...presentTabs(plan), 'chat']
    for (const tab of tabs) {
      const node = document.createElement('button')
      node.type = 'button'
      node.className = `tab${tab === active ? ' active' : ''}${tab === 'chat' && chatMoved ? ' moved' : ''}`
      node.textContent = tab === 'chat' ? 'Chat' : tabLabel(tab, plan)
      node.addEventListener('click', () => this.dispatchEvent(new PlanViewSelectedEvent(tab)))
      this.append(node)
    }
  }
}

customElements.define('plan-tabs', PlanTabs)
