import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SessionManager, SessionMode, SessionRecord } from '../agent/session/session-manager'
import type { SessionEvent } from '../agent/session/code-session'
import type { ModelProfile, Step } from '../agent/session/model-profile'
import { readSpecState, type SpecState } from '../agent/phases/spec-file'
import { changePrompt, specPath } from '../agent/phases/blind-plan'
import { compactAppliedDecisions, decisionsPath, readDecisions } from '../agent/phases/decisions'
import { mappedFiles, writeMappingSnapshot } from '../agent/phases/mapping-snapshot'
import { contextPath, readScenarioContext } from '../agent/phases/scenario-context'
import { pickUpPlan } from '../agent/phases/plan-pickup'
import { startUpdate as startUpdateSpec } from '../agent/phases/update-spec'
import { assertImplementable } from '../agent/phases/implement'
import { checkDue } from '../agent/phases/plan-stage'
import { parseSpec, specFingerprint } from '../agent/phases/spec-model'
import { followRenames, type MigrationReport } from '../agent/phases/migrate-plan'
import { deriveBoard, readBoard, readTasks, tasksPath, writeBoard } from '../agent/phases/tasks-file'
import type { Review } from '../agent/phases/plan-review'
import type { FromWebview, PlanState, RunState } from './protocol'
import type { ChatPanel } from './panel-registry'
import type { FeatureBuild } from './feature-build'
import type { FeatureCleanup } from './feature-cleanup'
import { PlanChecks } from './plan-checks'
import { PlanRepairs } from './plan-repairs'
import { PlanApprovals } from './plan-approvals'

