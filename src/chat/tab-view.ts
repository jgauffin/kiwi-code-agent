import { relative } from 'node:path'
import { actingMode, isBuild, offersAllowWrites, type SessionManager, type SessionMode, type SessionRecord } from '../agent/session/session-manager'
import type { SessionStatus } from '../agent/session/session-status'
import { blockOf, mostUrgent } from '../agent/session/session-status'
import { alignSpecStatus, readSpecState, type SpecState } from '../agent/phases/spec-file'
import type { SpecStatus } from '../agent/phases/spec-status'
import { decisionsFile, decisionsPath, pendingDecisions, readDecisions, type Decision } from '../agent/phases/decisions'
import { emptyReview, isCommentable, readReview, reviewPath, type Review } from '../agent/phases/plan-review'
import { readTasks, tasksPath, type TasksState } from '../agent/phases/tasks-file'
import { implementationStarts } from '../agent/phases/implement'
import { checkDue, isApprovable, isChangeable, planStage, statusForStage, tasksStale, type PlanStage } from '../agent/phases/plan-stage'
import { parseSpec, type Spec } from '../agent/phases/spec-model'
import type { PlanState, RunControls, RunRef, RunState, SessionTab } from './protocol'
import type { SessionSwitch } from './feature-runs'
import type { FeatureBuild } from './feature-build'
import type { FeatureCleanup, CleanupState } from './feature-cleanup'
import type { PlanActions } from './plan-actions'
import type { SessionTracker } from './session-tracker'
import { refusal } from './phase-runs'

/** Every run the tab holds, oldest first: one feature's sessions, or the one session that belongs to no feature. */
export function runsOf(sessions: SessionManager, record: SessionRecord): SessionRecord[] {
  if (!record.feature) return [record]
  return sessions
    .list()
    .filter((r) => r.feature === record.feature && !isBuild(r.mode))
    .reverse()
}

/**
 * What the webview calls the tab a session belongs to: its feature's oldest
 * run, so the tab keeps one identity while runs come and go under it.
 */
export function tabIdOf(sessions: SessionManager, record: SessionRecord): string {
  return runsOf(sessions, record)[0]?.id ?? record.id
}

export function runRef(run: SessionRecord): RunRef {
  return {
    sessionId: run.id,
    mode: run.mode,
    title: run.title,
    ...(run.task !== undefined ? { task: run.task } : {}),
    ...(run.fixAttempt !== undefined ? { fixAttempt: run.fixAttempt } : {}),
  }
}

export type TabViewDeps = {
  workspaceRoot: string
  sessions: SessionManager
  tracker: SessionTracker
  build: FeatureBuild
  cleanup: FeatureCleanup
  planActions: PlanActions
  allowWrites: SessionSwitch
}

/**
 * How a session, or the feature its tab speaks for, is shown to the webview:
 * the tab's own line, the run a message names, and the plan bar's whole
 * state. Reads what the other collaborators hold; changes nothing itself.
 */
export class TabView {
  constructor(private readonly deps: TabViewDeps) {}

  /**
   * A tab is the feature, however many runs it takes, and otherwise the one
   * session that belongs to no feature. Its title heads the view: the
   * feature, or the chat's own title, which its first message sets.
   */
  tab(record: SessionRecord): SessionTab {
    const { sessions, tracker } = this.deps
    return {
      // Keyed the same way wherever the tab is named, so a message about one run reaches the tab that holds it.
      id: tabIdOf(sessions, record),
      title: record.feature ?? record.title,
      mode: record.mode,
      access: record.access ?? 'scoped',
      profileName: record.profile.name,
      ...(record.profile.effort ? { effort: record.profile.effort } : {}),
      status: mostUrgent(runsOf(sessions, record).map((r) => tracker.statusOf(r.id))),
    }
  }

  /** The run a message from the tab names, which has to be one of the tab's; `speaking` also asks that it takes input. */
  targetOf(shown: SessionRecord, sessionId: string, speaking: boolean): SessionRecord {
    const run = runsOf(this.deps.sessions, shown).find((r) => r.id === sessionId)
    if (!run) throw new Error('That conversation is not under this tab.')
    const refused = speaking ? refusal(this.runControls(run)) : undefined
    if (refused) throw new Error(refused)
    return run
  }

