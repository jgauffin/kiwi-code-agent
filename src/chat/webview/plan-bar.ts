import { compileTemplate } from '@relax.js/core/html'
import type { PlanState } from '../protocol'
import type { PlanStage } from '../../agent/phases/plan-stage'
import {
  ImplementRequestedEvent,
  IntentUpdateRequestedEvent,
  PlanViewSelectedEvent,
  SpecApprovedEvent,
  SpecMapRequestedEvent,
  SpecMapStoppedEvent,
  VerifyRequestedEvent,
  type PlanView,
} from './events'

const STAGE: Record<PlanStage, string> = {
  missing: 'no spec written yet',
  created: 'created',
  under_review: 'under review',
  final_draft: 'final draft',
  mapped: 'mapped',
  under_development: 'under development',
  verification: 'verification',
  verified: 'verified',
}

/** The feature session's header: Plan / Chat switch, the stage, and the next step (map, approve, implement, verify). */
export class PlanBar extends HTMLElement {
  private readonly template = compileTemplate(`
    <button type="button" class="view {{planState}}" if="exists" title="{{planHint}}" r-click="show('plan')">Plan{{openMark}}</button>
    <button type="button" class="view {{chatState}}" r-click="show('chat')">Chat</button>
    <span class="status {{stage}}" unless="running">{{label}}</span>
    <span class="status running" if="running" title="{{runText}}">{{runText}}</span>
    <button type="button" class="stop" if="mapping" title="Stop the mapping." r-click="stopMap()">Stop</button>
    <span class="ran" if="ran" title="{{ranText}}">{{ranText}}</span>
    <button type="button" class="map" if="mappable" title="Read the code and write what contradicts or breaks under this spec into its Findings table, and the tasks with the files they touch into the tasks file." r-click="map()">Map against code</button>
    <button type="button" class="approve" if="isDraft" disabled="{{blocked}}" title="{{approveHint}}" r-click="approve()">Approve</button>
    <button type="button" class="implement" if="implementable" title="Start a fresh session that builds the tasks one by one." r-click="implement()">Implement</button>
    <button type="button" class="verify" if="verifiable" title="Run the test commands over the files the tasks name." r-click="verify()">{{verifyLabel}}</button>
    <button type="button" class="intent" if="amendable" title="{{intentHint}}" r-click="updateIntent()">Update intent{{intentMark}}</button>
  `)

  connectedCallback(): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
  }

  update(plan: PlanState | undefined, view: PlanView): void {
    this.hidden = plan === undefined
    if (!plan) return
    const open = openCount(plan)
    const mapping = plan.mapping?.live === true
    const verifying = plan.verification?.live === true
    // The last run's outcome shows beside the stage until the stage moves on; the file's record is the one that stands.
    const ran = mapping || verifying ? undefined : (plan.mapping?.text ?? plan.verification?.text)
    this.template.render(
      {
        planHint: plan.commentable
          ? `${plan.specPath}\nComment on the plan's items, strike what should not be built.`
          : plan.specPath,
        stage: plan.stage,
        label: stageLabel(plan),
        exists: plan.status !== 'missing',
        isDraft: plan.stage === 'mapped' && plan.status === 'draft',
        mappable: plan.mappable,
        mapping,
        running: mapping || verifying,
        runText: mapping ? plan.mapping!.text : verifying ? plan.verification!.text : '',
        ran: ran !== undefined && ran.length > 0,
        ranText: ran ?? '',
        implementable: plan.implementable,
        verifiable: plan.verifiable,
        verifyLabel: plan.lastVerification ? 'Verify again' : 'Verify',
        openMark: open > 0 ? ` (${open})` : '',
        blocked: !plan.approvable,
        approveHint: plan.approvable
          ? 'Approve this plan: the spec and its tasks.'
          : `Approval is blocked while ${open} comment${open === 1 ? ' is' : 's are'} open.`,
        amendable: plan.intent?.applicable === true,
        intentMark: plan.intent && plan.intent.pending > 0 ? ` (${plan.intent.pending})` : '',
        intentHint: plan.intent
          ? `Write the ${plan.intent.pending} amendment${plan.intent.pending === 1 ? '' : 's'} in ${plan.intent.path} into the intent docs, so the next feature is planned from what this one settled.`
          : '',
        planState: view === 'plan' ? 'active' : '',
        chatState: view === 'chat' ? 'active' : '',
      },
      {
        show: (next: PlanView) => this.dispatchEvent(new PlanViewSelectedEvent(next)),
        approve: () => this.dispatchEvent(new SpecApprovedEvent()),
        map: () => this.dispatchEvent(new SpecMapRequestedEvent()),
        stopMap: () => this.dispatchEvent(new SpecMapStoppedEvent()),
        implement: () => this.dispatchEvent(new ImplementRequestedEvent()),
        verify: () => this.dispatchEvent(new VerifyRequestedEvent()),
        updateIntent: () => this.dispatchEvent(new IntentUpdateRequestedEvent()),
      },
    )
  }
}

/** The stage in words, with what the stage alone does not say: approval on a mapped plan, progress on a board. */
function stageLabel(plan: PlanState): string {
  const base = STAGE[plan.stage]
  switch (plan.stage) {
    case 'mapped':
      return plan.status === 'approved' ? `${base}, approved` : base
    case 'under_development': {
      const live = plan.tasks.filter((t) => !t.removed)
      const tested = live.filter((t) => t.state === 'tested').length
      return `${base}: ${tested} of ${live.length} tested`
    }
    case 'verification':
      return plan.lastVerification ? `${base}: tests failed` : `${base}: tests not run yet`
    default:
      return base
  }
}

/** Comments the human has not closed; while there is one, approval is blocked. */
function openCount(plan: PlanState): number {
  return plan.review.rounds.flatMap((r) => r.comments).filter((c) => !c.closed).length
}

customElements.define('plan-bar', PlanBar)
