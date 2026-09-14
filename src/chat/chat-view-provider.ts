import * as vscode from 'vscode'
import { isPlanning, type SessionManager, type SessionMode, type SessionRecord } from '../agent/session/session-manager'
import type { ModelProfile } from '../agent/session/model-profile'
import type { SessionEvent } from '../agent/session/code-session'
import { nextStatus, type SessionStatus } from '../agent/session/session-status'
import { readSpecState, setSpecStatus, type SpecState } from '../agent/phases/spec-file'
import { PLAN_DIR, featureSlug, findingsHandoffPrompt, resumePlanPrompt, specPath } from '../agent/phases/blind-plan'
import { listPlans } from '../agent/phases/plan-list'
import { RECONCILE_KICKOFF, openFindings, progressLine } from '../agent/phases/reconcile'
import { IMPLEMENT_KICKOFF, assertImplementable } from '../agent/phases/implement'
import { isApprovable, isMappable, planStage } from '../agent/phases/plan-stage'
import { liveTasks, readTasks, tasksDone, tasksPath, type TasksState } from '../agent/phases/tasks-file'
import {
  describeCommand,
  runVerification,
  verificationHandoffPrompt,
  type CommandRunner,
  type VerifyRule,
} from '../agent/phases/verification'
import {
  acceptResolution,
  addComment,
  assertApprovable,
  assertCommentable,
  editComment,
  emptyReview,
  findItem,
  isCommentable,
  openComments,
  planItems,
  readReview,
  removeComment,
  reviewPath,
  strikeItem,
  unstrikeItem,
  writeReview,
  type Review,
} from '../agent/phases/plan-review'
import { submitReview, type ReviewCourier } from '../agent/phases/review-handoff'
import { assertAmendable, intentPath, pending, readAmendments, writeBackIntent } from '../agent/phases/intent-writeback'
import { editDiffTitle, editLine, isRunSnapshot, runsRoot } from '../agent/edits/open-edit'
import { mkdir } from 'node:fs/promises'
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

/** Where "Allow for project" writes its rules: the workspace's permission allow list. */
export interface PermissionStore {
  allowForProject(rules: string[]): Promise<void>
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
  private readonly changed = new vscode.EventEmitter<void>()
  /** Fires when the active session, a status or the session list changed. */
  readonly onDidChange = this.changed.event
  private activeSessionId: string | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionManager,
    private readonly profileFor: (mode: SessionMode) => ModelProfile,
    private readonly verifier: Verifier,
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

  async newSession(mode: SessionMode, feature?: string, prompt?: string): Promise<void> {
    if (mode !== 'chat' && !feature) throw new Error(`A ${mode} session needs a feature name`)
    const record = await this.sessions.create(this.profileFor(mode), mode, feature)
    this.setActive(record.id)
    await this.sendState()
    this.broadcast({ type: 'transcript', sessionId: record.id, events: [] })
    this.changed.fire()
    if (prompt) await this.sessions.send(record.id, prompt)
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
      this.followMapping(record, event)
      return
    }
    if (sessionId === this.activeSessionId) this.broadcast({ type: 'event', sessionId, event })
    if (event.type === 'session_started' || event.type === 'ended') {
      void this.sendState()
      this.changed.fire()
    }
    if (event.type === 'tool_result' && record?.feature) {
      // The session just wrote the spec (a revision, findings, a task marker); the plan bar and view must follow.
      if (sessionId === this.activeSessionId) void this.sendState()
      if (record.mode === 'implement') void this.followBoard(record.feature)
    }
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

  /** Maps the plan session's draft spec against the code as a run under it; nothing happens while one is live. */
  private async startMapping(record: SessionRecord): Promise<void> {
    if (record.mode !== 'plan' || !record.feature || this.sessions.liveChildOf(record.id)) return
    const spec = await readSpecState(specPath(this.workspaceRoot, record.feature))
    if (!spec.exists || spec.status !== 'draft') return
    const child = await this.sessions.create(this.profileFor('reconcile'), 'reconcile', record.feature, record.id)
    this.mappings.set(record.id, { live: true, text: 'Mapping the spec against the code…' })
    await this.sendState()
    await this.sessions.send(child.id, RECONCILE_KICKOFF)
  }

