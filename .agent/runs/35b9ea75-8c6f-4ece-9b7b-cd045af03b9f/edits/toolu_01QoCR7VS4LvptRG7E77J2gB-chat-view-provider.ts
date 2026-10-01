import * as vscode from 'vscode'
import { isBuild, isFeatureless, isPlanning, pickConversationalRun, type SessionManager, type SessionMode, type SessionRecord } from '../agent/session/session-manager'
import type { ModelProfile } from '../agent/session/model-profile'
import type { McpServerState, SessionEvent } from '../agent/session/code-session'
import { blockOf, lastFailure, mostUrgent, nextStatus, type SessionStatus } from '../agent/session/session-status'
import { readSpecState, setSpecStatus, type SpecState } from '../agent/phases/spec-file'
import {
  PLAN_DIR,
  decisionsHandoffPrompt,
  docsReviewPrompt,
  featureSlug,
  migrateSpecPrompt,
  resumePlanPrompt,
  rulingsHandoffPrompt,
  specPath,
} from '../agent/phases/blind-plan'
import { assertAllRuled, assertRulingsSent, compactAppliedDecisions, decisionsFile, decisionsPath, openDecisions, pendingDecisions, readDecisions, withRuling } from '../agent/phases/decisions'
import { listPlans } from '../agent/phases/plan-list'
import { progressLine, reconcileKickoff } from '../agent/phases/reconcile'
import { TASK_CARRY_ON, assertImplementable, fixKickoff, implementationStarts, taskKickoff, taskSettled } from '../agent/phases/implement'
import { cleanupKickoff } from '../agent/phases/cleanup'
import { anyLimit, oversizedFiles, sizeReport, type Limits, type Oversized } from '../agent/cleanup/oversized'
import { editedFiles } from '../agent/edits/edited-files'
import { checkDue, isApprovable, planStage, tasksStale } from '../agent/phases/plan-stage'
import { parseSpec } from '../agent/phases/spec-model'
import { followRenames, migratePlan, type MigrationReport } from '../agent/phases/migrate-plan'
import {
  changeBoard,
  deriveBoard,
  nextTask,
  readBoard,
  readTasks,
  recordCleanupDecision,
  sameName,
  tasksDone,
  tasksPath,
  updateTask,
  writeBoard,
  type TasksState,
} from '../agent/phases/tasks-file'
import { describeCommand, runVerification, verificationDue, type CommandRunner, type VerificationFailure, type VerifyRule } from '../agent/phases/verification'
import {
  addComment,
  assertApprovable,
  assertCommentable,
  editComment,
  emptyReview,
  isCommentable,
  readReview,
  removeComment,
  resolveComment,
  reviewPath,
  strikeItem,
  unstrikeItem,
  writeReview,
  type Review,
} from '../agent/phases/plan-review'
import { submitReview, type ReviewCourier } from '../agent/phases/review-handoff'
import { editDiffTitle, editLine, isRunSnapshot, runsRoot } from '../agent/edits/open-edit'
import { buildRepoMap } from '../agent/repo-map/build-map'
import { finishDocsMap, planDocsMap, readDocsSummary, startDocsMap, type DocsMapResult } from '../agent/docs-map/build'
import { docsMapKickoff } from '../agent/phases/docs-map'
import { docsEvaluationKickoff } from '../agent/phases/docs-evaluation'
import { fileDecisionsKickoff } from '../agent/phases/file-decisions'
import { readUnfiled } from '../agent/phases/unfiled-decisions'
import { sharedBuild } from '../agent/session/generated-context'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { linkedFilePath, withLinkedFiles } from './linked-files'
import type {
  CleanupSweep,
  CleanupUnit,
  FromWebview,
  PlanState,
  ResumableChat,
  RunRef,
  RunSection,
  RunState,
  SessionTab,
  ToWebview,
} from './protocol'
import { webviewHtml } from './webview-html'
import type { ProfileDefaults } from '../settings/settings-store'

/** A per-session on/off switch the composer shows. */
export interface SessionSwitch {
  isEnabled(sessionId: string): boolean
  setEnabled(sessionId: string, enabled: boolean): void
}

/** The test run: its rules from settings, read when it starts, and the shell that runs them. */
export interface Verifier {
  rules(): VerifyRule[]
  run: CommandRunner
  /** Consecutive failed runs handed to the implementer before the failed record is left for the user. */
  failureBudget(): number
}

/** The cleanup after a feature's tests pass: its size limits and what never gets measured, from settings, read when the run starts. */
export interface SizeLimits {
  limits(): Limits
  /** Globs, workspace-relative, of files the measure passes over: generated code. */
  ignore(): string[]
}

/** Where a prompt's allowances go: the workspace's permission allow list, or the session's own, which lasts as long as the extension host. */
export interface PermissionStore {
  allowForProject(rules: string[]): Promise<void>
  allowForSession(sessionId: string, rules: string[]): void
}

/** What new sessions run on, as the new-session screen shows and sets it. */
export interface ProfileDefaultsStore {
  read(): ProfileDefaults
  set(name: string): Promise<void>
}

/** The editor panel's view type; a serializer registered under it brings the panel back after a reload. */
export const CHAT_PANEL_TYPE = 'kiwiAgent.chatPanel'

