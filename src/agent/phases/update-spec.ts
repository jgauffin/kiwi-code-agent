import { SPECS_DIR, specPath, updatePrompt } from './blind-plan'
import { decisionsPath, readDecisions } from './decisions'
import { pickUpPlan, type PlanPickupCourier } from './plan-pickup'
import { isChangeable } from './plan-stage'
import { readSpecState } from './spec-file'
import { readTasks, tasksPath } from './tasks-file'

/**
 * The new-session screen's "Update spec": a feature whose tab is already
 * open hears the description as its next message, whatever the spec's
 * state; a draft with nothing open is carried on as a draft pickup, same as
 * picking it up from the list; a settled spec with nothing open gets a
 * fresh plan session on the spec as it stands, and hears the description
 * next, in the developer's own words rather than folded into the kickoff.
 * Refused, like Change, while the feature's build still has something in
 * flight; a draft has no such board to be in flight on, so nothing gates it.
 */
export async function startUpdate(options: {
  courier: PlanPickupCourier
  cwd: string
  feature: string
  description: string
  owner?: { sessionId: string }
}): Promise<void> {
  const { courier, cwd, feature, description, owner } = options
  const path = specPath(cwd, feature)
  const state = await readSpecState(path)
  if (!state.exists) throw new Error(`No spec for "${feature}" under ${SPECS_DIR}/.`)
  if (state.status !== 'draft') {
    const tasks = await readTasks(tasksPath(cwd, feature))
    const decisions = await readDecisions(decisionsPath(cwd, feature))
    if (!isChangeable(state, tasks, decisions)) throw new Error(`"${feature}" still has work in flight: nothing to change yet.`)
  }
  if (owner) {
    await courier.open(owner.sessionId)
    await courier.say(owner.sessionId, description)
    return
  }
  if (state.status === 'draft') {
    await pickUpPlan({ courier, cwd, feature, note: description })
    return
  }
  const started = await courier.start(feature, updatePrompt(feature, cwd), 'Updating the spec')
  if (started) await courier.say(started, description)
}
