import { SPECS_DIR, changePrompt, specPath, updatePrompt } from './blind-plan'
import { decisionsPath, readDecisions } from './decisions'
import type { PlanPickupCourier } from './plan-pickup'
import { finished } from './plan-list'
import { isChangeable } from './plan-stage'
import { readSpecState } from './spec-file'
import { parseSpec } from './spec-model'
import { isVerified } from './spec-status'
import { readTasks, rulesNotBuilt, tasksPath } from './tasks-file'

/**
 * Whether the feature is done: verified, with every rule of its spec built.
 * A done feature has nothing left to pick up, so opening it means the
 * developer wants it to work differently.
 */
export async function isDone(cwd: string, feature: string): Promise<boolean> {
  const state = await readSpecState(specPath(cwd, feature))
  if (!state.exists) return false
  const tasks = await readTasks(tasksPath(cwd, feature))
  // The board is the live word while it exists: a rule added to the spec or a task added to the board reopens a verified feature.
  if (!tasks.exists) return isVerified(state.status)
  return finished(state.status, tasks) && rulesNotBuilt(parseSpec(state.body), tasks.tasks).length === 0
}

/**
 * Opens a done feature as a change: a fresh plan session on the spec as it
 * stands, carrying none of the conversation that shaped it. What the
 * developer typed before opening it is the change, said next in their own
 * words rather than folded into the kickoff; with nothing typed the planner
 * asks what should change. Refused while a decision still waits to be ruled.
 */
export async function startChange(options: { courier: PlanPickupCourier; cwd: string; feature: string; description?: string }): Promise<void> {
  const { courier, cwd, feature, description } = options
  const state = await readSpecState(specPath(cwd, feature))
  if (!state.exists) throw new Error(`No spec for "${feature}" under ${SPECS_DIR}/.`)
  const tasks = await readTasks(tasksPath(cwd, feature))
  const decisions = await readDecisions(decisionsPath(cwd, feature))
  if (!isChangeable(state, tasks, decisions)) throw new Error(`"${feature}" still has work in flight: nothing to change yet.`)
  if (!description) {
    await courier.start(feature, changePrompt(feature), 'Starting a change')
    return
  }
  const started = await courier.start(feature, updatePrompt(feature, cwd), 'Starting a change')
  if (started) await courier.say(started, description)
}
