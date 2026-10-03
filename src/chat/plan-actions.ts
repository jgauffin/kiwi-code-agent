import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SessionManager, SessionMode, SessionRecord } from '../agent/session/session-manager'
import type { SessionEvent } from '../agent/session/code-session'
import type { ModelProfile, Step } from '../agent/session/model-profile'
import { readSpecState, type SpecState } from '../agent/phases/spec-file'
import { changePrompt, specPath } from '../agent/phases/blind-plan'
import { compactAppliedDecisions, decisionsPath, readDecisions } from '../agent/phases/decisions'
import { contextPath, readScenarioContext } from '../agent/phases/scenario-context'
import { pickUpPlan } from '../agent/phases/plan-pickup'
import { assertImplementable } from '../agent/phases/implement'
import { checkDue } from '../agent/phases/plan-stage'
import { parseSpec } from '../agent/phases/spec-model'
import { followRenames, type MigrationReport } from '../agent/phases/migrate-plan'
import { deriveBoard, readBoard, readTasks, tasksPath, writeBoard } from '../agent/phases/tasks-file'
import type { Review } from '../agent/phases/plan-review'
import type { FromWebview, PlanState, RunState } from './protocol'
import type { ChatPanel } from './panel-registry'
import type { FeatureBuild } from './feature-build'
import { PlanChecks } from './plan-checks'
import { PlanRepairs } from './plan-repairs'
import { PlanApprovals } from './plan-approvals'

export type PlanActionsDeps = {
  workspaceRoot: string
  sessions: SessionManager
  /** What a step runs on. `attempt` counts the fixes of a failed test run. */
  profileFor: (step: Step, attempt?: number) => ModelProfile
  build: FeatureBuild
  newSession: (mode: SessionMode, feature?: string, prompt?: string, into?: ChatPanel, label?: string) => Promise<SessionRecord | undefined>
  open: (sessionId: string, into?: ChatPanel) => Promise<void>
  /** The plan bar's state for the tab a session belongs to; `startChange` reads only whether it is changeable. */
  planState: (shown: SessionRecord) => Promise<PlanState | undefined>
  sendState: () => Promise<void>
  changed: () => void
}

/**
 * Moves a feature's plan forward: the check against the code, the rulings
 * and the approval that follow it, the build it hands off to, and the
 * mechanical repairs and migrations that keep its files on contract. Each of
 * those is its own type; this one is the tab-facing coordinator between them.
 */
export class PlanActions {
  private readonly checks: PlanChecks
  private readonly repairs: PlanRepairs
  private readonly approvals: PlanApprovals

  constructor(private readonly deps: PlanActionsDeps) {
    this.checks = new PlanChecks({
      sessions: deps.sessions,
      workspaceRoot: deps.workspaceRoot,
      profileFor: deps.profileFor,
      sendState: deps.sendState,
      changed: deps.changed,
      onClean: (plan) => this.buildFromSpec(plan),
    })
    this.repairs = new PlanRepairs({
      workspaceRoot: deps.workspaceRoot,
      sessions: deps.sessions,
      newSession: deps.newSession,
      sendState: deps.sendState,
    })
    this.approvals = new PlanApprovals({
      workspaceRoot: deps.workspaceRoot,
      sessions: deps.sessions,
      newSession: deps.newSession,
      sendState: deps.sendState,
      startCheck: (record) => this.checks.startCheck(record),
    })
  }

  checkOf(sessionId: string): RunState | undefined {
    return this.checks.checkOf(sessionId)
  }

  isApplying(feature: string): boolean {
    return this.approvals.isApplying(feature)
  }

  isReviewingDocs(feature: string): boolean {
    return this.approvals.isReviewingDocs(feature)
  }

  /**
   * The plan session of a tab. The tab is the feature, whichever of its runs
   * is speaking, so the plan bar's acts belong to the planner even while an
   * implementer or a cleanup holds the floor.
   */
  planRecordOf(shown: SessionRecord | undefined): SessionRecord | undefined {
    if (!shown?.feature) return shown
    return this.deps.sessions.list().find((r) => r.mode === 'plan' && r.feature === shown.feature) ?? shown
  }

  specPathOf(shown: SessionRecord | undefined): string | undefined {
    return shown?.feature ? specPath(this.deps.workspaceRoot, shown.feature) : undefined
  }

  /**
   * Picks a plan up where its spec leaves it: the plan session that wrote it
   * when one remains, at any stage, verified included (its transcript is the
   * context; the engine resumes on the next prompt), else a fresh plan session
   * told to read the files. The plan bar then offers what the stage allows:
   * review and mapping on a draft, implement on an approved one, the test run
   * on a tested board.
   */
  async resumePlan(feature: string, into?: ChatPanel): Promise<void> {
    const { workspaceRoot, sessions } = this.deps
    const path = specPath(workspaceRoot, feature)
    // The list is newest first; the latest session on the spec is the one that knows it best.
    const owner = sessions.list().find((r) => r.mode === 'plan' && r.feature && specPath(workspaceRoot, r.feature) === path)
    await pickUpPlan({
      courier: {
        open: (sessionId) => this.deps.open(sessionId, into),
        start: async (f, prompt, label) => {
          await this.deps.newSession('plan', f, prompt, into, label)
        },
      },
      cwd: workspaceRoot,
      feature,
      ...(owner ? { owner: { sessionId: owner.id } } : {}),
    })
  }

