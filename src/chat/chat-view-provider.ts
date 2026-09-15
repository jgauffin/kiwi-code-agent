import * as vscode from 'vscode'
import { isPlanning, type SessionManager, type SessionMode, type SessionRecord } from '../agent/session/session-manager'
import type { ModelProfile } from '../agent/session/model-profile'
import type { SessionEvent } from '../agent/session/code-session'
import { nextStatus, type SessionStatus } from '../agent/session/session-status'
import { readSpecState, setSpecStatus, type SpecState } from '../agent/phases/spec-file'
import { PLAN_DIR, decisionsHandoffPrompt, featureSlug, migrateSpecPrompt, resumePlanPrompt, rulingsHandoffPrompt, specPath } from '../agent/phases/blind-plan'
import { acceptProposals, openDecisions, pendingDecisions, withRuling } from '../agent/phases/decisions'
import { listPlans } from '../agent/phases/plan-list'
import { progressLine, reconcileKickoff } from '../agent/phases/reconcile'
import { assertImplementable, implementKickoff } from '../agent/phases/implement'
import { cleanupKickoff } from '../agent/phases/cleanup'
import { anyLimit, oversizedFiles, sizeReport, type Thresholds } from '../agent/cleanup/oversized'
import { editedFiles } from '../agent/edits/edited-files'
import { isApprovable, isMappable, planStage, remapDue, tasksStale } from '../agent/phases/plan-stage'
import { parseSpec, specFingerprint } from '../agent/phases/spec-model'
import { migratePlan, type MigrationReport } from '../agent/phases/migrate-plan'
import { liveTasks, readTasks, stampSpecFingerprint, tasksDone, tasksPath, type TasksState } from '../agent/phases/tasks-file'
import {
  describeCommand,
  runVerification,
  verificationHandoffPrompt,
  type CommandRunner,
  type VerifyRule,
} from '../agent/phases/verification'
import {
  addComment,
  assertApprovable,
  assertCommentable,
  editComment,
  emptyReview,
  findItem,
  isCommentable,
  openComments,
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
import { assertAmendable, intentPath, label, pending, readAmendments, writeBackIntent, type Amendment } from '../agent/phases/intent-writeback'
import { editDiffTitle, editLine, isRunSnapshot, runsRoot } from '../agent/edits/open-edit'
import { buildRepoMap } from '../agent/repo-map/build-map'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import type { FromWebview, PlanState, RunState, SessionTab, ToWebview } from './protocol'

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
  thresholds(): Thresholds
  /** Globs, workspace-relative, of files the measure passes over: tests, generated code. */
  ignore(): string[]
}

