import { compileTemplate } from '@relax.js/core/html'
import type { PlanState } from '../protocol'
import {
  ImplementRequestedEvent,
  IntentUpdateRequestedEvent,
  PlanViewSelectedEvent,
  SpecApprovedEvent,
  SpecCheckRequestedEvent,
  SpecCheckStoppedEvent,
  type PlanView,
} from './events'

const LABEL: Record<PlanState['status'], string> = {
  missing: 'no spec written yet',
  draft: 'draft, waiting for your approval',
  approved: 'approved',
}

/** The feature session's header: Plan / Review / Chat switch, spec status, and the next step (check, approve, implement). */
export class PlanBar extends HTMLElement {
  private readonly template = compileTemplate(`
    <button type="button" class="view {{planState}}" if="exists" title="{{specPath}}" r-click="show('plan')">Plan</button>
    <button type="button" class="view {{reviewState}}" if="reviewable" title="Comment on the plan's items, strike what should not be built." r-click="show('review')">Review{{openMark}}</button>
    <button type="button" class="view {{chatState}}" r-click="show('chat')">Chat</button>
    <span class="status {{status}}" unless="checking">{{label}}</span>
    <span class="status checking" if="checking" title="{{checkText}}">{{checkText}}</span>
    <button type="button" class="stop" if="checking" title="Stop the check." r-click="stopCheck()">Stop</button>
    <span class="checked" if="checked" title="{{checkText}}">{{checkText}}</span>
    <button type="button" class="check" if="checkable" title="Read the code and write what contradicts or breaks under this spec into its Findings table; the planner then proposes a solution per finding." r-click="check()">Check against code</button>
    <button type="button" class="approve" if="isDraft" disabled="{{blocked}}" title="{{approveHint}}" r-click="approve()">Approve</button>
    <button type="button" class="implement" if="implementable" title="Start a fresh session that builds the approved spec task by task." r-click="implement()">Implement</button>
    <button type="button" class="intent" if="amendable" title="{{intentHint}}" r-click="updateIntent()">Update intent{{intentMark}}</button>
  `)

  connectedCallback(): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
  }

  update(plan: PlanState | undefined, view: PlanView): void {
    this.hidden = plan === undefined
    if (!plan) return
    const open = openCount(plan)
    this.template.render(
      {
        specPath: plan.specPath,
        status: plan.status,
        label: LABEL[plan.status],
        exists: plan.status !== 'missing',
        isDraft: plan.status === 'draft',
        checkable: plan.checkable,
        checking: plan.check?.live === true,
        checked: plan.check !== undefined && !plan.check.live,
        checkText: plan.check?.text ?? '',
        implementable: plan.implementable,
        // Commenting is offered on a draft; a closed review stays readable after approval.
        reviewable: plan.commentable || plan.review.rounds.length > 0,
        openMark: open > 0 ? ` (${open})` : '',
        blocked: !plan.approvable,
        approveHint: plan.approvable
          ? 'Approve this plan.'
          : `Approval is blocked while ${open} comment${open === 1 ? ' is' : 's are'} open.`,
        amendable: plan.intent?.applicable === true,
        intentMark: plan.intent && plan.intent.pending > 0 ? ` (${plan.intent.pending})` : '',
        intentHint: plan.intent
          ? `Write the ${plan.intent.pending} amendment${plan.intent.pending === 1 ? '' : 's'} in ${plan.intent.path} into the intent docs, so the next feature is planned from what this one settled.`
          : '',
        planState: view === 'plan' ? 'active' : '',
        reviewState: view === 'review' ? 'active' : '',
        chatState: view === 'chat' ? 'active' : '',
      },
      {
        show: (next: PlanView) => this.dispatchEvent(new PlanViewSelectedEvent(next)),
        approve: () => this.dispatchEvent(new SpecApprovedEvent()),
        check: () => this.dispatchEvent(new SpecCheckRequestedEvent()),
        stopCheck: () => this.dispatchEvent(new SpecCheckStoppedEvent()),
        implement: () => this.dispatchEvent(new ImplementRequestedEvent()),
        updateIntent: () => this.dispatchEvent(new IntentUpdateRequestedEvent()),
      },
    )
  }
}

/** Comments the human has not closed; while there is one, approval is blocked. */
function openCount(plan: PlanState): number {
  return plan.review.rounds.flatMap((r) => r.comments).filter((c) => !c.closed).length
}

customElements.define('plan-bar', PlanBar)
