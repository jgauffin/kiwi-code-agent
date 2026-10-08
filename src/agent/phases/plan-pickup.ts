import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { SPECS_DIR, draftPickupPrompt, resumePlanPrompt, revisedDraftPrompt, specPath } from './blind-plan'
import { decisionsPath } from './decisions'
import { finished } from './plan-list'
import { reviewPath } from './plan-review'
import { authorshipOf, readSpecState } from './spec-file'
import { parseSpec, specFingerprint } from './spec-model'
import { isVerified } from './spec-status'
import { readTasks, rulesNotBuilt, tasksPath } from './tasks-file'

/** How a picked-up plan reaches its session, decided by the caller: whether the feature already has a tab. */
export interface PlanPickupCourier {
  /** Brings the tab that already holds this session up, with the conversation it already has. */
  open(sessionId: string): Promise<void>
  /** Starts a session with no conversation of its own, `label` standing in for the prompt in the chat; its id, when one started. */
  start(feature: string, prompt: string, label: string): Promise<string | undefined>
  /** A critique is owed on the draft, before the session it is about to start says anything: what it finds is in the chat alone. */
  critiqueOwed(feature: string): void
  /** Says text in the session as the person's own message, in their words. */
  say(sessionId: string, note: string): Promise<void>
  /** Says the extension's own text in the session, `label` standing in for it in the chat. */
  tell(sessionId: string, prompt: string, label: string): Promise<void>
}

/** The feature's planning session that is still around, and the spec as it last ended a turn on it, `specFingerprint`'s word. */
export type PlanOwner = { sessionId: string; specSeen?: string }

/**
 * Picks a plan up where its spec leaves it. A feature whose planning session
 * is still around, `owner`, brings that session's tab up rather than starting
 * a second one on the same spec. Otherwise a session with no conversation of
 * its own is started, told to read the spec (with its review and decisions,
 * where they exist) from disk rather than take the feature's state on faith.
 * Nothing here writes to the spec or its review: the pickup leaves a draft a
 * draft, and spends none of the user's comments.
 *
 * `note` is what the person typed before picking the plan up. It follows the
 * session into the chat as their own message, so what they came to say is not
 * lost to the switch, and it is theirs to word rather than folded into the
 * extension's kickoff.
 */
export async function pickUpPlan(options: {
  courier: PlanPickupCourier
  cwd: string
  feature: string
  owner?: PlanOwner
  note?: string
}): Promise<void> {
  const { courier, cwd, feature, owner, note } = options
  if (owner) {
    await courier.open(owner.sessionId)
    const unbuilt = await revisionUnseen(cwd, feature, owner.specSeen)
    if (unbuilt.length > 0) {
      courier.critiqueOwed(feature)
      await courier.tell(owner.sessionId, revisedDraftPrompt(feature, cwd, unbuilt), 'Planning the revised spec')
    }
    if (note) await courier.say(owner.sessionId, note)
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
  const draft = state.status === 'draft'
  const unbuilt = draft && tasks.exists ? rulesNotBuilt(parseSpec(state.body), tasks.tasks) : []
  const prompt = draft ? draftPickupPrompt(feature, cwd, authorshipOf(await readFile(path, 'utf8')), present, unbuilt) : resumePlanPrompt(feature, cwd, present)
  if (draft) courier.critiqueOwed(feature)
  const started = await courier.start(feature, prompt, 'Picking the plan up')
  if (note && started) await courier.say(started, note)
}

/**
 * The rules a draft holds that its board never built, when the draft changed
 * since its session last ended a turn on it: what that session remembers is
 * the spec before the change, so it would report the feature done. Empty for
 * a draft with no board (nothing built yet, the session is still planning it)
 * and for a revision the session has already seen.
 */
async function revisionUnseen(cwd: string, feature: string, specSeen: string | undefined): Promise<string[]> {
  const state = await readSpecState(specPath(cwd, feature))
  if (!state.exists || state.status !== 'draft') return []
  const spec = parseSpec(state.body)
  if (specFingerprint(spec) === specSeen) return []
  const tasks = await readTasks(tasksPath(cwd, feature))
  return tasks.exists ? rulesNotBuilt(spec, tasks.tasks) : []
}