  /**
   * The run is over: stop its engine, count what it left in the spec and the
   * tasks file and, when there are findings without a proposal, hand them to
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
      const open = state.exists ? openFindings(state.body) : []
      const count = tasks.exists ? liveTasks(tasks.tasks).length : 0
      text = `Mapped: ${count} task${count === 1 ? '' : 's'}, ${open.length === 0 ? 'the code is clear' : `${open.length} finding${open.length === 1 ? '' : 's'}`}`
      const unproposed = open.filter((f) => f.proposal.length === 0).map((f) => f.id)
      if (unproposed.length > 0 && this.sessions.get(parentId)) {
        await this.sessions.send(parentId, findingsHandoffPrompt(feature, unproposed))
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
    this.verifications.set(feature, { live: true, text: 'Running the tests…' })
    await this.sendState()
    let text: string
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
  }

  /** The latest live implement session on the feature gets the prompt; without one, a fresh session starts on it. */
  private async handToImplementer(feature: string, prompt: string): Promise<void> {
    const live = this.sessions.list().find((r) => r.mode === 'implement' && r.feature === feature && this.sessions.isLive(r.id))
    if (live) await this.sessions.send(live.id, prompt)
    else await this.newSession('implement', feature, prompt)
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
        // The rule is written before the call runs, so a second identical call in the same turn already passes.
        if (message.decision.kind === 'allow_project') await this.permissions.allowForProject(message.decision.rules)
        const decision = message.decision.kind === 'allow_project' ? { kind: 'allow' as const } : message.decision
        await this.sessions.respondToPermission(this.activeSessionId, message.requestId, decision)
        return
      }
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
        const path = this.activeSpecPath()
        const feature = this.activeRecord()?.feature
        if (!path || !feature) return
        // Agreement is reached, not assumed: every comment has to be closed first, and the tasks have to be known.
        const review = await readReview(reviewPath(this.workspaceRoot, feature))
        assertApprovable(review)
        const spec = await readSpecState(path)
        const stage = planStage(spec, review, await readTasks(tasksPath(this.workspaceRoot, feature)))
        if (!isApprovable(stage, spec)) throw new Error('Map the spec against the code first: approval covers the tasks too.')
        await setSpecStatus(path, 'approved')
        await this.sendState()
        return
      }
      case 'add_comment':
        await this.reviewing(async (review, state) => {
          const item = message.target === 'plan' ? undefined : findItem(state.exists ? state.body : '', message.target)
          addComment(review, message.target, message.text, item ? `${item.id}: ${item.text}` : undefined)
        })
        return
      case 'edit_comment':
        await this.reviewing((review) => editComment(review, message.commentId, message.text))
        return
      case 'remove_comment':
        await this.reviewing((review) => removeComment(review, message.commentId))
        return
      case 'strike_item':
        await this.reviewing((review) => strikeItem(review, message.itemId))
        return
      case 'unstrike_item':
        await this.reviewing((review) => unstrikeItem(review, message.itemId))
        return
      case 'accept_resolution': {
        // Accepting a resolution, including a disagreement, is the human's own act; it needs no draft.
        let closed = false
        await this.reviewing((review) => {
          acceptResolution(review, message.commentId)
          closed = openComments(review).length === 0
        }, false)
        // The last accept closes the review; the spec is settled and its mapping against the code starts by itself.
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
      case 'implement_spec': {
        const record = this.activeRecord()
        const path = this.activeSpecPath()
        if (record?.mode !== 'plan' || !record.feature || !path) return
        assertImplementable(await readSpecState(path), await readTasks(tasksPath(this.workspaceRoot, record.feature)))
        await this.newSession('implement', record.feature, IMPLEMENT_KICKOFF)
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
  private async reportWriteBack(
    docs: string[],
    failed: { amendment: { id: string }; reason: string }[],
  ): Promise<void> {
    if (failed.length > 0) {
      const detail = failed.map((f) => `${f.amendment.id}: ${f.reason}`).join('; ')
      void vscode.window.showWarningMessage(
        `KiwiAgent: ${docs.length > 0 ? `updated ${docs.join(', ')}. ` : ''}${failed.length} amendment${failed.length === 1 ? '' : 's'} could not be applied — ${detail}`,
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

  /** A submitted review goes to the plan session that wrote the spec, or a fresh plan session when it is gone. */
  private courier(): ReviewCourier {
    return {
      isLive: (sessionId) => this.sessions.isLive(sessionId),
      send: (sessionId, text) => this.sessions.send(sessionId, text),
      start: (feature, prompt) => this.newSession('plan', feature, prompt),
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
    const review = await readReview(reviewPath(this.workspaceRoot, feature)).catch(() => emptyReview())
    const tasks: TasksState = await readTasks(tasksPath(this.workspaceRoot, feature))
    const amendments = await readAmendments(intentPath(this.workspaceRoot, feature)).catch(() => [])
    const waiting = pending(amendments).length
    const stage = planStage(state, review, tasks)
    const relativeTo = (file: string) => relative(this.workspaceRoot, file).split('\\').join('/')
    return {
      specPath: relativeTo(path),
      tasksPath: relativeTo(tasksPath(this.workspaceRoot, feature)),
      stage,
      status: state.exists ? state.status : 'missing',
      ...(state.exists ? { body: state.body } : {}),
      mappable: fromPlan && isMappable(stage, state) && mapping?.live !== true,
      ...(mapping ? { mapping } : {}),
      implementable: fromPlan && stage === 'mapped' && state.status === 'approved',
      // Offered while the board is tested and the last record did not pass; a re-run after a pass is a manual choice too.
      verifiable: (stage === 'verification' || stage === 'verified') && verification?.live !== true,
      ...(verification ? { verification } : {}),
      ...(tasks.exists && tasks.verification ? { lastVerification: tasks.verification } : {}),
      tasks: tasks.exists ? tasks.tasks : [],
      items: state.exists ? planItems(state.body) : [],
      review,
      commentable: isCommentable(state),
      approvable: isApprovable(stage, state),
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
