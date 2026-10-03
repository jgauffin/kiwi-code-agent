import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { SPECS_DIR, draftPickupPrompt, resumePlanPrompt, specPath } from './blind-plan'
import { decisionsPath } from './decisions'
import { finished } from './plan-list'
import { reviewPath } from './plan-review'
import { authorshipOf, readSpecState } from './spec-file'
import { isVerified } from './spec-status'
import { readTasks, tasksPath } from './tasks-file'

/** How a picked-up plan reaches its session, decided by the caller: whether the feature already has a tab. */
export interface PlanPickupCourier {
  /** Brings the tab that already holds this session up, with the conversation it already has. */
  open(sessionId: string): Promise<void>
  /** Starts a session with no conversation of its own, `label` standing in for the prompt in the chat. */
  start(feature: string, prompt: string, label: string): Promise<void>
}

/**
 * Picks a plan up where its spec leaves it. A feature whose planning session
 * is still around, `owner`, brings that session's tab up rather than starting
 * a second one on the same spec. Otherwise a session with no conversation of
 * its own is started, told to read the spec (with its review and decisions,
 * where they exist) from disk rather than take the feature's state on faith.
 * Nothing here writes to the spec or its review: the pickup leaves a draft a
 * draft, and spends none of the user's comments.
 */
export async function pickUpPlan(options: { courier: PlanPickupCourier; cwd: string; feature: string; owner?: { sessionId: string } }): Promise<void> {
  const { courier, cwd, feature, owner } = options
  if (owner) {
    await courier.open(owner.sessionId)
    return
  }
  const path = specPath(cwd, feature)
  const state = await readSpecState(path)
  if (!state.exists) throw new Error(`No spec for "${feature}" under ${SPECS_DIR}/.`)
  const tasks = await readTasks(tasksPath(cwd, feature))
  if (isVerified(state.status) || finished(state.status, tasks)) {
    throw new Error(`"${feature}" is verified: plan the next change as its own feature.`)
  }
  const present = { review: existsSync(reviewPath(cwd, feature)), decisions: existsSync(decisionsPath(cwd, feature)) }
  // A draft buys a critique before any write; a settled spec only a status report, since there is nothing left to steer.
  const prompt =
    state.status === 'draft' ? draftPickupPrompt(feature, authorshipOf(await readFile(path, 'utf8')), present) : resumePlanPrompt(feature, present)
  await courier.start(feature, prompt, 'Picking the plan up')
}
