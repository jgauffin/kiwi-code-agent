import type { SessionEvent } from '../agent/session/code-session'
import { readDecisions, decisionsPath } from '../agent/phases/decisions'
import { listPlans, type PlanSummary } from '../agent/phases/plan-list'
import { emptyReview } from '../agent/phases/plan-review'
import { planStage, type PlanStage } from '../agent/phases/plan-stage'
import { liveTasks, readTasks, tasksPath, type Task, type TasksState } from '../agent/phases/tasks-file'
import type { SessionRecord } from '../agent/session/session-manager'
import { underWay, type SessionStatus } from '../agent/session/session-status'
import { sessionGroups, type PlanEntry } from '../chat/session-groups'

/** A feature whose spec is not finished, and the step it is waiting on. */
export type UnfinishedFeature = { feature: string; waitingOn: string }

/** A session doing work right now. */
export type WorkingSession = { sessionId: string; title: string }

/** The one thing holding a stopped session, so the person knows what it needs from them. */
export type SessionBlocker = 'question_open' | 'permission_pending' | 'turn_ended_on_person' | 'task_blocked' | 'verification_held'

/** A session that has stopped, and what holds it. */
export type StoppedSession = { sessionId: string; title: string; blocker: SessionBlocker }

/** The three lists the app shows when it opens on a workspace. */
export type WorkspaceSnapshot = { features: UnfinishedFeature[]; sessionsAtWork: WorkingSession[]; sessionsStopped: StoppedSession[] }

/** One step of a session's recent course: a prompt sent, a reply, or a tool call with its outcome. */
export type SessionEntry = { kind: 'prompt'; text: string } | { kind: 'reply'; text: string } | { kind: 'tool_call'; name: string; outcome: string }

/** Enough of a session's recent course to judge what it is asking for. */
export type SessionView = { sessionId: string; entries: SessionEntry[] }

/** The step named by the stages table, for a feature not yet verified. `missing` has no row there: nothing has been written yet. */
const STAGE_LABEL: Record<PlanStage, string> = {
  missing: 'drafting',
  created: 'created',
  under_review: 'under review',
  final_draft: 'final draft',
  checking: 'checking',
  ruling: 'ruling',
  under_development: 'under development',
  verification: 'verification',
  verified: 'verified',
}

/** A session with no feature's board behind it: the status it last reported is the whole story. */
function plainBlocker(status: SessionStatus): SessionBlocker | undefined {
  switch (status) {
    case 'needs_answer':
      return 'question_open'
    case 'needs_approval':
      return 'permission_pending'
    case 'needs_human':
    case 'error':
      return 'turn_ended_on_person'
    default:
      return undefined
  }
}

/** Nothing is left to build but blocked tasks: the build stands still until the person hands one back or accepts it. */
function onlyBlockedLeft(tasks: Task[]): boolean {
  const unfinished = liveTasks(tasks).filter((t) => t.state !== 'tested')
  return unfinished.length > 0 && unfinished.every((t) => t.state === 'blocked')
}

/** Where a feature stands, and its board: read once per feature and shared by the feature's own entry and its session's blocker. */
async function featureState(workspaceRoot: string, plan: PlanEntry): Promise<{ stage: PlanStage; tasks: TasksState }> {
  if (plan.status === undefined) return { stage: 'missing', tasks: { exists: false } }
  if (plan.status === 'draft') return { stage: plan.review ?? 'created', tasks: { exists: false } }
  const tasks = await readTasks(tasksPath(workspaceRoot, plan.feature))
  const decisions = await readDecisions(decisionsPath(workspaceRoot, plan.feature))
  const stage = planStage({ exists: true, status: plan.status, body: '', built: false }, emptyReview(), tasks, decisions)
  return { stage, tasks }
}

/** A plan session's own turn always ends on the person; what it is really waiting for is read from its feature's board instead. */
function featureBlocker(state: { stage: PlanStage; tasks: TasksState }): SessionBlocker {
  if (state.stage === 'under_development' && state.tasks.exists && onlyBlockedLeft(state.tasks.tasks)) return 'task_blocked'
  if (state.stage === 'verification') return 'verification_held'
  return 'turn_ended_on_person'
}

