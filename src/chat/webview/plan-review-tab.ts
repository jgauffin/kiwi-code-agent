import { compileTemplate } from '@relax.js/core/html'
import type { PlanState } from '../protocol'
import type { ReviewRound } from '../../agent/phases/plan-review'
import { PlanTab } from './plan-tab'
import { commentMarkup, commentRows, type CommentRow } from './plan-comments'
import { PLAN_TARGET } from './plan-parts'

type StrikeRow = { name: string; label: string; undoable: boolean }
type RoundRow = { heading: string; pending: boolean; empty: boolean; comments: CommentRow[]; hasComments: boolean; strikes: StrikeRow[]; hasStrikes: boolean }

/** The rounds newest first: the one being written with its edits, the submitted ones with the planner's answers and Resolve. */
export class PlanReviewTab extends PlanTab {
  private readonly template = compileTemplate(`
    <section class="review">
      <section loop="r in rounds" class="round">
        <h2 class="heading">{{r.heading}}</h2>
        <p class="note" if="r.empty">Nothing in this round yet: comment on a rule on the Spec tab.</p>
        <ul class="comments" if="r.hasComments">${commentMarkup('r.comments')}</ul>
        <ul class="strikes" if="r.hasStrikes">
          <li loop="s in r.strikes" class="strike">
            <span class="label">remove: </span>
            <button type="button" class="link item" title="Show the rule on the Spec tab." r-click="focus(s.name)">{{s.label}}</button>
            <button type="button" if="s.undoable" r-click="unstrike(s)">Unstrike</button>
          </li>
        </ul>
        <p class="note" if="r.pending">Submit the review from the plan bar when it is complete.</p>
      </section>
    </section>
  `)

  protected draw(plan: PlanState): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
    this.template.render(
      { rounds: [...plan.review.rounds].reverse().map((round) => this.roundRow(plan, round)) },
      { ...this.commentFns(), unstrike: (s: StrikeRow) => this.act({ type: 'unstrike_item', item: s.name }) },
    )
  }

  private roundRow(plan: PlanState, round: ReviewRound): RoundRow {
    const pending = round.submittedAt === undefined
    const placed = round.comments.map((comment, index) => ({ ref: { round: round.number, index }, comment, pending }))
    return {
      heading: pending ? `Round ${round.number}, not submitted` : `Round ${round.number}`,
      pending,
      empty: round.comments.length === 0 && round.strikes.length === 0,
      comments: commentRows(placed, plan, true, this.editor),
      hasComments: round.comments.length > 0,
      strikes: round.strikes.map((name) => ({ name, label: name === PLAN_TARGET ? 'the plan as a whole' : name, undoable: pending && plan.commentable })),
      hasStrikes: round.strikes.length > 0,
    }
  }
}

customElements.define('plan-review-tab', PlanReviewTab)