  /**
   * Starts a change on the feature shown: a new plan session on its settled
   * spec, carrying none of the conversation that shaped it. Refused while the
   * build still has something in flight, whatever the bar last showed.
   */
  async startChange(shown: SessionRecord | undefined, entry: ChatPanel): Promise<void> {
    const feature = shown?.feature
    if (!shown || !feature) return
    const plan = await this.deps.planState(shown)
    if (!plan?.changeable) throw new Error(`"${feature}" still has work in flight: nothing to change yet.`)
    await this.deps.newSession('plan', feature, changePrompt(feature), entry, 'Starting a change')
  }

  followCheck(child: SessionRecord, event: SessionEvent): void {
    this.checks.followCheck(child, event)
  }

  async startCheck(record: SessionRecord): Promise<void> {
    await this.checks.startCheck(record)
  }

  async stopCheck(shown: SessionRecord | undefined): Promise<void> {
    await this.checks.stopCheck(this.planRecordOf(shown))
  }

  /**
   * Nothing stands between the approved spec and the code: the board is
   * derived from the spec, keeping the progress of one it replaces. A first
   * board goes through the docs listing before the build starts, since the
   * spec as ruled is final now; a board re-derived mid-build goes straight on.
   */
  private async buildFromSpec(plan: SessionRecord): Promise<void> {
    const { workspaceRoot, build } = this.deps
    const feature = plan.feature!
    const spec = await readSpecState(specPath(workspaceRoot, feature))
    if (!spec.exists || spec.status !== 'approved') return
    const path = tasksPath(workspaceRoot, feature)
    const existing = await readBoard(path)
    const decisions = await readDecisions(decisionsPath(workspaceRoot, feature))
    await mkdir(dirname(path), { recursive: true })
    await writeBoard(path, deriveBoard(parseSpec(spec.body), existing, await readScenarioContext(contextPath(workspaceRoot, feature)), spec.built, decisions))
    await this.deps.sendState()
    if (existing) return build.implementAfterApproval(plan)
    await this.approvals.sendDocsReview(plan, feature)
  }

  async repairPlan(feature: string): Promise<MigrationReport> {
    return this.repairs.repairPlan(feature)
  }

  /** Every plan under `specs/`, the command's entry point. */
  async migratePlans(): Promise<void> {
    await this.repairs.migratePlans()
  }

  reportMigration(report: MigrationReport, handed: boolean): void {
    this.repairs.reportMigration(report, handed)
  }

  async approveSpec(shown: SessionRecord | undefined): Promise<void> {
    const record = this.planRecordOf(shown)
    const path = this.specPathOf(shown)
    const feature = record?.feature
    if (!record || !path || !feature) return
    await this.approvals.approveSpec(record, path)
  }

  async sendRulings(shown: SessionRecord | undefined): Promise<void> {
    const record = this.planRecordOf(shown)
    if (!record?.feature) return
    await this.approvals.sendRulings(record)
  }

  async ruleDecision(shown: SessionRecord | undefined, message: Extract<FromWebview, { type: 'rule_decision' }>): Promise<void> {
    const path = this.specPathOf(shown)
    const feature = shown?.feature
    if (!path || !feature) return
    await this.approvals.ruleDecision(path, feature, message)
  }

  async submitReview(shown: SessionRecord | undefined): Promise<void> {
    const record = this.planRecordOf(shown)
    if (!record?.feature) return
    await this.approvals.submitReview(record)
  }

  /** `task` names the blocked task to hand back; without it the build carries on where it stands. */
  async implementSpec(shown: SessionRecord | undefined, task?: string): Promise<void> {
    const record = this.planRecordOf(shown)
    const path = this.specPathOf(shown)
    if (record?.mode !== 'plan' || !record.feature || !path) return
    assertImplementable(await readSpecState(path), await readTasks(tasksPath(this.deps.workspaceRoot, record.feature)))
    await this.deps.build.startImplementing(record, true, task)
  }

  async reviewing(shown: SessionRecord | undefined, change: (review: Review, state: SpecState) => void, draftOnly = true): Promise<void> {
    const feature = shown?.feature
    const path = this.specPathOf(shown)
    if (!feature || !path) return
    await this.approvals.reviewing(feature, path, change, draftOnly)
  }

  /**
   * A plan turn ended: renames are followed and applied decisions cut to
   * their record, a repair the planner was asked for is finished
   * mechanically, and an approved spec the turn revised (rulings applied, or
   * a change asked for) is checked against the code again.
   */
  followPlanTurn(record: SessionRecord, feature: string, isError: boolean): void {
    // However the turn ended, the rulings are no longer in flight: Approve is the user's again, on the spec as it stands.
    const { applied, reviewed } = this.approvals.clearAfterTurn(feature)
    if (applied || reviewed) void this.deps.sendState()
    // The clean check was the go-ahead for the build; the docs listing was the last thing between it and the implementer.
    if (reviewed && !isError) void this.deps.build.implementAfterApproval(record)
    if (!isError) void this.followPlan(record)
  }

  private async followPlan(record: SessionRecord): Promise<void> {
    const { workspaceRoot } = this.deps
    const feature = record.feature!
    await followRenames(workspaceRoot, feature)
    await compactAppliedDecisions(decisionsPath(workspaceRoot, feature))
    if (await this.repairs.continueRepair(feature)) return
    const spec = await readSpecState(specPath(workspaceRoot, feature))
    const tasks = await readTasks(tasksPath(workspaceRoot, feature))
    const decisions = await readDecisions(decisionsPath(workspaceRoot, feature))
    if (checkDue(spec, tasks, decisions)) await this.checks.startCheck(record)
  }
}