/**
 * The three lists the app shows when it opens on a workspace: every feature
 * whose spec is not finished, with the step it is waiting on, and every
 * session split by whether it is at work or stopped. A plan session's status
 * alone says a turn ended, never why; `needs_human` on one is read against its
 * feature's board for the real reason.
 */
export async function workspaceSnapshot(workspaceRoot: string, records: SessionRecord[], statusOf: (sessionId: string) => SessionStatus): Promise<WorkspaceSnapshot> {
  const plans: PlanSummary[] = await listPlans(workspaceRoot)
  const groups = sessionGroups(records, plans)
  const features: UnfinishedFeature[] = []
  const states = new Map<string, { stage: PlanStage; tasks: TasksState }>()
  for (const plan of groups.plans) {
    if (plan.status === 'verified') continue
    const state = await featureState(workspaceRoot, plan)
    states.set(plan.feature, state)
    features.push({ feature: plan.feature, waitingOn: STAGE_LABEL[state.stage] })
  }

  const sessionsAtWork: WorkingSession[] = []
  const sessionsStopped: StoppedSession[] = []
  const classify = (record: SessionRecord, state?: { stage: PlanStage; tasks: TasksState }): void => {
    const status = statusOf(record.id)
    if (underWay(status)) {
      sessionsAtWork.push({ sessionId: record.id, title: record.title })
      return
    }
    const blocker = state && status === 'needs_human' ? featureBlocker(state) : plainBlocker(status)
    if (blocker) sessionsStopped.push({ sessionId: record.id, title: record.title, blocker })
  }
  for (const record of groups.chats) classify(record)
  for (const plan of groups.plans) {
    if (plan.record && plan.status !== 'verified') classify(plan.record, states.get(plan.feature))
  }

  return { features, sessionsAtWork, sessionsStopped }
}

/** Resolves the session whose conversation a tab's status is actually read from: its live child run, if one is running, else itself. */
export type ConversationSource = {
  get(sessionId: string): SessionRecord | undefined
  liveChildOf(sessionId: string): SessionRecord | undefined
  conversation(sessionId: string): Promise<SessionEvent[]>
}

const OUTCOME_LIMIT = 200

/** One line of a tool's result, short enough to read on a small screen. */
function outcomeOf(text: string, isError: boolean): string {
  const line = text.split('\n')[0] ?? ''
  const short = line.length > OUTCOME_LIMIT ? `${line.slice(0, OUTCOME_LIMIT)}…` : line
  return isError ? `failed: ${short}` : short || 'ok'
}

/** The prompts, replies and tool calls of a transcript, in order; a tool call's outcome fills in once its result arrives. */
export function sessionEntries(events: SessionEvent[]): SessionEntry[] {
  const entries: SessionEntry[] = []
  const pending = new Map<string, number>()
  for (const event of events) {
    switch (event.type) {
      case 'user_message': {
        const text = event.label ?? event.text
        if (text) entries.push({ kind: 'prompt', text })
        break
      }
      case 'assistant_message':
        if (event.text) entries.push({ kind: 'reply', text: event.text })
        break
      case 'tool_call':
        pending.set(event.toolUseId, entries.length)
        entries.push({ kind: 'tool_call', name: event.name, outcome: 'running' })
        break
      case 'tool_result': {
        const index = pending.get(event.toolUseId)
        pending.delete(event.toolUseId)
        if (index === undefined) break
        const call = entries[index]
        if (call?.kind === 'tool_call') entries[index] = { kind: 'tool_call', name: call.name, outcome: outcomeOf(event.text, event.isError) }
        break
      }
    }
  }
  return entries
}

/** Enough of a session's recent course to judge what it is asking for: read from its live child's conversation when one is running, else its own. */
export async function sessionView(sessions: ConversationSource, sessionId: string): Promise<SessionView | undefined> {
  const record = sessions.liveChildOf(sessionId) ?? sessions.get(sessionId)
  if (!record) return undefined
  const events = await sessions.conversation(record.id)
  return { sessionId, entries: sessionEntries(events) }
}
