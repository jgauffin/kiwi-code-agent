import { compileTemplate } from '@relax.js/core/html'
import type { PlanState } from '../protocol'
import type { PlanStage } from '../../agent/phases/plan-stage'
import {
  CleanupStoppedEvent,
  ImplementRequestedEvent,
  IntentUpdateRequestedEvent,
  PlanFocusRequestedEvent,
  PlanViewSelectedEvent,
  ReviewSubmittedEvent,
  RulingsSentEvent,
  SpecApprovedEvent,
  SpecMapRequestedEvent,
  SpecMapStoppedEvent,
  SpecRepairRequestedEvent,
  VerifyRequestedEvent,
  type PlanView,
} from './events'
import { planStep, type NextAction } from './plan-step'

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

/**
 * The feature session's action row: Plan / Chat switch, the stage, and the
 * one next step. The step is a button when it moves the plan on, a link into
 * the plan view when the act is on a row there, and a line of text while
 * someone else is at work. Repair rides beside it while the spec is off
 * contract.
 */
export class PlanBar extends HTMLElement {
  private readonly template = compileTemplate(`
    <button type="button" class="view {{planState}}" if="exists" title="{{planHint}}" r-click="show('plan')">Plan{{openMark}}</button>
    <button type="button" class="view {{chatState}}" r-click="show('chat')">Chat</button>
    <span class="status {{stage}}" unless="running">{{label}}</span>
    <span class="status running" if="running" title="{{runText}}">{{runText}}</span>
    <button type="button" class="stop" if="mapping" title="Stop the mapping." r-click="stopMap()">Stop</button>
    <button type="button" class="stop" if="cleaning" title="Stop the cleanup." r-click="stopCleanup()">Stop</button>
    <span class="ran" if="ran" title="{{ranText}}">{{ranText}}</span>
    <button type="button" class="repair" if="repairable" title="{{repairHint}}" r-click="repair()">Repair{{problemMark}}</button>
    <button type="button" class="next goto" if="goto" title="{{gotoHint}}" r-click="focus()">{{gotoLabel}} ↓</button>
    <button type="button" class="next {{action}}" if="action" title="{{actionHint}}" r-click="act()">{{actionLabel}}</button>
    <span class="next waiting" if="waiting" title="{{waitingText}}">{{waitingText}}</span>
    <span class="next done" if="done">{{doneText}}</span>
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
    const cleaning = plan.cleanup?.live === true
    const running = mapping || verifying || cleaning
    // The last run's outcome shows beside the stage until the stage moves on; the file's record is the one that stands.
    // A cleanup outcome carries its test run's, so it comes first; a new test run clears it.
    const ran = running ? undefined : (plan.mapping?.text ?? plan.cleanup?.text ?? plan.verification?.text)
    const step = planStep(plan)
    const next = step.next
    // The next step's link and its own waiting text say what a run line already says; the slot stays quiet while one runs.
    const goto = next.kind === 'goto' ? { tab: next.tab, label: next.label, hint: next.hint } : step.goto ? { ...step.goto, hint: 'Rule on each decision in place.' } : undefined
    const action: NextAction | undefined = next.kind === 'action' ? next.action : undefined
    this.template.render(
      {
        planHint: plan.commentable
          ? `${plan.specPath}\nComment on the plan's items, strike what should not be built.`
          : plan.specPath,
        stage: plan.stage,
        label: stageLabel(plan),
        exists: plan.status !== 'missing',
        repairable: plan.repairable,
        problemMark: plan.spec && plan.spec.problems.length > 0 ? ` (${plan.spec.problems.length})` : '',
        repairHint: plan.spec
          ? `The spec is off contract:\n${plan.spec.problems.join('\n')}\n\nRepair moves a task section into the tasks file by rule and hands the rest to the planner, which rearranges the spec without changing its rules.`
          : '',
        mapping,
        cleaning,
        running,
        runText: mapping ? plan.mapping!.text : verifying ? plan.verification!.text : cleaning ? plan.cleanup!.text : '',
        ran: ran !== undefined && ran.length > 0,
        ranText: ran ?? '',
        openMark: open > 0 ? ` (${open})` : '',
        goto: goto !== undefined,
        gotoLabel: goto?.label ?? '',
        gotoHint: goto?.hint ?? '',
        action: action ?? '',
        actionLabel: next.kind === 'action' ? next.label : '',
        actionHint: next.kind === 'action' ? next.hint : '',
        waiting: next.kind === 'waiting' && !running,
        waitingText: next.kind === 'waiting' ? next.text : '',
        done: next.kind === 'done',
        doneText: next.kind === 'done' ? next.text : '',
        planState: view === 'plan' ? 'active' : '',
        chatState: view === 'chat' ? 'active' : '',
      },
      {
        show: (next: PlanView) => this.dispatchEvent(new PlanViewSelectedEvent(next)),
        repair: () => this.dispatchEvent(new SpecRepairRequestedEvent()),
        stopMap: () => this.dispatchEvent(new SpecMapStoppedEvent()),
        stopCleanup: () => this.dispatchEvent(new CleanupStoppedEvent()),
        focus: () => {
          if (goto) this.dispatchEvent(new PlanFocusRequestedEvent(goto.tab))
        },
        act: () => {
          if (action) this.dispatchEvent(eventFor(action))
        },
      },
    )
  }
}

function eventFor(action: NextAction): Event {
  switch (action) {
    case 'map':
      return new SpecMapRequestedEvent()
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
    case 'update_intent':
      return new IntentUpdateRequestedEvent()
  }
}

/** The stage in words, with what the stage alone does not say: approval on a mapped plan, the outcome of the tests. Progress on the board is the next step's line. */
function stageLabel(plan: PlanState): string {
  const base = STAGE[plan.stage]
  switch (plan.stage) {
    case 'mapped':
      if (plan.stale) return `${base}, tasks out of date`
      return plan.status === 'approved' ? `${base}, approved` : base
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