  runControls(run: SessionRecord): RunControls {
    const { sessions, allowWrites, tracker } = this.deps
    const mcp = tracker.mcpServersOf(run.id)
    return {
      ...runRef(run),
      profileName: run.profile.name,
      ...(run.profile.effort ? { effort: run.profile.effort } : {}),
      live: sessions.isLive(run.id),
      settled: run.settled === true,
      // A session granted full access writes wherever the rules let it, and the switch is its own again.
      ...(offersAllowWrites(actingMode(run)) ? { allowWrites: allowWrites.isEnabled(run.id) } : {}),
      ...(mcp ? { mcp } : {}),
    }
  }

  async planState(shown: SessionRecord): Promise<PlanState | undefined> {
    const { workspaceRoot, sessions, tracker, build, cleanup, planActions } = this.deps
    const path = planActions.specPathOf(shown)
    // The bar belongs to the feature's planner, not to whichever of its runs is speaking: they share the tab.
    const record = planActions.planRecordOf(shown)
    const feature = record?.feature
    if (!path || !record || !feature) return undefined
    const state = await readSpecState(path)
    const check = planActions.checkOf(record.id)
    const verification = build.lineOf(feature)
    const cleanupState = cleanup.stateOf(feature)
    const review = await readReview(reviewPath(workspaceRoot, feature)).catch(() => emptyReview())
    const tasks = await readTasks(tasksPath(workspaceRoot, feature))
    const decisions = await readDecisions(decisionsPath(workspaceRoot, feature))
    const stage = planStage(state, review, tasks, decisions)
    // The spec records the stage as the person works, so the status never lags the board and still says where the feature stands once the board is swept.
    const recorded = statusForStage(stage)
    if (recorded !== undefined) await alignSpecStatus(path, recorded)
    const runs = runsOf(sessions, record).map((r) => ({ mode: r.mode, status: tracker.statusOf(r.id) }))
    // The newest run that ran in this window speaks for the tab: a later run that went through supersedes an older failure.
    const lastRun = [...runsOf(sessions, record)].reverse().find((r) => tracker.has(r.id))
    return buildPlanState({ workspaceRoot, path, feature, record, state, tasks, decisions, stage, recorded, check, verification, cleanupState, build, review, runs, lastRun, tracker, planActions })
  }
}

type PlanStateInputs = {
  workspaceRoot: string
  path: string
  feature: string
  record: SessionRecord
  state: SpecState
  tasks: TasksState
  decisions: Decision[]
  stage: PlanStage
  recorded: SpecStatus | undefined
  check: RunState | undefined
  verification: RunState | undefined
  cleanupState: CleanupState
  build: FeatureBuild
  review: Review
  runs: { mode: SessionMode; status: SessionStatus }[]
  lastRun: SessionRecord | undefined
  tracker: SessionTracker
  planActions: PlanActions
}

/** Everything read for the plan bar, assembled into what it shows. */
function buildPlanState(inputs: PlanStateInputs): PlanState {
  const { workspaceRoot, path, feature, record, state, tasks, decisions, stage, recorded, check, verification, cleanupState, build, review, runs, lastRun, tracker, planActions } = inputs
  const fromPlan = record.mode === 'plan' && state.exists
  const spec = state.exists ? parseSpec(state.body) : undefined
  const relativeTo = (file: string) => relative(workspaceRoot, file).split('\\').join('/')
  const blocked = blockOf(runs)
  const implementerBusy = runs.some((r) => r.mode === 'implement' && r.status === 'implementing')
  const failure = lastRunFailure(lastRun, tracker)
  const testPlan = build.testPlan(tasks.exists ? tasks.tasks : [])
  const atWork = tasksAtWork(runs, check, verification, cleanupState)
  const coverage = planCoverage(state, tasks, decisions, stage, fromPlan, atWork, blocked, check, verification, implementerBusy, planActions, feature)
  return {
    specPath: relativeTo(path),
    tasksPath: relativeTo(tasksPath(workspaceRoot, feature)),
    decisionsPath: decisionsFile(feature),
    stage,
    status: recorded ?? 'missing',
    ...optionalPlanFields(state, spec, check, verification, tasks, blocked, failure),
    stale: tasksStale(state, tasks),
    repairable: fromPlan && (spec?.problems.length ?? 0) > 0,
    ...coverage,
    verifies: testPlan.verifies,
    verifyCommands: testPlan.commands,
    ...cleanupState,
    tasks: tasks.exists ? tasks.tasks : [],
    review,
    commentable: isCommentable(state),
    decisions,
    pendingDecisions: pendingDecisions(decisions).length,
    applyingRulings: planActions.isApplying(feature),
    reviewingDocs: planActions.isReviewingDocs(feature),
    atWork,
  }
}

