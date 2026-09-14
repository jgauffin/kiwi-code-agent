import { compileTemplate } from '@relax.js/core/html'
import type { PlanState } from '../protocol'
import { SpecApprovedEvent, SpecOpenRequestedEvent } from './events'

const LABEL: Record<PlanState['status'], string> = {
  missing: 'no spec written yet',
  draft: 'draft, waiting for your approval',
  approved: 'approved',
}

/** The approval gate for a plan session: where the spec is, its status, approve/open. */
export class PlanBar extends HTMLElement {
  private readonly template = compileTemplate(`
    <span class="spec">📄 {{specPath}}</span>
    <span class="status {{status}}">{{label}}</span>
    <button type="button" class="open" if="exists" r-click="open()">Open</button>
    <button type="button" class="approve" if="isDraft" r-click="approve()">Approve</button>
  `)

  connectedCallback(): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
  }

  update(plan: PlanState | undefined): void {
    this.hidden = plan === undefined
    if (!plan) return
    this.template.render(
      {
        specPath: plan.specPath,
        status: plan.status,
        label: LABEL[plan.status],
        exists: plan.status !== 'missing',
        isDraft: plan.status === 'draft',
      },
      {
        open: () => this.dispatchEvent(new SpecOpenRequestedEvent()),
        approve: () => this.dispatchEvent(new SpecApprovedEvent()),
      },
    )
  }
}

customElements.define('plan-bar', PlanBar)
