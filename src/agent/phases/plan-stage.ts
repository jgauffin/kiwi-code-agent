import { pendingDecisions, type Decision } from './decisions'
import { struckItems, type Review } from './plan-review'
import { standingStrikes } from './review-handoff'
import type { SpecState } from './spec-file'
import { parseSpec, specFingerprint } from './spec-model'
import { tasksDone, tasksFresh, type TasksState } from './tasks-file'

/**
 * Where a feature stands, derived from its spec and working files and held
 * nowhere else: the spec's status, the review, the decisions, the task board
 * and its verification record can never disagree with a stage that is
 * computed from them.
 */
export type PlanStage =
  | 'missing'
  /** The spec is written and no comment is open on it; it may be approved. */
  | 'created'
  /** Comments or strikes are being written, or the planner has yet to answer them. */
  | 'under_review'
  /** Every comment is answered; the human reads the revised spec and accepts, or comments again. */
  | 'final_draft'
  /** Approved with no board yet and nothing for the person to rule: the check runs, or the planner applies rulings. */
  | 'checking'
  /** Approved with no board yet, and the check found decisions the person has to rule on or the planner has to apply. */
  | 'ruling'
  /** Approved and the board is derived; not every task is tested. */
  | 'under_development'
  /** Every task is tested; the test commands have yet to pass. */
  | 'verification'
  | 'verified'

export function planStage(spec: SpecState, review: Review, tasks: TasksState, decisions: Decision[] = []): PlanStage {
  if (!spec.exists) return 'missing'
  // The working files are swept once a feature is implemented; the spec alone says where it stands.
  if (spec.status === 'implemented') return 'verified'
  if (spec.status === 'draft') {
    const comments = review.rounds.flatMap((r) => r.comments)
    if (comments.some((c) => !c.resolution)) return 'under_review'
    if (standingStrikes(spec.body, struckItems(review)).length > 0) return 'under_review'
    if (comments.some((c) => !c.closed)) return 'final_draft'
    return 'created'
  }
  if (!tasks.exists) return pendingDecisions(decisions).length > 0 ? 'ruling' : 'checking'
  if (!tasksDone(tasks.tasks)) return 'under_development'
  return tasks.verification?.ok ? 'verified' : 'verification'
}

/** The board predates the spec as it stands: a ruling or a revision changed the plan after the board was derived. */
export function tasksStale(spec: SpecState, tasks: TasksState): boolean {
  if (!spec.exists || !tasks.exists) return false
  return !tasksFresh(tasks, specFingerprint(parseSpec(spec.body)))
}

/**
 * The approved spec has to be checked against the code: it has no board yet,
 * or it changed under the one it has. A pending decision holds it back, since
 * the planner's revision of the rules is what the check has to see.
 */
export function checkDue(spec: SpecState, tasks: TasksState, decisions: Decision[]): boolean {
  if (!spec.exists || spec.status !== 'approved') return false
  if (pendingDecisions(decisions).length > 0) return false
  return !tasks.exists || tasksStale(spec, tasks)
}

/** The spec may be approved: a draft with no comment open on it. */
export const isApprovable = (stage: PlanStage, spec: SpecState): boolean => stage === 'created' && spec.exists && spec.status === 'draft'