/** Work in flight, wherever it shows: a run planning or implementing, or any of the three side runs. */
function tasksAtWork(runs: { status: SessionStatus }[], check: RunState | undefined, verification: RunState | undefined, cleanupState: CleanupState): boolean {
  return runs.some((r) => r.status === 'planning' || r.status === 'implementing') || check?.live === true || verification?.live === true || cleanupState.cleanup?.live === true
}

/** The last run's failure, if its status has not since moved past it. */
function lastRunFailure(lastRun: SessionRecord | undefined, tracker: SessionTracker): { mode: SessionMode; message: string } | undefined {
  if (!lastRun) return undefined
  const message = tracker.failureOf(lastRun.id)
  return message === undefined ? undefined : { mode: lastRun.mode, message }
}

type PlanCoverage = { changeable: boolean; checkable: boolean; implementable: boolean; verifiable: boolean; approvable: boolean }

/**
 * What the plan bar may offer, each independent of why another is or is not:
 * a change once the board is settled and nothing is in flight, a re-check
 * once one is due and none is running, the build once the check is clean and
 * the implementer is free, the test run once the board is tested, and
 * approval once the draft has no comment open and no ruling pending.
 */
function planCoverage(
  state: SpecState,
  tasks: TasksState,
  decisions: Decision[],
  stage: PlanStage,
  fromPlan: boolean,
  atWork: boolean,
  blocked: ReturnType<typeof blockOf>,
  check: RunState | undefined,
  verification: RunState | undefined,
  implementerBusy: boolean,
  planActions: PlanActions,
  feature: string,
): PlanCoverage {
  return {
    // Settled, nothing pending or at work, and the board holds no unfinished task: a run still at work, or stopped on the dev, holds it back too.
    changeable: isChangeable(state, tasks, decisions) && !atWork && !blocked,
    // Offered only as the way back in: approval starts the check itself, so the button is for one that failed or was stopped.
    checkable: fromPlan && checkDue(state, tasks, decisions) && check?.live !== true && !planActions.isApplying(feature),
    // Offered only as the way back in: the clean check starts the build itself, so the button is for an implementer that never started or stopped early.
    // An implementer whose engine is up but whose turn has ended is stopped too: its status says so, its engine does not.
    implementable: fromPlan && stage === 'under_development' && !planActions.isReviewingDocs(feature) && implementationStarts(state, tasks, implementerBusy),
    // Offered while the board is tested and the last record did not pass; a re-run after a pass is a manual choice too.
    verifiable: (stage === 'verification' || stage === 'verified') && verification?.live !== true,
    approvable: isApprovable(stage, state) && !planActions.isApplying(feature),
  }
}

/** What goes on the plan bar only while it holds something: a check, a test line, the board's cleanup fields and a run's failure among them. */
function optionalPlanFields(
  state: SpecState,
  spec: Spec | undefined,
  check: RunState | undefined,
  verification: RunState | undefined,
  tasks: TasksState,
  blocked: ReturnType<typeof blockOf>,
  failure: { mode: SessionMode; message: string } | undefined,
) {
  return {
    ...(state.exists ? { body: state.body } : {}),
    ...(spec ? { spec } : {}),
    ...(check ? { check } : {}),
    ...(verification ? { verification } : {}),
    ...(tasks.exists && tasks.cleanup ? { cleanupDecision: tasks.cleanup } : {}),
    ...(tasks.exists && tasks.verification ? { lastVerification: tasks.verification } : {}),
    ...(blocked ? { blocked } : {}),
    ...(failure ? { failure } : {}),
  }
}
