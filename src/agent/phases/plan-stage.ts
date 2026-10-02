import { pendingDecisions, type Decision } from './decisions'
import { struckItems, type Review } from './plan-review'
import { standingStrikes } from './review-handoff'
import type { SpecState } from './spec-file'
import { isSettled, isVerified, type SpecStatus } from './spec-status'
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
  if (spec.status === 'draft') {
    const comments = review.rounds.flatMap((r) => r.comments)
    if (comments.some((c) => !c.resolution)) return 'under_review'
    if (standingStrikes(spec.body, struckItems(review)).length > 0) return 'under_review'
    if (comments.some((c) => !c.closed)) return 'final_draft'
    return 'created'
  }
  // The board is the live word while it exists, so a reopened task or a failed re-run outranks the status the spec carries.
  if (tasks.exists) {
    if (!tasksDone(tasks.tasks)) return 'under_development'
    return tasks.verification?.ok ? 'verified' : 'verification'
  }
  // The working files are swept once a feature is verified; the spec alone says where it stands.
  if (spec.status === 'verified') return 'verified'
  if (spec.status === 'implemented') return 'verification'
  return pendingDecisions(decisions).length > 0 ? 'ruling' : 'checking'
}

/**
 * The status that records a stage in the spec, so the committed file says where
 * the feature stands once the working files it was derived from are swept.
 * `undefined` while there is no spec to record it in.
 */
export function statusForStage(stage: PlanStage): SpecStatus | undefined {
  switch (stage) {
    case 'missing':
      return undefined
    case 'created':
    case 'under_review':
    case 'final_draft':
      return 'draft'
    case 'checking':
    case 'ruling':
    case 'under_development':
      return 'approved'
    case 'verification':
      return 'implemented'
    case 'verified':
      return 'verified'
  }
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
  if (!spec.exists || !isSettled(spec.status) || isVerified(spec.status)) return false
  if (pendingDecisions(decisions).length > 0) return false
  return !tasks.exists || tasksStale(spec, tasks)
}

/** The spec may be approved: a draft with no comment open on it. */
export const isApprovable = (stage: PlanStage, spec: SpecState): boolean => stage === 'created' && spec.exists && spec.status === 'draft'
