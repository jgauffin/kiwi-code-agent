import { decisionsPath, pendingDecisions, readDecisions, type Decision } from '../agent/phases/decisions'
import type { PlanSummary } from '../agent/phases/plan-list'
import { isChangeable } from '../agent/phases/plan-stage'
import { readSpecState } from '../agent/phases/spec-file'
import { readTasks, tasksDone, tasksPath, type TasksState } from '../agent/phases/tasks-file'
import type { SessionManager } from '../agent/session/session-manager'
import type { UpdatableSpec } from './protocol'

/** The session operations this needs, to tell whether a feature's spec has a run of its own still going. */
export type UpdateCandidateSessions = Pick<SessionManager, 'list' | 'isLive'>

/** What `waiting` says when a settled spec's build has something in flight; a task before a decision, since either alone would already explain it. */
function waitingFor(tasks: TasksState, decisions: Decision[]): string {
  if (tasks.exists && !tasksDone(tasks.tasks)) return 'an unfinished task'
  if (pendingDecisions(decisions).length > 0) return 'a decision waiting to be ruled'
  return 'a run at work'
}

/**
 * Every feature's spec, for Update spec on the new-session screen's Code
 * tab: a draft is always pickable, carried on there as a draft pickup; a
 * settled one is pickable only once its build has nothing in flight, read
 * from its own files and from whether any of its sessions is still running.
 */
export async function updatableSpecs(workspaceRoot: string, sessions: UpdateCandidateSessions, specs: PlanSummary[]): Promise<UpdatableSpec[]> {
  const result: UpdatableSpec[] = []
  for (const spec of specs) {
    if (spec.status === 'draft') {
      result.push({ feature: spec.feature, status: spec.status, ...(spec.folder ? { folder: spec.folder } : {}) })
      continue
    }
    const state = await readSpecState(spec.path)
    const tasks = await readTasks(tasksPath(workspaceRoot, spec.feature))
    const decisions = await readDecisions(decisionsPath(workspaceRoot, spec.feature))
    const atWork = sessions.list().some((r) => r.feature === spec.feature && sessions.isLive(r.id))
    const settled = isChangeable(state, tasks, decisions)
    const changeable = settled && !atWork
    result.push({
      feature: spec.feature,
      status: spec.status,
      changeable,
      ...(spec.folder ? { folder: spec.folder } : {}),
      ...(changeable ? {} : { waiting: settled ? 'a run at work' : waitingFor(tasks, decisions) }),
    })
  }
  return result
}