/** Where a prompt's allowances go: the workspace's permission allow list, or the session's own, which lasts as long as the extension host. */
export interface PermissionStore {
  allowForProject(rules: string[]): Promise<void>
  allowForSession(sessionId: string, rules: string[]): void
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
  /** The mapping run under each plan session, by the plan session's id: the current step, or how the last run ended. */
  private readonly mappings = new Map<string, RunState>()
  /** The test run per feature: what it is doing, or how the last one ended. */
  private readonly verifications = new Map<string, RunState>()
  /** Consecutive failed test runs per feature; a pass or a manual run resets it. */
  private readonly verifyFailures = new Map<string, number>()
  /** Whether each feature's board was all tested the last time an implementer touched a file: the run starts on the edge. */
  private readonly boardDone = new Map<string, boolean>()
  /** The cleanup run per feature: what it is doing, or how the last one ended. */
  private readonly cleanups = new Map<string, RunState>()
  /** Features whose sizes were measured once their tests passed; the run does not repeat on the pass that proves its own split. */
  private readonly cleaned = new Set<string>()
  /** Features whose planner was handed the contract problems; its next finished turn completes the migration. */
  private readonly repairing = new Set<string>()
  private readonly changed = new vscode.EventEmitter<void>()
  /** Fires when the active session, a status or the session list changed. */
  readonly onDidChange = this.changed.event
  private activeSessionId: string | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionManager,
    private readonly profileFor: (mode: SessionMode) => ModelProfile,
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
    this.adoptPanel(
      vscode.window.createWebviewPanel(CHAT_PANEL_TYPE, 'KiwiAgent', vscode.ViewColumn.Beside, { retainContextWhenHidden: true }),
    )
  }

  /** A new editor panel, or one VS Code revived after a window reload. */
  adoptPanel(panel: vscode.WebviewPanel): void {
    this.attach(panel.webview)
    panel.onDidDispose(() => this.webviews.delete(panel.webview))
  }

  /** `continues` names the session whose conversation the new one carries on, where the engine resumes. */
  async newSession(mode: SessionMode, feature?: string, prompt?: string, continues?: SessionRecord): Promise<SessionRecord> {
    if (mode !== 'chat' && !feature) throw new Error(`A ${mode} session needs a feature name`)
    const record = await this.sessions.create(this.profileFor(mode), mode, feature, { continues })
    this.setActive(record.id)
    await this.sendState()
    this.broadcast({ type: 'transcript', sessionId: record.id, events: [] })
    this.changed.fire()
    if (prompt) await this.sessions.send(record.id, prompt)
    return record
  }

  showNewSession(): void {
    // The plan list is read fresh, so a spec written since the last state is offered.
    void this.sendState()
    this.broadcast({ type: 'show_new_session' })
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
    if (state.status === 'approved' && tasks.exists && tasksDone(tasks.tasks) && tasks.verification?.ok) {
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

  async close(sessionId: string): Promise<void> {
    await this.sessions.close(sessionId)
    if (this.activeSessionId === sessionId) this.setActive(undefined)
    void this.sendState()
    this.changed.fire()
  }

  async remove(sessionId: string): Promise<void> {
    await this.sessions.remove(sessionId)
    this.statuses.delete(sessionId)
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
      if (after !== before) {
        this.statuses.set(sessionId, after)
        void this.sendState()
        this.changed.fire()
      }
    }
    if (record?.parentId) {
      if (record.mode === 'cleanup') this.followCleanup(record, event)
      else this.followMapping(record, event)
      return
    }
    if (sessionId === this.activeSessionId) this.broadcast({ type: 'event', sessionId, event })
    if (event.type === 'session_started' || event.type === 'ended') {
      void this.sendState()
      this.changed.fire()
    }
    if (event.type === 'tool_result' && record?.feature) {
      // The session just wrote the spec (a revision, decisions, a task marker); the plan bar and view must follow.
      if (sessionId === this.activeSessionId) void this.sendState()
      if (record.mode === 'implement') void this.followBoard(record.feature)
    }
    if (event.type === 'turn_done' && !event.isError && record?.mode === 'plan' && record.feature) void this.followPlan(record)
  }

  /**
   * A plan turn ended: a repair the planner was asked for is finished
   * mechanically, and a board the turn left behind the spec is re-mapped.
   */
  private async followPlan(record: SessionRecord): Promise<void> {
    const feature = record.feature!
    if (this.repairing.delete(feature)) {
      const report = await migratePlan(this.workspaceRoot, feature)
      this.reportMigration(report, false)
      await this.sendState()
      if (report.problems.length > 0) return
    }
    const spec = await readSpecState(specPath(this.workspaceRoot, feature))
    const tasks = await readTasks(tasksPath(this.workspaceRoot, feature))
    const review = await readReview(reviewPath(this.workspaceRoot, feature)).catch(() => emptyReview())
    // With a review in flight the accept of its last comment maps; here it is a ruling or a repair that moved the spec.
    if (remapDue(spec, review, tasks)) await this.startMapping(record)
  }

  /** A mapping run has no transcript in the UI: its events become the one line the plan bar shows. */
  private followMapping(child: SessionRecord, event: SessionEvent): void {
    const parentId = child.parentId!
    const mapping = this.mappings.get(parentId)
    if (!mapping?.live) return
    if (event.type === 'turn_done') {
      void this.finishMapping(child, event.isError ? (event.errors.length > 0 ? event.errors : ['the run ended with an error']) : [])
      return
    }
    if (event.type === 'error' && event.fatal) {
      void this.finishMapping(child, [event.message])
      return
    }
    const line = progressLine(event)
    if (line === undefined || line === mapping.text) return
    this.mappings.set(parentId, { live: true, text: line })
    void this.sendState()
  }

  /**
   * Maps the plan session's draft spec against the code as a run under it;
   * nothing happens while one is live. A re-map continues the last mapping's
   * conversation where the engine resumes, so the code it read is not read again.
   */
  private async startMapping(record: SessionRecord): Promise<void> {
    if (record.mode !== 'plan' || !record.feature || this.sessions.liveChildOf(record.id)) return
    const spec = await readSpecState(specPath(this.workspaceRoot, record.feature))
    if (!spec.exists || spec.status !== 'draft') return
    const previous = this.sessions.latest('reconcile', record.feature)
    const child = await this.sessions.create(this.profileFor('reconcile'), 'reconcile', record.feature, { parentId: record.id, continues: previous })
    this.mappings.set(record.id, { live: true, text: 'Mapping the spec against the code…' })
    await this.sendState()
    await this.sessions.send(child.id, reconcileKickoff(child.engineSessionId !== undefined))
  }

  /**
   * The run is over: stop its engine, count what it left in the spec and the
   * tasks file and, when there are decisions without a proposal, hand them to
   * the planner to propose on.
   */
  private async finishMapping(child: SessionRecord, errors: string[]): Promise<void> {
    const parentId = child.parentId!
    // Marked over before the first await, so a late event from the dying engine cannot finish it twice.
    this.mappings.set(parentId, { live: false, text: this.mappings.get(parentId)?.text ?? '' })
    await this.sessions.close(child.id)
    let text: string
    if (errors.length > 0) {
      text = `Mapping failed: ${errors.join('; ')}`
    } else {
      const feature = child.feature!
      const state = await readSpecState(specPath(this.workspaceRoot, feature))
      const tasks = await readTasks(tasksPath(this.workspaceRoot, feature))
      // The board is stamped with the spec it was built from; a later change to the plan makes it stale.
      if (state.exists && tasks.exists) await stampSpecFingerprint(tasksPath(this.workspaceRoot, feature), specFingerprint(parseSpec(state.body)))
      const open = state.exists ? openDecisions(state.body) : []
      const count = tasks.exists ? liveTasks(tasks.tasks).length : 0
      text = `Mapped: ${count} task${count === 1 ? '' : 's'}, ${open.length === 0 ? 'the code is clear' : `${open.length} decision${open.length === 1 ? '' : 's'}`}`
      const unproposed = open.filter((d) => d.proposal.length === 0).map((d) => d.title)
      if (unproposed.length > 0 && this.sessions.get(parentId)) {
        await this.sessions.send(parentId, decisionsHandoffPrompt(feature, unproposed))
      }
    }
    this.mappings.set(parentId, { live: false, text })
    await this.sendState()
    this.changed.fire()
  }

  /**
   * An implementer touched a file: when that left the board all tested, the
   * test run starts. On the edge only, so a board that was already all tested
   * when the session resumed is not run again on its first read.
   */
  private async followBoard(feature: string): Promise<void> {
    const tasks = await readTasks(tasksPath(this.workspaceRoot, feature))
    const done = tasks.exists && tasksDone(tasks.tasks)
    const before = this.boardDone.get(feature)
    this.boardDone.set(feature, done)
    if (done && before === false) await this.verify(feature, false)
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
        const prompt = verificationHandoffPrompt(feature, outcome.failures, this.workspaceRoot)
        if (failures <= this.verifier.failureBudget()) await this.handToImplementer(feature, prompt)
        else text += ` (${failures} in a row; fix it and verify again)`
      }
    } catch (error) {
      text = `Test run failed: ${error instanceof Error ? error.message : String(error)}`
    }
    this.verifications.set(feature, { live: false, text })
    await this.sendState()
    this.changed.fire()
    if (passed) await this.startCleanup(feature)
  }

  /**
   * The latest implement session on the feature gets the prompt, resumed if
   * its engine had stopped: it knows what it changed. Without one, a fresh
   * session continues the mapping that wrote the board.
   */
  private async handToImplementer(feature: string, prompt: string): Promise<void> {
    const latest = this.sessions.latest('implement', feature)
    if (latest) await this.sessions.send(latest.id, prompt)
    else await this.newSession('implement', feature, prompt, this.sessions.latest('reconcile', feature))
  }

  /**
   * The tests passed: the files the feature's implementers edited are
   * measured, and what is over a limit goes to a cleanup run under the
   * latest implement session. Once per feature while the window lives: the
   * pass that proves the split must not start another.
   */
  private async startCleanup(feature: string): Promise<void> {
    if (this.cleaned.has(feature) || this.cleanups.get(feature)?.live) return
    const thresholds = this.sizeLimits.thresholds()
    if (!anyLimit(thresholds)) return
    const implementers = this.sessions.list().filter((r) => r.mode === 'implement' && r.feature === feature)
    const parent = implementers[0]
    if (!parent || this.sessions.liveChildOf(parent.id)) return
    this.cleaned.add(feature)
    const files: string[] = []
    for (const record of implementers) {
      for (const file of editedFiles(await this.sessions.transcript(record.id))) if (!files.includes(file)) files.push(file)
    }
    const flagged = await oversizedFiles(this.workspaceRoot, files, thresholds, this.sizeLimits.ignore())
    if (flagged.length === 0) {
      this.cleanups.set(feature, { live: false, text: 'Sizes checked: nothing to split' })
      await this.sendState()
      this.changed.fire()
      return
    }
    const relativeTo = (file: string) => relative(this.workspaceRoot, file).split('\\').join('/')
    const paths = [...new Set(flagged.map((u) => relativeTo(u.path)))]
    // The run carries the implementer's memory of the files under the cleanup's own prompt, tools and write scope.
    const child = await this.sessions.create(this.profileFor('cleanup'), 'cleanup', feature, { parentId: parent.id, files: paths, continues: parent })
    this.cleanups.set(feature, { live: true, text: 'Splitting oversized units…' })
    await this.sendState()
    await this.sessions.send(child.id, cleanupKickoff(sizeReport(this.workspaceRoot, flagged), child.engineSessionId !== undefined))
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
    const left = await oversizedFiles(this.workspaceRoot, files, this.sizeLimits.thresholds(), [])
    const split = left.length === 0 ? 'Cleaned: every unit is within its limit' : `Cleanup left ${left.length} unit${left.length === 1 ? '' : 's'} over the limit`
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
    webview.html = this.html(webview)
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
      case 'send':
        if (!this.activeSessionId) await this.newSession('chat')
        await this.sessions.send(this.activeSessionId!, message.text)
        return
      case 'permission': {
        if (!this.activeSessionId) return
        // The rules are in place before the call runs, so a second call they cover in the same turn already passes.
        const { remember, ...decision } = message.decision
        if (remember?.project.length) await this.permissions.allowForProject(remember.project)
        if (remember?.session.length) this.permissions.allowForSession(this.activeSessionId, remember.session)
        await this.sessions.respondToPermission(this.activeSessionId, message.requestId, decision)
        return
      }
      case 'question':
        if (!this.activeSessionId) return
        await this.sessions.respondToQuestion(this.activeSessionId, message.requestId, message.outcome)
        return
      case 'interrupt':
        if (this.activeSessionId) await this.sessions.interrupt(this.activeSessionId)
        return
      case 'set_allow_writes':
        if (this.activeSessionId) this.allowWrites.setEnabled(this.activeSessionId, message.enabled)
        void this.sendState()
        return
      case 'switch_session':
        await this.open(message.sessionId)
        return
      case 'close_session':
        await this.close(message.sessionId)
        return
      case 'new_session':
        await this.newSession(message.mode, message.feature, message.prompt)
        return
      case 'resume_plan':
        await this.resumePlan(message.feature)
        return
      case 'approve_spec': {
        const record = this.activeRecord()
        const path = this.activeSpecPath()
        const feature = record?.feature
        if (!record || !path || !feature) return
        // Agreement is reached, not assumed: every comment has to be closed first, and the tasks have to be known.
        const review = await readReview(reviewPath(this.workspaceRoot, feature))
        assertApprovable(review)
        const spec = await readSpecState(path)
        if (spec.exists && (await this.handOverRulings(record, path, spec.body))) return
        const tasks = await readTasks(tasksPath(this.workspaceRoot, feature))
        const stage = planStage(spec, review, tasks)
        if (tasksStale(spec, tasks)) throw new Error('The tasks predate the last change to the spec; they are re-mapped when the plan session’s turn ends with every decision applied.')
        if (!isApprovable(stage, spec, tasks)) throw new Error('Map the spec against the code first: approval covers the tasks too.')
        await setSpecStatus(path, 'approved')
        await this.sendState()
        return
      }
      case 'rule_decision': {
        const path = this.activeSpecPath()
        if (!path) return
        assertCommentable(await readSpecState(path))
        await writeFile(path, withRuling(await readFile(path, 'utf8'), message.decision, message.ruling), 'utf8')
        await this.sendState()
        return
      }
      case 'add_comment':
        await this.reviewing(async (review, state) => {
          const item = message.target === 'plan' ? undefined : findItem(state.exists ? state.body : '', message.target)
          addComment(review, message.target, message.text, item ? `${item.name}: ${item.text}` : undefined)
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
        let closed = false
        await this.reviewing((review) => {
          resolveComment(review, message.comment)
          closed = openComments(review).length === 0
        }, false)
        // The last resolve closes the review; the spec is settled and its mapping against the code starts by itself.
        const record = this.activeRecord()
        if (closed && record) await this.startMapping(record)
        return
      }
      case 'submit_review': {
        const record = this.activeRecord()
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
      case 'map_spec': {
        const record = this.activeRecord()
        if (record) await this.startMapping(record)
        return
      }
      case 'stop_map': {
        const record = this.activeRecord()
        const child = record ? this.sessions.liveChildOf(record.id) : undefined
        if (!record || !child) return
        this.mappings.set(record.id, { live: false, text: 'Mapping stopped' })
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
      case 'repair_spec': {
        const feature = this.activeRecord()?.feature
        if (feature) this.reportMigration(await this.repairPlan(feature), true)
        return
      }
      case 'implement_spec': {
        const record = this.activeRecord()
        const path = this.activeSpecPath()
        if (record?.mode !== 'plan' || !record.feature || !path) return
        assertImplementable(await readSpecState(path), await readTasks(tasksPath(this.workspaceRoot, record.feature)))
        // The implementer that already has the board carries on; the first one continues the mapping that wrote it.
        const latest = this.sessions.latest('implement', record.feature)
        if (latest) {
          await this.open(latest.id)
          await this.sessions.send(latest.id, implementKickoff('implement'))
          return
        }
        const implementer = await this.newSession('implement', record.feature, undefined, this.sessions.latest('reconcile', record.feature))
        await this.sessions.send(implementer.id, implementKickoff(implementer.engineSessionId ? 'mapping' : undefined))
        return
      }
      case 'verify_spec': {
        const feature = this.activeRecord()?.feature
        if (feature) await this.verify(feature, true)
        return
      }
      case 'update_intent': {
        const feature = this.activeRecord()?.feature
        const path = this.activeSpecPath()
        if (!feature || !path) return
        assertAmendable(await readSpecState(path))
        const result = await writeBackIntent({ cwd: this.workspaceRoot, feature })
        await this.sendState()
        await this.reportWriteBack(result.docs, result.failed)
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

  /** What landed in `docs/` and what did not: the user is applying these, so nothing happens silently. */
  private async reportWriteBack(docs: string[], failed: { amendment: Amendment; reason: string }[]): Promise<void> {
    if (failed.length > 0) {
      const detail = failed.map((f) => `${label(f.amendment)}: ${f.reason}`).join('; ')
      void vscode.window.showWarningMessage(
        `KiwiAgent: ${docs.length > 0 ? `updated ${docs.join(', ')}. ` : ''}${failed.length} amendment${failed.length === 1 ? '' : 's'} could not be applied: ${detail}`,
      )
      return
    }
    if (docs.length === 0) {
      void vscode.window.showInformationMessage('KiwiAgent: no intent amendments are waiting to be applied.')
      return
    }
    const open = 'Open'
    const choice = await vscode.window.showInformationMessage(`KiwiAgent: intent updated in ${docs.join(', ')}.`, open)
    if (choice !== open) return
    const file = vscode.Uri.file(join(this.workspaceRoot, docs[0]!))
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file))
  }

  private activeRecord(): SessionRecord | undefined {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined
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
   * Approve on a spec with decisions still pending: every open one with a
   * proposal is ruled `accepted`, and the rulings go to the plan session to
   * apply. Approval itself waits for the revised spec, so the user approves
   * what the planner actually wrote, not what it proposed. True when that
   * happened and the approval is not to proceed.
   */
  private async handOverRulings(record: SessionRecord, path: string, body: string): Promise<boolean> {
    const unproposed = openDecisions(body).filter((d) => !d.proposal)
    if (unproposed.length > 0) {
      throw new Error(`${unproposed.length === 1 ? 'A decision awaits' : `${unproposed.length} decisions await`} the planner's proposal: ${unproposed.map((d) => d.title).join('; ')}.`)
    }
    if (pendingDecisions(body).length === 0) return false
    const accepted = acceptProposals(await readFile(path, 'utf8'))
    if (accepted.accepted.length > 0) await writeFile(path, accepted.text, 'utf8')
    const rulings = pendingDecisions(accepted.text).map((d) => ({ title: d.title, ruling: d.ruling ?? '' }))
    const prompt = rulingsHandoffPrompt(record.feature!, rulings)
    const courier = this.courier()
    if (courier.isLive(record.id)) await courier.send(record.id, prompt)
    else await courier.start(record.feature!, prompt)
    await this.sendState()
    return true
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
    const record = this.activeRecord()
    const feature = record?.feature
    if (!path || !record || !feature) return undefined
    const state = await readSpecState(path)
    const fromPlan = record.mode === 'plan' && state.exists
    const mapping = this.mappings.get(record.id)
    const verification = this.verifications.get(feature)
    const cleanup = this.cleanups.get(feature)
    const review = await readReview(reviewPath(this.workspaceRoot, feature)).catch(() => emptyReview())
    const tasks: TasksState = await readTasks(tasksPath(this.workspaceRoot, feature))
    const amendments = await readAmendments(intentPath(this.workspaceRoot, feature)).catch(() => [])
    const waiting = pending(amendments).length
    const stage = planStage(state, review, tasks)
    const spec = state.exists ? parseSpec(state.body) : undefined
    const relativeTo = (file: string) => relative(this.workspaceRoot, file).split('\\').join('/')
    return {
      specPath: relativeTo(path),
      tasksPath: relativeTo(tasksPath(this.workspaceRoot, feature)),
      stage,
      status: state.exists ? state.status : 'missing',
      ...(state.exists ? { body: state.body } : {}),
      ...(spec ? { spec } : {}),
      stale: tasksStale(state, tasks),
      repairable: fromPlan && (spec?.problems.length ?? 0) > 0,
      mappable: fromPlan && isMappable(stage, state) && mapping?.live !== true,
      ...(mapping ? { mapping } : {}),
      implementable: fromPlan && stage === 'mapped' && state.status === 'approved',
      // Offered while the board is tested and the last record did not pass; a re-run after a pass is a manual choice too.
      verifiable: (stage === 'verification' || stage === 'verified') && verification?.live !== true,
      ...(verification ? { verification } : {}),
      ...(cleanup ? { cleanup } : {}),
      ...(tasks.exists && tasks.verification ? { lastVerification: tasks.verification } : {}),
      tasks: tasks.exists ? tasks.tasks : [],
      review,
      commentable: isCommentable(state),
      approvable: isApprovable(stage, state, tasks),
      pendingDecisions: state.exists ? pendingDecisions(state.body).length : 0,
      ...(amendments.length > 0
        ? {
            intent: {
              path: relative(this.workspaceRoot, intentPath(this.workspaceRoot, feature)).split('\\').join('/'),
              pending: waiting,
              applied: amendments.length - waiting,
              // Offered after approval, and still offered once the feature is built: intent owes the same debt either way.
              applicable: state.exists && state.status === 'approved' && waiting > 0,
            },
          }
        : {}),
    }
  }

  /** Tabs: live sessions plus the active one, in creation order (list is newest first). A run under a session has no tab. */
  private tabs(): SessionTab[] {
    return this.sessions
      .list()
      .filter((r) => !r.parentId && (this.sessions.isLive(r.id) || r.id === this.activeSessionId))
      .reverse()
      .map((r) => this.tab(r))
  }

  private tab(record: SessionRecord): SessionTab {
    return {
      id: record.id,
      title: record.title,
      mode: record.mode,
      profileName: record.profile.name,
      status: this.statusOf(record.id),
      active: record.id === this.activeSessionId,
    }
  }

  private async sendState(): Promise<void> {
    const active = this.activeSessionId
    const plan = await this.planState().catch((error: unknown) => {
      void vscode.window.showErrorMessage(`KiwiAgent: cannot read spec: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    })
    const plans = await listPlans(this.workspaceRoot).catch((error: unknown) => {
      void vscode.window.showErrorMessage(`KiwiAgent: cannot list plans: ${error instanceof Error ? error.message : String(error)}`)
      return []
    })
    const record = this.activeRecord()
    // Planning phases auto-allow their in-scope writes and deny the rest, so the switch has nothing to decide there.
    const writesAsked = record !== undefined && !isPlanning(record.mode)
    this.broadcast({
      type: 'state',
      tabs: this.tabs(),
      ...(active && writesAsked ? { allowWrites: this.allowWrites.isEnabled(active) } : {}),
      ...(plan ? { plan } : {}),
      plans: plans.flatMap((p) => (p.status === 'verified' ? [] : [{ feature: p.feature, status: p.status }])),
    })
  }

  private async sendTranscript(sessionId: string): Promise<void> {
    const events = await this.sessions.transcript(sessionId)
    this.broadcast({ type: 'transcript', sessionId, events })
  }

  private broadcast(message: ToWebview): void {
    for (const webview of this.webviews) void webview.postMessage(message)
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'))
    const nonce = crypto.randomUUID().replace(/-/g, '')
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data:; font-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>KiwiAgent</title>
</head>
<body>
<chat-app></chat-app>
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`
  }
}
