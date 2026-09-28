import type { PlanState } from '../protocol'
import { el } from './dom'
import { type PlanFocus } from './events'
import { renderMarkdown } from './markdown'
import { note, same } from './plan-parts'
import { PlanCleanupTab } from './plan-cleanup-tab'
import { PlanDecisionsTab } from './plan-decisions-tab'
import { PlanReviewTab } from './plan-review-tab'
import { PlanSpecTab } from './plan-spec-tab'
import { presentTabs, type Tab } from './plan-step'
import type { PlanTab } from './plan-tab'
import { PlanTasksTab } from './plan-tasks-tab'

const TABS: Record<Tab, new () => PlanTab> = {
  spec: PlanSpecTab,
  review: PlanReviewTab,
  decisions: PlanDecisionsTab,
  tasks: PlanTasksTab,
  cleanup: PlanCleanupTab,
}

/**
 * One tab of the plan at a time, each its own element: the spec as the
 * contract reads it, the review as a batch, the decisions one at a time, the
 * task board, or the cleanup. Which tab is the app's call, made on the strip
 * above; a link from one tab to a rule on another asks the app the same way.
 * A tab element is built once and kept, so what the user has half-written on
 * it survives the plan changing around it.
 */
export class PlanView extends HTMLElement {
  private plan: PlanState | undefined
  private signature = ''
  private tab: Tab = 'spec'
  private readonly tabs = new Map<Tab, PlanTab>()

  update(plan: PlanState | undefined, tab: Tab): void {
    const tabChanged = tab !== this.tab
    this.tab = tab
    const signature = JSON.stringify(plan ? watched(plan) : null)
    const changed = signature !== this.signature || tabChanged
    this.signature = signature
    this.plan = plan
    if (changed) this.draw()
  }

  /** Scroll to the first row needing an act, or to the item named, on the tab as drawn. */
  land(where: PlanFocus): void {
    const target = where.item
      ? [...this.querySelectorAll<HTMLElement>('[data-item]')].find((n) => same(n.dataset.item ?? '', where.item!))
      : where.scroll
        ? this.querySelector<HTMLElement>('.attention')
        : undefined
    target?.scrollIntoView?.({ block: 'center' })
  }

  private draw(): void {
    const plan = this.plan
    if (!plan?.body || !plan.spec) return this.replaceChildren()
    if (plan.spec.problems.length > 0) return this.drawProblems(plan.body, plan.spec.problems)
    // A tab whose content is gone (the last decision withdrawn, say) falls back to the spec.
    const tab = presentTabs(plan).includes(this.tab) ? this.tab : 'spec'
    const element = this.tabs.get(tab) ?? new TABS[tab]()
    this.tabs.set(tab, element)
    this.replaceChildren(element)
    element.update(plan)
  }

  /** Off contract: the file as written, so nothing the model put there is hidden, and no review on it until it is repaired. */
  private drawProblems(body: string, problems: string[]): void {
    const box = el('section', 'problems')
    box.append(el('h3', 'heading', 'Off contract'))
    const list = el('ul', 'list')
    for (const problem of problems) list.append(el('li', 'problem', problem))
    box.append(list, note('Repair from the plan bar: the planner rearranges the spec, the rules stay the rules.'))
    const raw = el('div', 'body')
    renderMarkdown(body, raw, true)
    this.replaceChildren(box, raw)
  }
}

/** What a redraw depends on: a change anywhere here is a change the tabs show. */
function watched(plan: PlanState) {
  return {
    body: plan.body,
    stage: plan.stage,
    status: plan.status,
    review: plan.review,
    commentable: plan.commentable,
    tasks: plan.tasks,
    stale: plan.stale,
    lastVerification: plan.lastVerification,
    decisions: plan.decisions,
    applyingRulings: plan.applyingRulings,
    // What the step is read from beyond the files: a run in flight (not its progress line, which ticks), an implement session to start.
    mapping: plan.mapping?.live,
    verification: plan.verification?.live,
    // The cleanup's line ticks on the Cleanup tab, not only in the bar, so its text counts here.
    cleanup: plan.cleanup,
    cleanupSweep: plan.cleanupSweep,
    cleanupDecision: plan.cleanupDecision,
    implementable: plan.implementable,
    reviewingDocs: plan.reviewingDocs,
  }
}

customElements.define('plan-view', PlanView)