export type PlanActionsDeps = {
  workspaceRoot: string
  sessions: SessionManager
  /** What a step runs on. `attempt` counts the fixes of a failed test run. */
  profileFor: (step: Step, attempt?: number) => ModelProfile
  build: FeatureBuild
  cleanup: FeatureCleanup
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
  /** Features whose change or update was just asked for, past their draft; the plan bar stands at Plan until the revision lands back on `draft`. */
  private readonly startingChange = new Set<string>()
  /** Drafts whose pickup critique has yet to land; the tab stays on the chat until it has, since what the critique found is said there and nowhere else. */
  private readonly critiqueOwed = new Set<string>()

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

  isStartingChange(feature: string): boolean {
    return this.startingChange.has(feature)
  }

  /** Whether approving a spec goes on to start its build, as the toggle beside Approve stands. */
  startsOnApproval(): boolean {
    return this.approvals.startsOnApproval()
  }

  async setStartsOnApproval(on: boolean): Promise<void> {
    await this.approvals.setStartsOnApproval(on)
  }

  isCritiqueOwed(feature: string): boolean {
    return this.critiqueOwed.has(feature)
  }

  /** The revision landed back on `draft`: the bar reads the files again rather than standing at Plan on their old, settled word. */
  changeLanded(feature: string): void {
    this.startingChange.delete(feature)
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
   * on a tested board. `note` is what the person had typed where they picked
   * the plan up from, said in the plan's chat in their own words.
   */
  async resumePlan(feature: string, into?: ChatPanel, note?: string): Promise<void> {
    const { workspaceRoot, sessions } = this.deps
    const path = specPath(workspaceRoot, feature)
    // The list is newest first; the latest session on the spec is the one that knows it best.
    const owner = sessions.list().find((r) => r.mode === 'plan' && r.feature && specPath(workspaceRoot, r.feature) === path)
    await pickUpPlan({
      courier: {
        open: (sessionId) => this.deps.open(sessionId, into),
        start: async (f, prompt, label) => (await this.deps.newSession('plan', f, prompt, into, label))?.id,
        say: (sessionId, text) => sessions.send(sessionId, text),
        tell: (sessionId, text, label) => sessions.send(sessionId, text, label),
        critiqueOwed: (f) => void this.critiqueOwed.add(f),
      },
      cwd: workspaceRoot,
      feature,
      ...(owner ? { owner: { sessionId: owner.id, ...(owner.specSeen ? { specSeen: owner.specSeen } : {}) } } : {}),
      ...(note ? { note } : {}),
    })
  }

  /**
   * Starts a change on the feature shown: a new plan session on its settled
   * spec, carrying none of the conversation that shaped it. Refused while the
   * build still has something in flight, whatever the bar last showed. Never
   * handed to whatever conversation the tab happened to show: a cleanup
   * offer not yet settled is dropped rather than left to run over code the
   * change is about to rewrite, and the bar stands at Plan until the
   * revision lands back on `draft`.
   */
  async startChange(shown: SessionRecord | undefined, entry: ChatPanel): Promise<void> {
    const feature = shown?.feature
    if (!shown || !feature) return
    const plan = await this.deps.planState(shown)
    if (!plan?.changeable) throw new Error(`"${feature}" still has work in flight: nothing to change yet.`)
    this.startingChange.add(feature)
    this.deps.cleanup.clear(feature)
    await this.deps.newSession('plan', feature, changePrompt(feature), entry, 'Starting a change')
  }

  /**
   * The new-session screen's "Update spec": picks a feature's spec,
   * whatever its state, and starts or carries on its planning session with
   * the description as the developer's own first message rather than a
   * prompt written for them. Same guarantees as a change: a stale cleanup
   * offer is dropped, and the bar stands at Plan until the revision lands.
   */
  async startUpdate(feature: string, description: string, into: ChatPanel): Promise<void> {
    const { workspaceRoot, sessions } = this.deps
    const path = specPath(workspaceRoot, feature)
    const owner = sessions.list().find((r) => r.mode === 'plan' && r.feature && specPath(workspaceRoot, r.feature) === path)
    await startUpdateSpec({
      courier: {
        open: (sessionId) => this.deps.open(sessionId, into),
        start: async (f, prompt, label) => (await this.deps.newSession('plan', f, prompt, into, label))?.id,
        say: (sessionId, text) => sessions.send(sessionId, text),
        tell: (sessionId, text, label) => sessions.send(sessionId, text, label),
        critiqueOwed: (f) => void this.critiqueOwed.add(f),
      },
      cwd: workspaceRoot,
      feature,
      description,
      ...(owner ? { owner: { sessionId: owner.id } } : {}),
    })
    // Refused above (still at work) throws before this line; reached only once the description is on its way.
    this.startingChange.add(feature)
    this.deps.cleanup.clear(feature)
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
   * derived from the spec, keeping the progress of one it replaces, and the
   * files it was mapped to are kept as they now read, for the build start to
   * compare against. A first board goes through the docs listing before the
   * build starts, since the spec as ruled is final now; a board re-derived
   * mid-build goes straight on. Whether the build starts at all is the
   * person's, settled on the toggle beside Approve.
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
    const board = deriveBoard(parseSpec(spec.body), existing, await readScenarioContext(contextPath(workspaceRoot, feature)), spec.built, decisions)
    await writeBoard(path, board)
    // The check has just read these files: what they say now is what the board was derived from, and what a later build start is told it has moved from.
    await writeMappingSnapshot(workspaceRoot, feature, mappedFiles(board.tasks))
    await this.deps.sendState()
    // The docs listing belongs to approval and happens either way; only the build waits for the person when they asked it to.
    if (existing) {
      if (this.approvals.startsOnApproval()) await build.implementAfterApproval(plan)
      return
    }
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
    // A turn that went through has said what it found: the critique is no longer owed and the tab is free to show the spec again.
    const critiqued = !isError && this.critiqueOwed.delete(feature)
    if (applied || reviewed || critiqued) void this.deps.sendState()
    // The clean check was the go-ahead for the build; the docs listing was the last thing between it and the implementer.
    if (reviewed && !isError && this.approvals.startsOnApproval()) void this.deps.build.implementAfterApproval(record)
    if (!isError) void this.followPlan(record)
  }

  private async followPlan(record: SessionRecord): Promise<void> {
    const { workspaceRoot } = this.deps
    const feature = record.feature!
    await followRenames(workspaceRoot, feature)
    await compactAppliedDecisions(decisionsPath(workspaceRoot, feature))
    const spec = await readSpecState(specPath(workspaceRoot, feature))
    if (spec.exists) await this.deps.sessions.noteSpecSeen(record.id, specFingerprint(parseSpec(spec.body)))
    if (await this.repairs.continueRepair(feature)) return
    const tasks = await readTasks(tasksPath(workspaceRoot, feature))
    const decisions = await readDecisions(decisionsPath(workspaceRoot, feature))
    if (checkDue(spec, tasks, decisions)) await this.checks.startCheck(record)
  }
}