/**
 * Hosts the chat UI, in the sidebar view and in editor panels. Every attached
 * webview shows the same active session; the provider fans events out and
 * tracks each session's status for the tabs and the Sessions view.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  private readonly webviews = new Set<vscode.Webview>()
  private readonly statuses = new Map<string, SessionStatus>()
  /** Per session, why its last turn failed; absent once a turn goes through or the next prompt is sent. */
  private readonly failures = new Map<string, string>()
  /** The check against the code under each plan session, by the plan session's id: the current step, or how the last run ended. */
  private readonly checks = new Map<string, RunState>()
  /** The test run per feature: what it is doing, or how the last one ended. */
  private readonly verifications = new Map<string, RunState>()
  /** Consecutive failed test runs per feature; a pass or a manual run resets it. */
  private readonly verifyFailures = new Map<string, number>()
  /** The cleanup run per feature: what it is doing, or how the last one ended. */
  private readonly cleanups = new Map<string, RunState>()
  /** What the last size sweep found per feature: the offer the user rules on. Absent until one has run in this window. */
  private readonly sweeps = new Map<string, Oversized[]>()
  /** Features whose planner was handed the contract problems; its next finished turn completes the migration. */
  private readonly repairing = new Set<string>()
  /** Features whose rulings were handed to the planner; Approve waits for that turn to end rather than sending them twice. */
  private readonly applying = new Set<string>()
  /** Features whose planner is listing what the docs should now say, right after approval; Implement waits for that turn. */
  private readonly reviewingDocs = new Set<string>()
  /** Per running session, its MCP servers as the engine last reported them. */
  private readonly mcpServers = new Map<string, McpServerState[]>()
  /** The docs map build in flight: the run's session, where its progress goes, and the turn its caller waits on. */
  private docsMapRun: { sessionId: string; progress: (line: string) => void; done: (errors: string[]) => void } | undefined
  private readonly changed = new vscode.EventEmitter<void>()
  /** Fires when the active session, a status or the session list changed. */
  readonly onDidChange = this.changed.event
  private activeSessionId: string | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionManager,
    private readonly profileFor: (mode: SessionMode) => ModelProfile,
    private readonly profileDefaults: ProfileDefaultsStore,
    private readonly registeredModels: () => ModelProfile[],
    private readonly verifier: Verifier,
    private readonly sizeLimits: SizeLimits,
    private readonly allowWrites: SessionSwitch,
    private readonly permissions: PermissionStore,
    private readonly workspaceRoot: string,
    private readonly memento: vscode.Memento,
  ) {
    // The open session survives a window reload; its engine resumes on the next prompt.
    const remembered = memento.get<string>('activeSessionId')
    if (remembered && sessions.get(remembered)) this.activeSessionId = remembered
  }

  get activeId(): string | undefined {
    return this.activeSessionId
  }

  private setActive(id: string | undefined): void {
    this.activeSessionId = id
    void this.memento.update('activeSessionId', id)
  }

  /** A session's status, or its running check's: the check has no tab, so its state shows on the plan's. */
  statusOf(sessionId: string): SessionStatus {
    const child = this.sessions.liveChildOf(sessionId)
    return this.statuses.get(child?.id ?? sessionId) ?? 'idle'
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.attach(view.webview)
    view.onDidDispose(() => this.webviews.delete(view.webview))
  }

  openInEditor(): void {
    // A panel joins the group an open one already sits in, as another tab there, rather than splitting the editor again.
    const column = [...this.panels].find((p) => p.viewColumn !== undefined)?.viewColumn ?? vscode.ViewColumn.Beside
    this.adoptPanel(vscode.window.createWebviewPanel(CHAT_PANEL_TYPE, 'KiwiAgent', column, { retainContextWhenHidden: true }))
  }

  /** A new editor panel, or one VS Code revived after a window reload. */
  adoptPanel(panel: vscode.WebviewPanel): void {
    this.panels.add(panel)
    this.attach(panel.webview)
    panel.onDidDispose(() => {
      this.panels.delete(panel)
      this.webviews.delete(panel.webview)
    })
  }

  async newSession(mode: SessionMode, feature?: string, prompt?: string): Promise<SessionRecord> {
    if (!isFeatureless(mode) && !feature) throw new Error(`A ${mode} session needs a feature name`)
    const record = await this.sessions.create(this.profileFor(mode), mode, feature)
    // Approving the plan is the consent for the writes it maps out, so the switch starts on where a build session carries it out.
    if (mode === 'implement' || mode === 'cleanup') this.allowWrites.setEnabled(record.id, true)
    return await this.activate(record, prompt)
  }

  /** Makes a newly created session the one on screen, and sends its first prompt when there is one. */
  private async activate(record: SessionRecord, prompt?: string): Promise<SessionRecord> {
    this.setActive(record.id)
    await this.sendState()
    // A run on a feature joins the tab that feature already has, so the whole tab is sent, not this run alone.
    await this.sendTranscript(record.id)
    this.changed.fire()
    if (prompt) await this.sessions.send(record.id, prompt)
    return record
  }

  showNewSession(): void {
    // The plan list is read fresh, so a spec written since the last state is offered.
    void this.sendState()
    this.broadcast({ type: 'show_new_session' })
  }

  /** Re-reads what the state carries from settings, after they changed elsewhere. */
  refresh(): void {
    void this.sendState()
  }

  /**
   * Picks a plan up where its spec leaves it: the plan session that wrote it
   * when one remains (its transcript is the context; the engine resumes on the
   * next prompt), else a fresh plan session told to read the files. The plan
   * bar then offers what the stage allows: review and mapping on a draft,
   * implement on an approved one, the test run on a tested board.
   */
  async resumePlan(feature: string): Promise<void> {
    const path = specPath(this.workspaceRoot, feature)
    const state = await readSpecState(path)
    if (!state.exists) throw new Error(`No spec for "${feature}" under ${PLAN_DIR}/.`)
    const tasks = await readTasks(tasksPath(this.workspaceRoot, feature))
    if (state.status === 'implemented' || (state.status === 'approved' && tasks.exists && tasksDone(tasks.tasks) && tasks.verification?.ok)) {
      throw new Error(`"${feature}" is verified: plan the next change as its own feature.`)
    }
    // The list is newest first; the latest session on the spec is the one that knows it best.
    const owner = this.sessions.list().find((r) => r.mode === 'plan' && r.feature && specPath(this.workspaceRoot, r.feature) === path)
    if (owner) await this.open(owner.id)
    else await this.newSession('plan', feature, resumePlanPrompt(feature))
  }

  async open(sessionId: string): Promise<void> {
    if (!this.sessions.get(sessionId)) return
    this.setActive(sessionId)
    await this.sendState()
    await this.sendTranscript(sessionId)
    this.changed.fire()
  }

  /** Closing a tab closes the feature it stands for: every run under it, not the one the tab is keyed by. */
  async close(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    const runs = record ? this.runsOf(record) : []
    for (const run of runs) await this.sessions.close(run.id)
    if (runs.length === 0) await this.sessions.close(sessionId)
    if (runs.some((r) => r.id === this.activeSessionId) || this.activeSessionId === sessionId) this.setActive(undefined)
    void this.sendState()
    this.changed.fire()
  }

  async remove(sessionId: string): Promise<void> {
    await this.sessions.remove(sessionId)
    this.statuses.delete(sessionId)
    this.failures.delete(sessionId)
    if (this.activeSessionId === sessionId) this.setActive(undefined)
    void this.sendState()
    this.changed.fire()
  }

  /** Called by the session manager for every event of every session. */
  onSessionEvent(sessionId: string, event: SessionEvent): void {
    const record = this.sessions.get(sessionId)
    if (record) {
      const before = this.statuses.get(sessionId) ?? 'idle'
      const after = nextStatus(before, record.mode, event)
      const failure = lastFailure(this.failures.get(sessionId), event)
      const failureChanged = failure !== this.failures.get(sessionId)
      if (failure === undefined) this.failures.delete(sessionId)
      else this.failures.set(sessionId, failure)
      if (after !== before || failureChanged) {
        this.statuses.set(sessionId, after)
        void this.sendState()
        this.changed.fire()
      }
    }
    // A build has no tab and nobody prompts it: its events are progress for whoever is waiting.
    if (record && isBuild(record.mode)) {
      this.followDocsMap(record, event)
      return
    }
    // A run under a session keeps its one line on the plan bar, and now also fills its own section of the tab.
    if (record?.parentId) {
      if (record.mode === 'cleanup') this.followCleanup(record, event)
      else if (record.mode === 'implement') void this.followTask(record, event)
      else this.followCheck(record, event)
    }
    if (record && this.underActiveTab(record)) {
      this.broadcast({ type: 'event', sessionId: this.tabIdOf(record), run: this.runRef(record, this.currentRun(record)), event })
    }
    // A task run can hold the floor, so its servers are what the composer shows while it does.
    if (event.type === 'mcp_servers') {
      this.mcpServers.set(sessionId, event.servers)
      void this.sendState()
    }
    if (event.type === 'ended') this.mcpServers.delete(sessionId)
    if (record?.parentId) return
    if (event.type === 'session_started' || event.type === 'ended') {
      void this.sendState()
      this.changed.fire()
    }
    if (event.type === 'tool_result' && record?.feature && sessionId === this.activeSessionId) {
      // The session just wrote a plan file (a revision, proposals, a task's progress); the plan bar and view must follow.
      void this.sendState()
    }
    if (event.type === 'turn_done' && !event.isError && record?.mode === 'implement' && record.feature) {
      const feature = record.feature
      // A task run under the plan follows its amendment in followTask, before the next task starts.
      if (record.parentId) void this.followBoard(feature)
      else void this.followAmendment(feature).then(() => this.followBoard(feature))
    }
    if (event.type === 'turn_done' && record?.mode === 'plan' && record.feature) {
      // However the turn ended, the rulings are no longer in flight: Approve is the user's again, on the spec as it stands.
      const applied = this.applying.delete(record.feature)
      const reviewed = this.reviewingDocs.delete(record.feature)
      if (applied || reviewed) void this.sendState()
      // The clean check was the go-ahead for the build; the docs listing was the last thing between it and the implementer.
      if (reviewed && !event.isError) void this.implementAfterApproval(record)
      if (!event.isError) void this.followPlan(record)
    }
  }

  /**
   * A plan turn ended: renames are followed and applied decisions cut to
   * their record, a repair the planner was asked for is finished
   * mechanically, and an approved spec the turn revised (rulings applied, or
   * a change asked for) is checked against the code again.
   */
  private async followPlan(record: SessionRecord): Promise<void> {
    const feature = record.feature!
    await followRenames(this.workspaceRoot, feature)
    await compactAppliedDecisions(decisionsPath(this.workspaceRoot, feature))
    if (this.repairing.delete(feature)) {
      const report = await migratePlan(this.workspaceRoot, feature)
      this.reportMigration(report, false)
      await this.sendState()
      if (report.problems.length > 0) return
    }
    const spec = await readSpecState(specPath(this.workspaceRoot, feature))
    const tasks = await readTasks(tasksPath(this.workspaceRoot, feature))
    const decisions = await readDecisions(decisionsPath(this.workspaceRoot, feature))
    if (checkDue(spec, tasks, decisions)) await this.startCheck(record)
  }

  /** A check has no transcript in the UI: its events become the one line the plan bar shows. */
  private followCheck(child: SessionRecord, event: SessionEvent): void {
    const parentId = child.parentId!
    const check = this.checks.get(parentId)
    if (!check?.live) return
    if (event.type === 'turn_done') {
      void this.finishCheck(child, event.isError ? (event.errors.length > 0 ? event.errors : ['the run ended with an error']) : [])
      return
    }
    if (event.type === 'error' && event.fatal) {
      void this.finishCheck(child, [event.message])
      return
    }
    const line = progressLine(event)
    if (line === undefined || line === check.text) return
    this.checks.set(parentId, { live: true, text: line })
    void this.sendState()
  }

  /**
   * Checks the plan session's approved spec against the code as a run under
   * it; nothing happens while one is live. A re-check continues the last
   * check's conversation where the engine resumes, so the code it read is not
   * read again.
   */
  private async startCheck(record: SessionRecord): Promise<void> {
    if (record.mode !== 'plan' || !record.feature || this.sessions.liveChildOf(record.id)) return
    const spec = await readSpecState(specPath(this.workspaceRoot, record.feature))
    if (!spec.exists || spec.status !== 'approved') return
    const previous = this.sessions.latest('reconcile', record.feature)
    const child = await this.sessions.create(this.profileFor('reconcile'), 'reconcile', record.feature, { parentId: record.id, continues: previous })
    this.checks.set(record.id, { live: true, text: 'Checking the spec against the code…' })
    await this.sendState()
    await this.sessions.send(child.id, reconcileKickoff(child.engineSessionId !== undefined))
  }

  /**
   * The run is over: stop its engine and read what it left in the decisions
   * file. Decisions without a proposal go to the planner to propose on. With
   * nothing pending the board is derived from the spec and the build goes on.
   */
  private async finishCheck(child: SessionRecord, errors: string[]): Promise<void> {
    const parentId = child.parentId!
    // Marked over before the first await, so a late event from the dying engine cannot finish it twice.
    this.checks.set(parentId, { live: false, text: this.checks.get(parentId)?.text ?? '' })
    await this.sessions.close(child.id)
    let clean = false
    let text: string
    const feature = child.feature!
    if (errors.length > 0) {
      text = `Check failed: ${errors.join('; ')}`
    } else {
      const decisions = await readDecisions(decisionsPath(this.workspaceRoot, feature))
      const open = openDecisions(decisions)
      clean = pendingDecisions(decisions).length === 0
      text = `Checked: ${open.length === 0 ? 'the code is clear' : `${open.length} decision${open.length === 1 ? '' : 's'}`}`
      const unproposed = open.filter((d) => d.proposals.length === 0).map((d) => d.title)
      if (unproposed.length > 0 && this.sessions.get(parentId)) {
        await this.sessions.send(parentId, decisionsHandoffPrompt(feature, unproposed))
      }
    }
    this.checks.set(parentId, { live: false, text })
    await this.sendState()
    this.changed.fire()
    const plan = this.sessions.get(parentId)
    if (clean && plan) await this.buildFromSpec(plan)
  }

  /**
   * Nothing stands between the approved spec and the code: the board is
   * derived from the spec, keeping the progress of one it replaces. A first
   * board goes through the docs listing before the build starts, since the
   * spec as ruled is final now; a board re-derived mid-build goes straight on.
   */
  private async buildFromSpec(plan: SessionRecord): Promise<void> {
    const feature = plan.feature!
    const spec = await readSpecState(specPath(this.workspaceRoot, feature))
    if (!spec.exists || spec.status !== 'approved') return
    const path = tasksPath(this.workspaceRoot, feature)
    const existing = await readBoard(path)
    await mkdir(dirname(path), { recursive: true })
    await writeBoard(path, deriveBoard(parseSpec(spec.body), existing))
    await this.sendState()
    if (existing) return this.implementAfterApproval(plan)
    this.reviewingDocs.add(feature)
    await this.sendToPlanner(plan, docsReviewPrompt(feature))
  }

  /**
   * An implementer's turn ended: a board left all tested without a passing
   * run gets the test run, whether the turn marked the last task or fixed the
   * code after a failed run. A board that already passed is left alone.
   */
  private async followBoard(feature: string): Promise<void> {
    const tasks = await readTasks(tasksPath(this.workspaceRoot, feature))
    if (verificationDue(tasks)) await this.verify(feature, false)
  }

  /**
   * An implementer's turn ended with the spec changed under the board: the
   * user's answer amended a rule. The board is derived again, keeping its
   * progress, without a check against the code: the run that amended the rule
   * has read that code already.
   */
  private async followAmendment(feature: string): Promise<void> {
    const spec = await readSpecState(specPath(this.workspaceRoot, feature))
    const path = tasksPath(this.workspaceRoot, feature)
    if (!spec.exists || !tasksStale(spec, await readTasks(path))) return
    const existing = await readBoard(path)
    if (!existing) return
    await writeBoard(path, deriveBoard(parseSpec(spec.body), existing))
    await this.sendState()
  }

  /**
   * Runs the test commands over the tasks' files, records the outcome, and
   * hands a failure to the implementer, up to the budget of consecutive
   * failures; past it the failed record waits for the user. A manual run
   * starts the count over.
   */
  private async verify(feature: string, manual: boolean): Promise<void> {
    if (this.verifications.get(feature)?.live) return
    if (manual) this.verifyFailures.delete(feature)
    // A new run makes the last cleanup's outcome old news; one still running folds this run into its own.
    if (!this.cleanups.get(feature)?.live) this.cleanups.delete(feature)
    this.verifications.set(feature, { live: true, text: 'Running the tests…' })
    await this.sendState()
    let text: string
    let passed = false
    try {
      const outcome = await runVerification({
        cwd: this.workspaceRoot,
        feature,
        rules: this.verifier.rules(),
        run: this.verifier.run,
        onStart: (command) => {
          this.verifications.set(feature, { live: true, text: `Running ${describeCommand(command, this.workspaceRoot)}` })
          void this.sendState()
        },
      })
      if (outcome.record.ok) {
        this.verifyFailures.delete(feature)
        text = `Tests passed: ${outcome.record.text}`
        passed = true
      } else {
        const failures = (this.verifyFailures.get(feature) ?? 0) + 1
        this.verifyFailures.set(feature, failures)
        text = `Tests failed: ${outcome.record.text}`
        if (failures <= this.verifier.failureBudget()) await this.handToImplementer(feature, outcome.failures)
        else text += ` (${failures} in a row; fix it and verify again)`
      }
    } catch (error) {
      text = `Test run failed: ${error instanceof Error ? error.message : String(error)}`
    }
    this.verifications.set(feature, { live: false, text })
    await this.sendState()
    this.changed.fire()
    if (passed) await this.sweepForCleanup(feature)
  }

  /** The docs listing after approval has ended: the build starts on its own, so approving is the only act it takes. */
  private async implementAfterApproval(record: SessionRecord): Promise<void> {
    const feature = record.feature!
    try {
      const spec = await readSpecState(specPath(this.workspaceRoot, feature))
      const tasks = await readTasks(tasksPath(this.workspaceRoot, feature))
      if (!implementationStarts(spec, tasks, this.implementerLive(feature))) return
      await this.startImplementing(record)
    } catch (error) {
      void vscode.window.showErrorMessage(`KiwiAgent: cannot start the implementation: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * A build the last window cut off mid-turn goes on where it stood, once per
   * feature: a task run carries its task on, a run fixing a failed sweep hands
   * the board back to the sweep. A run stopped on the user keeps waiting.
   */
  async resumeCutOffBuilds(): Promise<void> {
    const resumed = new Set<string>()
    for (const run of await this.sessions.takeCutOff()) {
      if (run.mode !== 'implement' || !run.feature || resumed.has(run.feature)) continue
      resumed.add(run.feature)
      const plan = (run.parentId ? this.sessions.get(run.parentId) : undefined) ?? this.sessions.latest('plan', run.feature)
      if (run.task !== undefined && plan) await this.implementAfterApproval(plan)
      else if (run.task === undefined) {
        await this.followBoard(run.feature).catch((error: unknown) => {
          void vscode.window.showErrorMessage(`KiwiAgent: cannot resume the test run: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
    }
  }

  /**
   * The next unfinished task gets a run of its own under the plan's tab,
   * started on the board's hand-off rather than on a conversation grown
   * through every task before it; the run that stopped on that task picks it
   * up again instead. With no task left the board goes to the test sweep.
   */
  private async startImplementing(plan: SessionRecord): Promise<void> {
    const feature = plan.feature!
    const path = tasksPath(this.workspaceRoot, feature)
    const board = await readBoard(path)
    const task = board ? nextTask(board) : undefined
    if (!board || !task) return this.followBoard(feature)
    const previous = this.sessions.list().find((r) => r.mode === 'implement' && r.feature === feature && r.task !== undefined && sameName(r.task, task.name))
    if (previous) {
      if (this.statuses.get(previous.id) === 'implementing') return
      // The switch does not outlive the window, and the approval that turned it on still stands.
      this.allowWrites.setEnabled(previous.id, true)
      await this.sessions.send(previous.id, TASK_CARRY_ON)
      return
    }
    const spec = await readSpecState(specPath(this.workspaceRoot, feature))
    if (!spec.exists) return
    // Started by the host, so the run's only board call is the one that records how the task ended.
    const started = await changeBoard(path, (b) => updateTask(b, task.name, { state: 'in_progress' }))
    const run = await this.sessions.create(this.profileFor('implement'), 'implement', feature, { parentId: plan.id, task: task.name })
    this.allowWrites.setEnabled(run.id, true)
    await this.sendState()
    const decisions = await readDecisions(decisionsPath(this.workspaceRoot, feature))
    await this.sessions.send(run.id, taskKickoff(started, task.name, parseSpec(spec.body), decisions))
  }

  /**
   * A task run's turn ended. Its task settled: the run is closed and the next
   * task's run starts. Not settled: the run waits for the user, who can carry
   * it on. A run that fixed a failed sweep is closed and hands the board back
   * to the sweep.
   */
  private async followTask(record: SessionRecord, event: SessionEvent): Promise<void> {
    // The run moves its task on the board; the plan view shows the board, so it follows.
    if (event.type === 'tool_result' && this.underActiveTab(record)) void this.sendState()
    if (event.type !== 'turn_done' || event.isError) return
    const feature = record.feature!
    await this.followAmendment(feature)
    if (record.task === undefined) {
      // A fix run is over once the board goes back to the test run; left open, it holds the plan's tab against the cleanup.
      if (!verificationDue(await readTasks(tasksPath(this.workspaceRoot, feature)))) return
      await this.sessions.close(record.id)
      return this.verify(feature, false)
    }
    const board = await readBoard(tasksPath(this.workspaceRoot, feature))
    if (!board || !taskSettled(board, record.task)) return
    await this.sessions.close(record.id)
    const plan = this.sessions.get(record.parentId!)
    if (plan) await this.startImplementing(plan)
  }

  /** An implementer at work on the feature: nothing starts a second one. */
  private implementerLive(feature: string): boolean {
    return this.sessions.list().some((r) => r.mode === 'implement' && r.feature === feature && this.sessions.isLive(r.id))
  }

  /**
   * A failed sweep goes to a run of its own under the plan's tab, started on
   * the failure and the tasks it names rather than on whichever task ran last.
   */
  private async handToImplementer(feature: string, failures: VerificationFailure[]): Promise<void> {
    const board = await readBoard(tasksPath(this.workspaceRoot, feature))
    if (!board) return
    const plan = this.sessions.latest('plan', feature)
    const run = await this.sessions.create(this.profileFor('implement'), 'implement', feature, plan ? { parentId: plan.id } : {})
    this.allowWrites.setEnabled(run.id, true)
    await this.sendState()
    await this.sessions.send(run.id, fixKickoff(feature, board, failures, this.workspaceRoot))
  }

  /**
   * The tests passed: the files the feature's implementers edited are
   * measured. Nothing is split on this alone. What is over a limit is an
   * offer the user rules on at the Cleanup step, since a split is a change to
   * code they have just seen proven.
   */
  private async sweepForCleanup(feature: string): Promise<void> {
    if (this.cleanups.get(feature)?.live) return
    const limits = this.sizeLimits.limits()
    // A sweep that cannot measure still settles the step: an offer never made would hold the Cleanup step open with nothing to act on.
    if (!anyLimit(limits)) return this.sizesUnchecked(feature, 'no size limits are set')
    const tasks = await readTasks(tasksPath(this.workspaceRoot, feature))
    // Skipped is the user's word that this feature is finished; done is the split already carried out.
    if (tasks.exists && (tasks.cleanup === 'skipped' || tasks.cleanup === 'done')) return
    const implementers = this.sessions.list().filter((r) => r.mode === 'implement' && r.feature === feature)
    if (implementers.length === 0) return this.sizesUnchecked(feature, 'no implementer session is left to say which files it edited')
    const files: string[] = []
    for (const record of implementers) {
      for (const file of editedFiles(await this.sessions.transcript(record.id))) if (!files.includes(file)) files.push(file)
    }
    const flagged = await oversizedFiles(this.workspaceRoot, files, limits, this.sizeLimits.ignore())
    this.sweeps.set(feature, flagged)
    if (flagged.length === 0) this.cleanups.set(feature, { live: false, text: 'Sizes checked: nothing to split' })
    await this.sendState()
    this.changed.fire()
  }

  private async sizesUnchecked(feature: string, why: string): Promise<void> {
    this.sweeps.set(feature, [])
    this.cleanups.set(feature, { live: false, text: `Sizes not checked: ${why}` })
    await this.sendState()
    this.changed.fire()
  }

  /**
   * The user asked for the split: the units the last sweep found, in the files
   * picked (all when none are named), go to a cleanup run under the plan's tab.
   * It starts on the size report and reads the files itself: the implementers
   * were one run per task, so none of them holds all of the feature's files.
   */
  private async runCleanup(feature: string, picked?: string[]): Promise<void> {
    const refuse = (why: string) => void vscode.window.showWarningMessage(`KiwiAgent: cannot start the cleanup: ${why}`)
    if (this.cleanups.get(feature)?.live) return refuse('one is already running')
    const relativeTo = (file: string) => relative(this.workspaceRoot, file).split('\\').join('/')
    const flagged = (this.sweeps.get(feature) ?? []).filter((u) => picked === undefined || picked.includes(relativeTo(u.path)))
    if (flagged.length === 0) return refuse('none of the picked files are in the last size sweep')
    const parent = this.sessions.latest('plan', feature) ?? this.sessions.list().find((r) => r.mode === 'implement' && r.feature === feature && !r.parentId)
    if (!parent) return refuse(`no plan session is left for "${feature}"`)
    const busy = this.sessions.liveChildOf(parent.id)
    if (busy) return refuse(`"${busy.title}" is still running under the plan; close it first`)
    const paths = [...new Set(flagged.map((u) => relativeTo(u.path)))]
    const child = await this.sessions.create(this.profileFor('cleanup'), 'cleanup', feature, { parentId: parent.id, files: paths })
    this.cleanups.set(feature, { live: true, text: 'Splitting oversized units…' })
    await this.sendState()
    await this.sessions.send(child.id, cleanupKickoff(sizeReport(this.workspaceRoot, flagged), false))
  }

  /** A flagged unit as the plan view reads it: the path workspace-relative, so it links like every other path there. */
  private cleanupUnit(unit: Oversized): CleanupUnit {
    return {
      path: relative(this.workspaceRoot, unit.path).split('\\').join('/'),
      line: unit.line,
      name: unit.name,
      kind: unit.kind,
      lines: unit.lines,
      threshold: unit.threshold,
    }
  }

  /** The user's word on the offer: split now, come back to it, or settle the feature as it stands. */
  private async decideCleanup(feature: string, decision: 'run' | 'postpone' | 'skip', paths?: string[]): Promise<void> {
    if (decision === 'run') {
      await this.runCleanup(feature, paths)
      return
    }
    await recordCleanupDecision(tasksPath(this.workspaceRoot, feature), decision === 'skip' ? 'skipped' : 'postponed')
    if (decision === 'skip') this.sweeps.delete(feature)
    await this.sendState()
    this.changed.fire()
  }

  /** A cleanup run has no transcript in the UI either: its events become the one line the plan bar shows. */
  private followCleanup(child: SessionRecord, event: SessionEvent): void {
    const feature = child.feature!
    const cleanup = this.cleanups.get(feature)
    if (!cleanup?.live) return
    if (event.type === 'turn_done') {
      void this.finishCleanup(child, event.isError ? (event.errors.length > 0 ? event.errors : ['the run ended with an error']) : [])
      return
    }
    if (event.type === 'error' && event.fatal) {
      void this.finishCleanup(child, [event.message])
      return
    }
    const line = progressLine(event, 'Cleanup')
    if (line === undefined || line === cleanup.text) return
    this.cleanups.set(feature, { live: true, text: line })
    void this.sendState()
  }

  /**
   * The run is over: stop its engine, measure its files again, and run the
   * tests once more, since the run had no shell to prove its split with. The
   * line holds both outcomes.
   */
  private async finishCleanup(child: SessionRecord, errors: string[]): Promise<void> {
    const feature = child.feature!
    // Marked over before the first await, so a late event from the dying engine cannot finish it twice.
    this.cleanups.set(feature, { live: false, text: this.cleanups.get(feature)?.text ?? '' })
    await this.sessions.close(child.id)
    if (errors.length > 0) {
      this.cleanups.set(feature, { live: false, text: `Cleanup failed: ${errors.join('; ')}` })
      await this.sendState()
      this.changed.fire()
      return
    }
    const files = (child.files ?? []).map((f) => join(this.workspaceRoot, f))
    const left = await oversizedFiles(this.workspaceRoot, files, this.sizeLimits.limits(), [])
    const split = left.length === 0 ? 'Cleaned: every unit is within its limit' : `Cleanup left ${left.length} unit${left.length === 1 ? '' : 's'} over the limit`
    // Written before the test run, whose pass sweeps again: the offer was answered, and what the split left is not a new one.
    await recordCleanupDecision(tasksPath(this.workspaceRoot, feature), 'done')
    this.sweeps.delete(feature)
    this.cleanups.set(feature, { live: true, text: `${split}; running the tests…` })
    await this.verify(feature, false)
    this.cleanups.set(feature, { live: false, text: `${split}; ${this.verifications.get(feature)?.text ?? 'tests not run'}` })
    await this.sendState()
    this.changed.fire()
  }

  /**
   * Brings one feature's plan files to the contract: the mechanical part now,
   * the rest through its planner, whose finished turn runs the mechanical
   * part again. Returns what was done and what is left.
   */
  async repairPlan(feature: string): Promise<MigrationReport> {
    const report = await migratePlan(this.workspaceRoot, feature)
    if (report.problems.length > 0) {
      const prompt = migrateSpecPrompt(feature, report.problems)
      const live = this.sessions.list().find((r) => r.mode === 'plan' && r.feature === feature && this.sessions.isLive(r.id))
      this.repairing.add(feature)
      if (live) await this.sessions.send(live.id, prompt)
      else await this.newSession('plan', feature, prompt)
    }
    await this.sendState()
    return report
  }

  /**
   * The `KiwiAgent: Build Repo Map` command. The build is mechanical and runs
   * in the extension host: no engine is started, so nothing is spent and
   * nothing is asked of the user while it runs.
   */
  async buildRepoMap(): Promise<void> {
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'KiwiAgent: building the repo map' },
        (progress) => buildRepoMap(this.workspaceRoot, (line) => progress.report({ message: line })),
      )
      const count = result.projects.length
      void vscode.window.showInformationMessage(`KiwiAgent: repo map built — ${count} project${count === 1 ? '' : 's'}.`)
    } catch (error) {
      void vscode.window.showWarningMessage(`KiwiAgent: the repo map could not be built: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * The `KiwiAgent: Build Docs Map` command. Unlike the repo map this one
   * spends a turn, so it says up front how many docs it has to read and
   * nothing at all when the map is already current.
   */
  async buildDocsMapCommand(ignored: string[]): Promise<void> {
    const plan = await planDocsMap(this.workspaceRoot, ignored)
    if (plan.current && (await this.docsMapIsComposed())) {
      void vscode.window.showInformationMessage('KiwiAgent: the docs map is current.')
      return
    }
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'KiwiAgent: building the docs map' },
        (progress) => this.buildDocsMap(ignored, (line) => progress.report({ message: line })),
      )
      const described = result.described.length
      const left = result.undescribed.length
      const tail = left === 0 ? '' : `, ${left} still to describe`
      void vscode.window.showInformationMessage(`KiwiAgent: docs map built: ${described} doc${described === 1 ? '' : 's'}${tail}.`)
    } catch (error) {
      void vscode.window.showWarningMessage(`KiwiAgent: the docs map could not be built: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Describes the docs that changed and composes the map. Two callers asking
   * at once (a session start and the command, or two starts) share the one
   * build rather than spending the turn twice.
   */
  buildDocsMap(ignored: string[], onProgress: (line: string) => void = () => {}): Promise<DocsMapResult> {
    return sharedBuild(`docs-map:${this.workspaceRoot}`, () => this.runDocsMap(ignored, onProgress))
  }

  private async runDocsMap(ignored: string[], onProgress: (line: string) => void): Promise<DocsMapResult> {
    const plan = await startDocsMap(this.workspaceRoot, ignored)
    if (plan.changed.length > 0) await this.describeDocs(plan.changed, onProgress)
    onProgress('Composing the map…')
    // Composed whatever the run did: what it wrote is kept, what it did not is the next build's work.
    return finishDocsMap(this.workspaceRoot, ignored)
  }

  /** One run for the whole build: it reads the changed docs, writes an entry each, and is gone when its turn ends. */
  private async describeDocs(docs: string[], onProgress: (line: string) => void): Promise<void> {
    // The docs it was handed are its whole read scope: an unchanged doc costs nothing, and the code is out of reach.
    const record = await this.sessions.create(this.profileFor('docs-map'), 'docs-map', undefined, { files: docs })
    const finished = new Promise<string[]>((resolve) => {
      this.docsMapRun = { sessionId: record.id, progress: onProgress, done: resolve }
    })
    let errors: string[]
    try {
      onProgress(`Describing ${docs.length} doc${docs.length === 1 ? '' : 's'}…`)
      await this.sessions.send(record.id, docsMapKickoff(docs))
      errors = await finished
    } finally {
      this.docsMapRun = undefined
      // The record is the build's, not a session anyone returns to; the run log stays for inspection.
      await this.sessions.remove(record.id)
      this.statuses.delete(record.id)
    }
    if (errors.length > 0) throw new Error(errors.join('; '))
  }

  /** A build run has no transcript in the UI: its events are the progress line the caller shows. */
  private followDocsMap(record: SessionRecord, event: SessionEvent): void {
    const run = this.docsMapRun
    if (!run || run.sessionId !== record.id) return
    if (event.type === 'turn_done') {
      run.done(event.isError ? (event.errors.length > 0 ? event.errors : ['the run ended with an error']) : [])
      return
    }
    if (event.type === 'error' && event.fatal) {
      run.done([event.message])
      return
    }
    // An engine that died without finishing a turn still ends the build: a wait nobody
    // resolves would be joined by every later build and never come back.
    if (event.type === 'ended') {
      run.done(['the run ended before it finished'])
      return
    }
    const line = progressLine(event, 'Docs map')
    if (line !== undefined) run.progress(line)
  }

  private async docsMapIsComposed(): Promise<boolean> {
    return (await readDocsSummary(this.workspaceRoot)) !== undefined
  }

  /** Every plan under `plan/`, the command's entry point; one summary at the end. */
  async migratePlans(): Promise<void> {
    const plans = await listPlans(this.workspaceRoot)
    if (plans.length === 0) {
      void vscode.window.showInformationMessage('KiwiAgent: no plans to migrate.')
      return
    }
    const reports: MigrationReport[] = []
    for (const plan of plans) reports.push(await this.repairPlan(plan.feature))
    const handed = reports.filter((r) => r.problems.length > 0).map((r) => r.feature)
    const clean = reports.filter((r) => r.problems.length === 0).map((r) => r.feature)
    const parts = [
      clean.length > 0 ? `on contract: ${clean.join(', ')}` : '',
      handed.length > 0 ? `handed to the planner: ${handed.join(', ')}` : '',
    ].filter((p) => p.length > 0)
    void vscode.window.showInformationMessage(`KiwiAgent: migrated ${plans.length} plan${plans.length === 1 ? '' : 's'}; ${parts.join('; ')}.`)
  }

  /** `handed` says the planner has the remaining problems now; otherwise its turn is over and they are the user's to look at. */
  private reportMigration(report: MigrationReport, handed: boolean): void {
    const left = report.problems.length
    if (left === 0) {
      const done = report.steps.length > 0 ? `: ${report.steps.join(' ')}` : '.'
      void vscode.window.showInformationMessage(`KiwiAgent: "${report.feature}" is on contract${done}`)
      return
    }
    const problems = `${left} contract problem${left === 1 ? '' : 's'}`
    void vscode.window.showWarningMessage(
      `KiwiAgent: "${report.feature}" has ${problems}; ${handed ? 'the planner is rearranging the spec' : 'see the plan bar'}.`,
    )
  }

  private attach(webview: vscode.Webview): void {
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')] }
    webview.html = webviewHtml(webview, this.extensionUri, 'chat-app')
    webview.onDidReceiveMessage((message: FromWebview) => {
      this.handle(message).catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error)
        void vscode.window.showErrorMessage(`KiwiAgent: ${text}`)
      })
    })
    this.webviews.add(webview)
  }

  private async handle(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.sendState()
        if (this.activeSessionId) await this.sendTranscript(this.activeSessionId)
        return
      case 'send': {
        if (!this.activeSessionId) await this.newSession('chat')
        // The tab's current run is what the person is talking to; the runs before it are history, and hear nothing.
        const run = this.activeRun()
        await this.sessions.send(run?.id ?? this.activeSessionId!, withLinkedFiles(message.text, message.files ?? []))
        return
      }
      case 'link_open_file': {
        // A chat panel of its own leaves no active text editor, so the file beside it is the one meant.
        const editor = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0]
        if (!editor) {
          void vscode.window.showWarningMessage('KiwiAgent: no file is open in the editor to link.')
          return
        }
        this.broadcast({ type: 'linked_file', path: linkedFilePath(this.workspaceRoot, editor.document.uri.fsPath) })
        return
      }
      case 'permission': {
        if (!this.sessions.get(message.sessionId)) return
        // The rules are in place before the call runs, so a second call they cover in the same turn already passes.
        const { remember, ...decision } = message.decision
        if (remember?.project.length) await this.permissions.allowForProject(remember.project)
        if (remember?.session.length) this.permissions.allowForSession(message.sessionId, remember.session)
        await this.sessions.respondToPermission(message.sessionId, message.requestId, decision)
        return
      }
      case 'question':
        if (!this.sessions.get(message.sessionId)) return
        await this.sessions.respondToQuestion(message.sessionId, message.requestId, message.outcome)
        return
      case 'interrupt': {
        // A task run building holds the floor, so Stop reaches it.
        const run = this.activeRun()
        if (run) await this.sessions.interrupt(run.id)
        return
      }
      case 'set_allow_writes': {
        const run = this.activeRun()
        if (run) this.allowWrites.setEnabled(run.id, message.enabled)
        void this.sendState()
        return
      }
      case 'set_session_model': {
        const record = this.activeRecord()
        const profile = this.registeredModels().find((m) => m.name === message.name)
        if (record && profile) await this.sessions.setProfile(record.id, profile)
        void this.sendState()
        return
      }
      case 'continue_in_chat': {
        const record = this.activeRecord()
        if (record?.mode === 'docs') await this.activate(await this.sessions.continueInChat(record.id))
        return
      }
      case 'reconnect_mcp': {
        const run = this.activeRun()
        if (run) await this.sessions.reconnectMcp(run.id, message.server)
        return
      }
      case 'set_default_profile':
        await this.profileDefaults.set(message.name)
        await this.sendState()
        return
      case 'switch_session':
        await this.open(message.sessionId)
        return
      case 'close_session':
        await this.close(message.sessionId)
        return
      case 'new_session': {
        // One filing at a time: a second would propose the same entries again.
        const filing = message.mode === 'file-decisions' ? this.sessions.list().find((r) => r.mode === 'file-decisions' && this.sessions.isLive(r.id)) : undefined
        if (filing) return this.open(filing.id)
        const prompt = withLinkedFiles(message.prompt ?? '', message.files ?? [])
        // The docs card and the filing have nothing to fill in, so their sessions start on the job rather than waiting for a prompt.
        const kickoff = message.mode === 'docs' ? docsEvaluationKickoff() : message.mode === 'file-decisions' ? fileDecisionsKickoff() : undefined
        await this.newSession(message.mode, message.feature, prompt !== '' ? prompt : kickoff)
        return
      }
      case 'resume_plan':
        await this.resumePlan(message.feature)
        return
      case 'approve_spec': {
        const record = this.planRecord()
        const path = this.activeSpecPath()
        const feature = record?.feature
        if (!record || !path || !feature) return
        // Agreement is reached, not assumed: every comment has to be closed first.
        const review = await readReview(reviewPath(this.workspaceRoot, feature))
        assertApprovable(review)
        const decisions = await readDecisions(decisionsPath(this.workspaceRoot, feature))
        assertRulingsSent(decisions)
        const spec = await readSpecState(path)
        const tasks = await readTasks(tasksPath(this.workspaceRoot, feature))
        if (!isApprovable(planStage(spec, review, tasks, decisions), spec)) throw new Error('Only a draft with every comment closed can be approved.')
        await setSpecStatus(path, 'approved')
        await this.sendState()
        // Approval hands the spec to the build: the code is checked against it first, and speaks up only where it disagrees.
        if (checkDue(await readSpecState(path), tasks, decisions)) return this.startCheck(record)
        // A board an earlier mapping left, current with the spec: nothing to check, the docs listing and the build follow.
        this.reviewingDocs.add(feature)
        await this.sendToPlanner(record, docsReviewPrompt(feature))
        return
      }
      case 'send_rulings': {
        const record = this.planRecord()
        if (!record?.feature) return
        if (!(await this.handOverRulings(record))) throw new Error('No decision is pending; there is nothing to send.')
        return
      }
      case 'rule_decision': {
        const path = this.activeSpecPath()
        const feature = this.activeRecord()?.feature
        if (!path || !feature) return
        // Decisions come after approval, so an approved spec takes a ruling; an implemented one is settled.
        const spec = await readSpecState(path)
        if (!spec.exists || spec.status === 'implemented') throw new Error('The feature is implemented: there is nothing left to rule on.')
        const decisions = decisionsPath(this.workspaceRoot, feature)
        await writeFile(decisions, withRuling(await readFile(decisions, 'utf8'), message.decision, message.ruling), 'utf8')
        await this.sendState()
        return
      }
      case 'add_comment':
        await this.reviewing(async (review) => {
          addComment(review, message.target, message.text)
        })
        return
      case 'edit_comment':
        await this.reviewing((review) => editComment(review, message.comment, message.text))
        return
      case 'remove_comment':
        await this.reviewing((review) => removeComment(review, message.comment))
        return
      case 'strike_item':
        await this.reviewing((review) => strikeItem(review, message.item))
        return
      case 'unstrike_item':
        await this.reviewing((review) => unstrikeItem(review, message.item))
        return
      case 'resolve_comment': {
        // Resolving a comment, including a disagreement, is the human's own act; it needs no draft.
        await this.reviewing((review) => resolveComment(review, message.comment), false)
        return
      }
      case 'submit_review': {
        const record = this.planRecord()
        if (!record?.feature) return
        await submitReview({
          courier: this.courier(),
          cwd: this.workspaceRoot,
          feature: record.feature,
          owner: { sessionId: record.id },
        })
        await this.sendState()
        return
      }
      case 'check_spec': {
        // The way back in when a check failed or was stopped: approval started the first one.
        const record = this.planRecord()
        if (record) await this.startCheck(record)
        return
      }
      case 'stop_check': {
        const record = this.planRecord()
        // Task runs and cleanups live under the same tab; only the check is this button's to stop.
        const child = record ? this.sessions.list().find((r) => r.parentId === record.id && r.mode === 'reconcile' && this.sessions.isLive(r.id)) : undefined
        if (!record || !child) return
        this.checks.set(record.id, { live: false, text: 'Check stopped' })
        await this.sessions.close(child.id)
        await this.sendState()
        this.changed.fire()
        return
      }
      case 'stop_cleanup': {
        // The run shows on every tab of the feature, so it is found by the feature, not the active tab.
        const feature = this.activeRecord()?.feature
        const child = feature
          ? this.sessions.list().find((r) => r.mode === 'cleanup' && r.feature === feature && this.sessions.isLive(r.id))
          : undefined
        if (!feature || !child) return
        this.cleanups.set(feature, { live: false, text: 'Cleanup stopped' })
        await this.sessions.close(child.id)
        await this.sendState()
        this.changed.fire()
        return
      }
      case 'cleanup_decision': {
        const feature = this.activeRecord()?.feature
        if (feature) await this.decideCleanup(feature, message.decision, message.paths)
        return
      }
      case 'sweep_sizes': {
        const feature = this.activeRecord()?.feature
        if (feature) await this.sweepForCleanup(feature)
        return
      }
      case 'repair_spec': {
        const feature = this.activeRecord()?.feature
        if (feature) this.reportMigration(await this.repairPlan(feature), true)
        return
      }
      case 'implement_spec': {
        const record = this.planRecord()
        const path = this.activeSpecPath()
        if (record?.mode !== 'plan' || !record.feature || !path) return
        assertImplementable(await readSpecState(path), await readTasks(tasksPath(this.workspaceRoot, record.feature)))
        await this.startImplementing(record)
        return
      }
      case 'verify_spec': {
        const feature = this.activeRecord()?.feature
        if (feature) await this.verify(feature, true)
        return
      }
      case 'open_file': {
        // An edit names its file absolutely; a task names it relative to the workspace.
        const path = isAbsolute(message.path) ? message.path : join(this.workspaceRoot, message.path)
        const file = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
        const at = new vscode.Position(editLine(message.line, file.lineCount), 0)
        await vscode.window.showTextDocument(file, { selection: new vscode.Range(at, at) })
        return
      }
      case 'open_edit_diff': {
        // The path comes back from the webview, so only a snapshot this extension wrote is opened.
        if (!isRunSnapshot(runsRoot(this.workspaceRoot), message.snapshot)) return
        await vscode.commands.executeCommand(
          'vscode.diff',
          vscode.Uri.file(message.snapshot),
          vscode.Uri.file(message.path),
          editDiffTitle(message.label),
        )
        return
      }
    }
  }

  private activeRecord(): SessionRecord | undefined {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined
  }

  /**
   * The plan session of the tab in front of the person. The tab is the
   * feature, whichever of its runs is speaking, so the plan bar's acts belong
   * to the planner even while an implementer or a cleanup holds the floor.
   */
  private planRecord(): SessionRecord | undefined {
    const record = this.activeRecord()
    if (!record?.feature) return record
    return this.sessions.list().find((r) => r.mode === 'plan' && r.feature === record.feature) ?? record
  }

  private activeSpecPath(): string | undefined {
    const feature = this.activeRecord()?.feature
    return feature ? specPath(this.workspaceRoot, feature) : undefined
  }

  /**
   * One review edit: read the plan and the review from disk, change the
   * review, write it back. The file is the only state, so a reload loses
   * nothing and the agent sees the same thing the human does.
   */
  private async reviewing(change: (review: Review, state: SpecState) => void, draftOnly = true): Promise<void> {
    const feature = this.activeRecord()?.feature
    const path = this.activeSpecPath()
    if (!feature || !path) return
    const state = await readSpecState(path)
    if (draftOnly) assertCommentable(state)
    const file = reviewPath(this.workspaceRoot, feature)
    const review = await readReview(file)
    change(review, state)
    await mkdir(dirname(file), { recursive: true })
    await writeReview(file, review, `${PLAN_DIR}/${featureSlug(feature)}.spec.md`)
    await this.sendState()
  }

  /**
   * Send rulings: every pending decision is ruled by the user, and the rulings
   * go to the plan session to apply. Approval waits for the revised spec, so
   * the user approves what the planner actually wrote, not what it proposed.
   * False when nothing was pending.
   */
  private async handOverRulings(record: SessionRecord): Promise<boolean> {
    const feature = record.feature!
    const decisions = await readDecisions(decisionsPath(this.workspaceRoot, feature))
    const pending = pendingDecisions(decisions)
    if (pending.length === 0) return false
    assertAllRuled(decisions)
    const rulings = pending.map((d) => ({ title: d.title, ruling: d.ruling ?? '' }))
    this.applying.add(feature)
    await this.sendToPlanner(record, rulingsHandoffPrompt(feature, rulings))
    return true
  }

  /** A prompt for the plan session that owns the feature, or a fresh plan session when it is gone. */
  private async sendToPlanner(record: SessionRecord, prompt: string): Promise<void> {
    const courier = this.courier()
    if (courier.isLive(record.id)) await courier.send(record.id, prompt)
    else await courier.start(record.feature!, prompt)
    await this.sendState()
  }

  /** A submitted review goes to the plan session that wrote the spec, or a fresh plan session when it is gone. */
  private courier(): ReviewCourier {
    return {
      isLive: (sessionId) => this.sessions.isLive(sessionId),
      send: (sessionId, text) => this.sessions.send(sessionId, text),
      start: async (feature, prompt) => {
        await this.newSession('plan', feature, prompt)
      },
    }
  }

  private async planState(): Promise<PlanState | undefined> {
    const path = this.activeSpecPath()
    // The bar belongs to the feature's planner, not to whichever of its runs is speaking: they share the tab.
    const record = this.planRecord()
    const feature = record?.feature
    if (!path || !record || !feature) return undefined
    const state = await readSpecState(path)
    const fromPlan = record.mode === 'plan' && state.exists
    const check = this.checks.get(record.id)
    const verification = this.verifications.get(feature)
    const cleanup = this.cleanups.get(feature)
    const flagged = this.sweeps.get(feature)
    const sweep: CleanupSweep | undefined = flagged ? { units: flagged.map((u) => this.cleanupUnit(u)) } : undefined
    const review = await readReview(reviewPath(this.workspaceRoot, feature)).catch(() => emptyReview())
    const tasks: TasksState = await readTasks(tasksPath(this.workspaceRoot, feature))
    const decisions = await readDecisions(decisionsPath(this.workspaceRoot, feature))
    const stage = planStage(state, review, tasks, decisions)
    const spec = state.exists ? parseSpec(state.body) : undefined
    const relativeTo = (file: string) => relative(this.workspaceRoot, file).split('\\').join('/')
    const runs = this.runsOf(record).map((r) => ({ mode: r.mode, status: this.statusOf(r.id) }))
    const blocked = blockOf(runs)
    const implementerBusy = runs.some((r) => r.mode === 'implement' && r.status === 'implementing')
    // The newest run that ran in this window speaks for the tab: a later run that went through supersedes an older failure.
    const lastRun = [...this.runsOf(record)].reverse().find((r) => this.statuses.has(r.id))
    const failureMessage = lastRun ? this.failures.get(lastRun.id) : undefined
    const failure = lastRun && failureMessage !== undefined ? { mode: lastRun.mode, message: failureMessage } : undefined
    return {
      specPath: relativeTo(path),
      tasksPath: relativeTo(tasksPath(this.workspaceRoot, feature)),
      decisionsPath: decisionsFile(feature),
      stage,
      status: state.exists ? state.status : 'missing',
      ...(state.exists ? { body: state.body } : {}),
      ...(spec ? { spec } : {}),
      stale: tasksStale(state, tasks),
      repairable: fromPlan && (spec?.problems.length ?? 0) > 0,
      // Offered only as the way back in: approval starts the check itself, so the button is for one that failed or was stopped.
      checkable: fromPlan && checkDue(state, tasks, decisions) && check?.live !== true && !this.applying.has(feature),
      ...(check ? { check } : {}),
      // Offered only as the way back in: the clean check starts the build itself, so the button is for an implementer that never started or stopped early.
      // An implementer whose engine is up but whose turn has ended is stopped too: its status says so, its engine does not.
      implementable: fromPlan && stage === 'under_development' && !this.reviewingDocs.has(feature) && implementationStarts(state, tasks, implementerBusy),
      // Offered while the board is tested and the last record did not pass; a re-run after a pass is a manual choice too.
      verifiable: (stage === 'verification' || stage === 'verified') && verification?.live !== true,
      ...(verification ? { verification } : {}),
      ...(cleanup ? { cleanup } : {}),
      ...(sweep ? { cleanupSweep: sweep } : {}),
      ...(tasks.exists && tasks.cleanup ? { cleanupDecision: tasks.cleanup } : {}),
      ...(tasks.exists && tasks.verification ? { lastVerification: tasks.verification } : {}),
      tasks: tasks.exists ? tasks.tasks : [],
      review,
      commentable: isCommentable(state),
      approvable: isApprovable(stage, state) && !this.applying.has(feature),
      decisions,
      pendingDecisions: pendingDecisions(decisions).length,
      applyingRulings: this.applying.has(feature),
      reviewingDocs: this.reviewingDocs.has(feature),
      atWork: runs.some((r) => r.status === 'planning' || r.status === 'implementing') || check?.live === true || verification?.live === true || cleanup?.live === true,
      ...(blocked ? { blocked } : {}),
      ...(failure ? { failure } : {}),
    }
  }

  /**
   * One tab per feature, plus the sessions that belong to no feature: a
   * feature is one thing to the person, however many runs it takes. A build
   * has no tab at all. In creation order, the list being newest first.
   */
  private tabs(): SessionTab[] {
    const shown = this.sessions.list().filter((r) => !isBuild(r.mode) && (this.sessions.isLive(r.id) || this.underActiveTab(r)))
    const keys = new Map<string, SessionRecord>()
    for (const record of shown) {
      // Reverse order, so the last one kept per feature is its oldest run: the tab keeps its identity as runs come and go.
      keys.set(record.feature ?? record.id, record)
    }
    return [...keys.values()].reverse().map((r) => this.tab(r))
  }

  private underActiveTab(record: SessionRecord): boolean {
    return record.id === this.activeSessionId || (record.feature !== undefined && record.feature === this.activeRecord()?.feature)
  }

  private tab(record: SessionRecord): SessionTab {
    const runs = this.runsOf(record)
    return {
      // Keyed the same way wherever the tab is named, so a message about one run reaches the tab that holds it.
      id: this.tabIdOf(record),
      title: record.feature ?? record.title,
      mode: record.mode,
      profileName: record.profile.name,
      status: mostUrgent(runs.map((r) => this.statusOf(r.id))),
      active: runs.some((r) => r.id === this.activeSessionId),
    }
  }

  /** Every run the tab holds, oldest first: one feature's sessions, or the one session that belongs to no feature. */
  private runsOf(record: SessionRecord): SessionRecord[] {
    if (!record.feature) return [record]
    return this.sessions
      .list()
      .filter((r) => r.feature === record.feature && !isBuild(r.mode))
      .reverse()
  }

  /**
   * What the webview calls the tab a session belongs to: its feature's oldest
   * run, so the tab keeps one identity while runs come and go under it.
   */
  private tabIdOf(record: SessionRecord): string {
    return this.runsOf(record)[0]?.id ?? record.id
  }

  /**
   * The run holding the floor: the task run building now, else the newest
   * session with a tab of its own. A mapping or a cleanup never holds it:
   * waking one with a follow-up meant for the planner would put the question
   * to a run scoped to something else.
   */
  private currentRun(record: SessionRecord): SessionRecord {
    return pickConversationalRun(this.runsOf(record), (id) => this.sessions.isLive(id)) ?? record
  }

  /** The run the user's typing, interrupting and switches act on, for the tab in front of them. */
  private activeRun(): SessionRecord | undefined {
    const record = this.activeRecord()
    return record ? this.currentRun(record) : undefined
  }

  private async sendState(): Promise<void> {
    const plan = await this.planState().catch((error: unknown) => {
      void vscode.window.showErrorMessage(`KiwiAgent: cannot read spec: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    })
    const plans = await listPlans(this.workspaceRoot).catch((error: unknown) => {
      void vscode.window.showErrorMessage(`KiwiAgent: cannot list plans: ${error instanceof Error ? error.message : String(error)}`)
      return []
    })
    const unfiled = await readUnfiled(this.workspaceRoot).catch((error: unknown) => {
      void vscode.window.showErrorMessage(`KiwiAgent: cannot read the unfiled decisions: ${error instanceof Error ? error.message : String(error)}`)
      return []
    })
    // The switches belong to the run the person is talking to, not to the session the tab is keyed by.
    const run = this.activeRun()
    // Planning phases auto-allow their in-scope writes and deny the rest, so the switch has nothing to decide there.
    const writesAsked = run !== undefined && !isPlanning(run.mode)
    const active = run?.id
    const tabs = this.tabs()
    this.broadcast({
      type: 'state',
      tabs,
      ...(active && writesAsked ? { allowWrites: this.allowWrites.isEnabled(active) } : {}),
      ...(active && this.mcpServers.has(active) ? { mcp: this.mcpServers.get(active)! } : {}),
      ...(plan ? { plan } : {}),
      ...(active ? { currentRun: active } : {}),
      plans: plans.flatMap((p) => (p.status === 'verified' ? [] : [{ feature: p.feature, status: p.status }])),
      chats: this.pastChats(tabs),
      unfiled: unfiled.length,
      profiles: this.profileDefaults.read(),
      models: this.registeredModels(),
    })
  }

  /**
   * The chats with no tab in play: closing one stops its engine but keeps its
   * record and its transcript, so it is offered back rather than lost. Only so
   * many, newest first: the state goes out on every status change, and a
   * workspace's whole history would ride along with it.
   */
  private pastChats(tabs: SessionTab[]): ResumableChat[] {
    const shown = new Set(tabs.map((t) => t.id))
    return this.sessions
      .list()
      .filter((r) => r.mode === 'chat' && !shown.has(r.id))
      .slice(0, 20)
      .map((r) => ({ sessionId: r.id, title: r.title, startedAt: r.createdAt }))
  }

  /** The tab's history: every run under it, oldest first, each its own conversation. */
  private async sendTranscript(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record) return
    const current = this.currentRun(record)
    const runs: RunSection[] = []
    for (const run of this.runsOf(record)) {
      runs.push({ ...this.runRef(run, current), events: await this.sessions.transcript(run.id) })
    }
    this.broadcast({ type: 'transcript', sessionId: this.tabIdOf(record), runs })
  }

  private runRef(run: SessionRecord, current: SessionRecord): RunRef {
    return { sessionId: run.id, mode: run.mode, title: run.title, current: run.id === current.id }
  }

  private broadcast(message: ToWebview): void {
    for (const webview of this.webviews) void webview.postMessage(message)
  }
}
