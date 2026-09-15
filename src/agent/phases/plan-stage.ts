import { struckItems, type Review } from './plan-review'
import { openFindings } from './reconcile'
import { standingStrikes } from './review-handoff'
import type { SpecState } from './spec-file'
import { parseSpec, specFingerprint } from './spec-model'
import { started, tasksDone, tasksFresh, type TasksState } from './tasks-file'

/**
 * Where a feature stands, derived from its files under `plan/` and held
 * nowhere else: the spec's status, the review, the task board and its
 * verification record can never disagree with a stage that is computed from
 * them.
 */
export type PlanStage =
  | 'missing'
  /** The spec is written; nothing has been said about it. */
  | 'created'
  /** Comments or strikes are being written, or the planner has yet to answer them. */
  | 'under_review'
  /** Every comment is answered; the human reads the revised spec and accepts, or comments again. */
  | 'final_draft'
  /** The spec is mapped against the code: tasks and files exist, work has not started. */
  | 'mapped'
  | 'under_development'
  /** Every task is tested; the test commands have yet to pass. */
  | 'verification'
  | 'verified'

export function planStage(spec: SpecState, review: Review, tasks: TasksState): PlanStage {
  if (!spec.exists) return 'missing'
  const comments = review.rounds.flatMap((r) => r.comments)
  // A review in flight comes first: a re-review after mapping is a review like any other.
  if (comments.some((c) => !c.resolution)) return 'under_review'
  if (standingStrikes(spec.body, struckItems(review)).length > 0) return 'under_review'
  if (comments.some((c) => !c.closed)) return 'final_draft'
  if (!tasks.exists) return 'created'
  if (spec.status === 'draft' || !started(tasks.tasks)) return 'mapped'
  if (!tasksDone(tasks.tasks)) return 'under_development'
  return tasks.verification?.ok ? 'verified' : 'verification'
}

/** The board predates the spec as it stands: a ruling or a revision changed the plan after the tasks were mapped. */
export function tasksStale(spec: SpecState, tasks: TasksState): boolean {
  if (!spec.exists || !tasks.exists) return false
  return !tasksFresh(tasks, specFingerprint(parseSpec(spec.body)))
}

/**
 * The board is behind the spec and the rulings are in: a board mapped while a
 * finding is still open carries no task for what that finding questions, and
 * the next ruling would leave it stale again, so the re-map waits for the last one.
 */
export function remapDue(spec: SpecState, review: Review, tasks: TasksState): boolean {
  if (!spec.exists) return false
  return planStage(spec, review, tasks) === 'mapped' && tasksStale(spec, tasks) && openFindings(spec.body).length === 0
}

/** The spec may be approved: it is mapped from the spec as it stands, and every comment on it is closed. */
export const isApprovable = (stage: PlanStage, spec: SpecState, tasks: TasksState): boolean =>
  stage === 'mapped' && spec.exists && spec.status === 'draft' && !tasksStale(spec, tasks)

/**
 * Mapping is offered on a spec nobody has commented on. After that it runs
 * by itself: when the last comment is accepted, and when a plan turn leaves
 * the board stale.
 */
export const isMappable = (stage: PlanStage, spec: SpecState): boolean => spec.exists && spec.status === 'draft' && stage === 'created'
