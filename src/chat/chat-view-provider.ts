import * as vscode from 'vscode'
import { actingMode, isBuild, isFeatureless, offersAllowWrites, stepOf, type SessionManager, type SessionMode, type SessionRecord } from '../agent/session/session-manager'
import type { ModelProfile, Step } from '../agent/session/model-profile'
import type { McpServerState, SessionEvent } from '../agent/session/code-session'
import { appliesModelSwitchNow, blockOf, lastFailure, mostUrgent, nextStatus, takesProfile, type SessionStatus } from '../agent/session/session-status'
import { readSpecState, setSpecStatus, type SpecState } from '../agent/phases/spec-file'
import {
  SPECS_DIR,
  decisionsHandoffPrompt,
  docsAfterApprovalPrompt,
  featureSlug,
  migrateSpecPrompt,
  resumePlanPrompt,
  rulingsHandoffPrompt,
  specPath,
} from '../agent/phases/blind-plan'
import { assertAllRuled, assertRulingsSent, compactAppliedDecisions, decisionsFile, decisionsPath, openDecisions, pendingDecisions, readDecisions, withRuling } from '../agent/phases/decisions'
import { contextPath, readScenarioContext } from '../agent/phases/scenario-context'
import { listPlans } from '../agent/phases/plan-list'
import { progressLine, reconcileKickoff } from '../agent/phases/reconcile'
import { assertImplementable, implementationStarts } from '../agent/phases/implement'
import { codePlanBuildKickoff } from '../agent/phases/code-plan'
import { checkDue, isApprovable, planStage, tasksStale } from '../agent/phases/plan-stage'
import { parseSpec } from '../agent/phases/spec-model'
import { followRenames, migratePlan, type MigrationReport } from '../agent/phases/migrate-plan'
import { deriveBoard, readBoard, readTasks, tasksDone, tasksPath, writeBoard, type TasksState } from '../agent/phases/tasks-file'
import { attributeWith } from '../agent/phases/verification'
import { FileHands } from '../agent/session/file-hands'
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
import { docMigrationKickoff } from '../agent/phases/doc-migration'
import { deliversEvaluation, docsEvaluationKickoff } from '../agent/phases/docs-evaluation'
import { fileDecisionsKickoff } from '../agent/phases/file-decisions'
import { readUnfiled } from '../agent/phases/unfiled-decisions'
import { sharedBuild } from '../agent/session/generated-context'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { linkedFilePath, withLinkedFiles } from './linked-files'
import { refusal } from './phase-runs'
import type {
  FromWebview,
  PlanState,
  ResumableChat,
  RunControls,
  RunRef,
  RunSection,
  RunState,
  SessionTab,
  ToWebview,
} from './protocol'
import { webviewHtml } from './webview-html'
import type { AgentsMdOffers } from './agents-md-offers'
import { agentsMdTidyKickoff } from '../agent/instructions/agents-md-tidy'
import { FeatureBuild } from './feature-build'
import { FeatureCleanup } from './feature-cleanup'
import type { ChatRefresh, Notify, SessionSwitch, SizeLimits, Verifier } from './feature-runs'
import type { ProfileDefaults } from '../settings/settings-store'
import { errorMessage } from '../error-message'
import { forDisplay } from './display-event'

/** Where a prompt's allowances go: the workspace's permission allow list, or the session's own, kept with the session. */
export interface PermissionStore {
  allowForProject(rules: string[]): Promise<void>
  allowForSession(sessionId: string, rules: string[]): Promise<void>
}

/** What new sessions run on, as the new-session screen shows and sets it. */
export interface ProfileDefaultsStore {
  read(): ProfileDefaults
  set(name: string): Promise<void>
}

/** The chat tabs' webview type; VS Code hands tabs of this type back after a window reload. */
export const CHAT_PANEL_TYPE = 'kiwiAgent.chatPanel'

/** What a tab is called before a session is started on it. */
const NEW_SESSION_TITLE = 'New session'

/** A chat tab in the editor area and the session tab it shows; absent while it shows the new-session screen. */
type ChatPanel = { panel: vscode.WebviewPanel; tabId?: string }

/** One kind of message from the tab. */
type WebviewMessage<T extends FromWebview['type']> = Extract<FromWebview, { type: T }>

/** Read when a spec is approved, so a change in settings applies to the next approval. */
const cutCoveredDocs = (): boolean => vscode.workspace.getConfiguration('kiwiAgent').get<boolean>('cutCoveredDocs', false)

/** What the chat shows for the docs listing a spec's approval hands the planner. */
const DOCS_REVIEW_LABEL = 'Spec approved: listing the docs it touches'

/**
 * Hosts the chat UI: one editor tab per session, so a session keeps running
 * in view while another is started. The provider routes each session's events
 * to its tab and tracks every session's status for the Sessions view.
 */
export class ChatViewProvider {
  private readonly panels = new Set<ChatPanel>()
  private readonly statuses = new Map<string, SessionStatus>()
  /** Per session, why its last turn failed; absent once a turn goes through or the next prompt is sent. */
  private readonly failures = new Map<string, string>()
  /** The check against the code under each plan session, by the plan session's id: the current step, or how the last run ended. */
  private readonly checks = new Map<string, RunState>()
  private readonly build: FeatureBuild
  private readonly cleanup: FeatureCleanup
  /** Features whose planner was handed the contract problems; its next finished turn completes the migration. */
  private readonly repairing = new Set<string>()
  /** Features whose rulings were handed to the planner; Approve waits for that turn to end rather than sending them twice. */
  private readonly applying = new Set<string>()
  /** Features whose planner is listing what the docs should now say, right after approval; Implement waits for that turn. */
  private readonly reviewingDocs = new Set<string>()
  /** Docs evaluations whose findings were delivered in the turn under way; full access is granted when it ends. */
  private readonly evaluationsDelivered = new Set<string>()
  /** Per running session, its MCP servers as the engine last reported them. */
  private readonly mcpServers = new Map<string, McpServerState[]>()
  /**
   * A chat session's model switch, picked while its turn was still in
   * flight: held here rather than applied at once, so that turn finishes on
   * the model it started on and the switch takes hold on the next prompt
   * instead (B10).
   */
  private readonly pendingModelSwitch = new Map<string, ModelProfile>()
  /** The docs map build in flight: the run's session, where its progress goes, and the turn its caller waits on. */
  private docsMapRun: { sessionId: string; progress: (line: string) => void; done: (errors: string[]) => void } | undefined
  /** The last state sent, settled either way: the next one waits on it. */
  private stateTail: Promise<void> = Promise.resolve()
  /** A state not started yet; every call made before it starts shares it. */
  private stateQueued: Promise<void> | undefined
  private readonly changed = new vscode.EventEmitter<void>()
  /** Fires when a tab opened or closed, a status changed or the session list changed. */
  readonly onDidChange = this.changed.event

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionManager,
    /** What a step runs on: the active profile's model for it. `attempt` counts the fixes of a failed test run. */
    private readonly profileFor: (step: Step, attempt?: number) => ModelProfile,
    private readonly profileDefaults: ProfileDefaultsStore,
    private readonly registeredModels: () => ModelProfile[],
    verifier: Verifier,
    sizeLimits: SizeLimits,
    private readonly allowWrites: SessionSwitch,
    private readonly permissions: PermissionStore,
    private readonly workspaceRoot: string,
    private readonly agentsMd: AgentsMdOffers,
  ) {
    const refresh: ChatRefresh = { sendState: () => this.sendState(), changed: () => this.changed.fire() }
    const notify: Notify = {
      warn: (text) => void vscode.window.showWarningMessage(`Kiwipow Agent: ${text}`),
      error: (text) => void vscode.window.showErrorMessage(`Kiwipow Agent: ${text}`),
      ask: (text, ...choices) => Promise.resolve(vscode.window.showWarningMessage(`Kiwipow Agent: ${text}`, { modal: true }, ...choices)),
    }
    // Each waits on the other: the cleanup follows a passing test run, and ends in one.
    this.cleanup = new FeatureCleanup({
      workspaceRoot,
      sessions,
      profileFor,
      sizeLimits,
      refresh,
      notify,
      verify: async (feature) => ({ passed: await this.build.verify(feature, false), text: this.build.lineOf(feature)?.text ?? 'tests not run' }),
    })
    this.build = new FeatureBuild({
      workspaceRoot,
      sessions,
      profileFor,
      verifier,
      attribute: (feature) => attributeWith(new FileHands(workspaceRoot, `verify-${feature}`, 'implement', feature), feature, workspaceRoot),
      allowWrites,
      statusOf: (id) => this.statusOf(id),
      isOpen: (id) => this.isOpen(id),
      refresh,
      notify,
      listener: this.cleanup,
    })
  }

  /** Models are chosen in the profiles alone: a feature run takes a profile changed in settings on its next turn. A chat keeps its own switch. */
  private async followProfile(run: SessionRecord): Promise<void> {
    if (isFeatureless(run.mode)) return
    const resolved = this.profileFor(stepOf(run), run.fixAttempt)
    if (takesProfile(this.statusOf(run.id), run.profile, resolved)) await this.sessions.setProfile(run.id, resolved)
  }

  /**
   * A chat session's own model switch (B9): applied at once when nothing is
   * in flight, held for the next prompt when the session is `underWay`, so a
   * turn already running finishes on the model it started on (B10) instead of
   * having its engine torn down under it.
   */
  private async switchModel(id: string, profile: ModelProfile): Promise<void> {
    if (!appliesModelSwitchNow(this.statusOf(id))) {
      this.pendingModelSwitch.set(id, profile)
      return
    }
    this.pendingModelSwitch.delete(id)
    await this.sessions.setProfile(id, profile)
  }

  /** A model switch picked mid-turn, applied now that the next prompt is about to go out (B10). */
  private async applyPendingModelSwitch(run: SessionRecord): Promise<void> {
    const pending = this.pendingModelSwitch.get(run.id)
    if (!pending) return
    this.pendingModelSwitch.delete(run.id)
    await this.sessions.setProfile(run.id, pending)
  }

  /** Whether a tab shows the session, its own or its feature's. */
  isOpen(sessionId: string): boolean {
    const record = this.sessions.get(sessionId)
    return record !== undefined && this.panelOf(this.tabIdOf(record)) !== undefined
  }

  /** A session's status, or its running check's: the check has no tab, so its state shows on the plan's. */
  statusOf(sessionId: string): SessionStatus {
    const child = this.sessions.liveChildOf(sessionId)
    return this.statuses.get(child?.id ?? sessionId) ?? 'idle'
  }

  private panelOf(tabId: string): ChatPanel | undefined {
    for (const entry of this.panels) if (entry.tabId === tabId) return entry
    return undefined
  }

  /**
   * A tab VS Code restores after a window reload, its state naming the
   * session it showed. A session removed meanwhile, or already shown by
   * another tab, leaves it on the new-session screen.
   */
  restore(panel: vscode.WebviewPanel, state: { tabId?: string } | undefined): void {
    const tabId = state?.tabId
    this.adopt(panel, tabId && this.sessions.get(tabId) && !this.panelOf(tabId) ? tabId : undefined)
  }

  /** A new tab on the new-session screen; the tabs already open keep their sessions in view. */
  showNewSession(): void {
    this.createPanel(undefined)
  }

  private createPanel(tabId: string | undefined): ChatPanel {
    const panel = vscode.window.createWebviewPanel(CHAT_PANEL_TYPE, NEW_SESSION_TITLE, vscode.ViewColumn.Active, {
      enableScripts: true,
      // A tab in the background still takes its session's events; a discarded page would miss them.
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    })
    return this.adopt(panel, tabId)
  }

  private adopt(panel: vscode.WebviewPanel, tabId: string | undefined): ChatPanel {
    const entry: ChatPanel = { panel, ...(tabId ? { tabId } : {}) }
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'docs', 'logos', 'head-128.png')
    this.panels.add(entry)
    this.attach(entry)
    panel.onDidDispose(() => {
      this.panels.delete(entry)
      this.changed.fire()
    })
    this.changed.fire()
    return entry
  }

  /**
   * Brings the session's tab up: the tab already showing it, else `into`
   * (the tab the request came from), else a new one.
   */
  private show(tabId: string, into: ChatPanel | undefined): void {
    const open = this.panelOf(tabId)
    if (open) open.panel.reveal()
    else if (into && this.panels.has(into)) {
      into.tabId = tabId
      into.panel.reveal()
    } else this.createPanel(tabId)
  }

  /**
   * `into` is the tab the session is started from, which then shows it; without one the session gets its own tab.
   * `label` marks a first prompt the extension wrote: the chat shows the label in its place.
   */
  async newSession(mode: SessionMode, feature?: string, prompt?: string, into?: ChatPanel, label?: string): Promise<SessionRecord | undefined> {
    if (!isFeatureless(mode) && !feature) throw new Error(`A ${mode} session needs a feature name`)
    const record = await this.sessions.create(this.profileFor(mode), mode, feature)
    // Approving the plan is the consent for the writes it maps out, so the switch starts on where a build session carries it out.
    if (mode === 'implement' || mode === 'cleanup') this.allowWrites.setEnabled(record.id, true)
    return await this.activate(record, prompt, into, label)
  }

  /**
   * Shows a newly created session, and sends its first prompt when there is
   * one. A run on a feature joins the tab that feature already has.
   */
  private async activate(record: SessionRecord, prompt?: string, into?: ChatPanel, label?: string): Promise<SessionRecord> {
    await this.reveal(record, into)
    if (prompt) await this.sessions.send(record.id, prompt, label)
    return record
  }

  private async reveal(record: SessionRecord, into?: ChatPanel): Promise<void> {
    const tabId = this.tabIdOf(record)
    this.show(tabId, into)
    await this.sendState()
    await this.sendTranscript(tabId)
    this.changed.fire()
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
  async resumePlan(feature: string, into?: ChatPanel): Promise<void> {
    const path = specPath(this.workspaceRoot, feature)
    const state = await readSpecState(path)
    if (!state.exists) throw new Error(`No spec for "${feature}" under ${SPECS_DIR}/.`)
    const tasks = await readTasks(tasksPath(this.workspaceRoot, feature))
    if (state.status === 'implemented' || (state.status === 'approved' && tasks.exists && tasksDone(tasks.tasks) && tasks.verification?.ok)) {
      throw new Error(`"${feature}" is verified: plan the next change as its own feature.`)
    }
    // The list is newest first; the latest session on the spec is the one that knows it best.
    const owner = this.sessions.list().find((r) => r.mode === 'plan' && r.feature && specPath(this.workspaceRoot, r.feature) === path)
    if (owner) await this.open(owner.id, into)
    else await this.newSession('plan', feature, resumePlanPrompt(feature), into, 'Picking the plan up')
  }

  async open(sessionId: string, into?: ChatPanel): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (record) await this.reveal(record, into)
  }

  /** Stopping a session stops the feature it stands for: every run under it, not the one it is keyed by. Its tab closes with it. */
  async close(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    const runs = record ? this.runsOf(record) : []
    for (const run of runs) await this.sessions.close(run.id)
    if (runs.length === 0) await this.sessions.close(sessionId)
    if (record) this.closeTab(this.tabIdOf(record))
    void this.sendState()
    this.changed.fire()
  }

  async remove(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    const tabId = record ? this.tabIdOf(record) : undefined
    await this.sessions.remove(sessionId)
    this.statuses.delete(sessionId)
    this.failures.delete(sessionId)
    // The tab outlives a run under it; it closes with the last one the feature had.
    if (tabId && !this.sessions.get(tabId)) this.closeTab(tabId)
    void this.sendState()
    this.changed.fire()
  }

  private closeTab(tabId: string): void {
    this.panelOf(tabId)?.panel.dispose()
  }

  /** Called by the session manager for every event of every session. */
  onSessionEvent(sessionId: string, event: SessionEvent): void {
    const record = this.sessions.get(sessionId)
    if (record) {
      this.trackStatus(record, event)
      // A build has no tab and nobody prompts it: its events are progress for whoever is waiting.
      if (isBuild(record.mode)) return this.followDocsMap(record, event)
      if (record.parentId) this.followRun(record, event)
      this.forwardToTab(record, event)
    }
    this.trackMcpServers(sessionId, event)
    const startsOrEnds = event.type === 'session_started' || event.type === 'ended'
    // A run under the plan can hold the floor too, and whether its conversation can be compacted follows its engine.
    if (startsOrEnds) void this.sendState()
    if (record?.parentId) return
    if (startsOrEnds) this.changed.fire()
    if (record) this.followSession(record, event)
  }

  /** The session's status and why its last turn failed; the tabs and the Sessions view follow a change in either. */
  private trackStatus(record: SessionRecord, event: SessionEvent): void {
    const before = this.statuses.get(record.id) ?? 'idle'
    const after = nextStatus(before, actingMode(record), event)
    const failure = lastFailure(this.failures.get(record.id), event)
    const failureChanged = failure !== this.failures.get(record.id)
    if (failure === undefined) this.failures.delete(record.id)
    else this.failures.set(record.id, failure)
    if (after === before && !failureChanged) return
    this.statuses.set(record.id, after)
    void this.sendState()
    this.changed.fire()
  }

  /** A run under a session keeps its one line on the plan bar, and now also fills its own section of the tab. */
  private followRun(record: SessionRecord, event: SessionEvent): void {
    if (record.mode === 'cleanup') this.cleanup.follow(record, event)
    else if (record.mode === 'implement') void this.build.followTask(record, event)
    else this.followCheck(record, event)
  }

  private forwardToTab(record: SessionRecord, event: SessionEvent): void {
    const tabId = this.tabIdOf(record)
    void this.panelOf(tabId)?.panel.webview.postMessage({
      type: 'event',
      sessionId: tabId,
      run: this.runRef(record),
      event: forDisplay(event),
    } satisfies ToWebview)
  }

  /** A task run can hold the floor, so its servers are what the composer shows while it does. */
  private trackMcpServers(sessionId: string, event: SessionEvent): void {
    if (event.type === 'mcp_servers') {
      this.mcpServers.set(sessionId, event.servers)
      void this.sendState()
    }
    if (event.type === 'ended') this.mcpServers.delete(sessionId)
  }

  /** What a session's own events (not a run's under it) set going: the plan bar, the build, a granted evaluation, the plan's next step. */
  private followSession(record: SessionRecord, event: SessionEvent): void {
    if (event.type === 'tool_result' && record.feature && this.isOpen(record.id)) {
      // The session just wrote a plan file (a revision, proposals, a task's progress); the plan bar and view must follow.
      void this.sendState()
    }
    if (event.type === 'turn_done' && !event.isError && record.mode === 'implement' && record.feature) {
      // A task run under the plan follows its amendment in followTask, before the next task starts.
      const feature = record.feature
      void this.build.followAmendment(feature).then(() => this.build.followBoard(feature))
    }
    this.followDocsEvaluation(record, event)
    if (event.type === 'turn_done' && record.mode === 'plan' && record.feature) this.followPlanTurn(record, record.feature, event.isError)
  }

  /**
   * The evaluation has been said: the session goes on with the full tool set, so what it found is worked on where it was read.
   * The model marks the reply that says it; the grant waits for the turn to end, since it stops the engine.
   */
  private followDocsEvaluation(record: SessionRecord, event: SessionEvent): void {
    if (record.mode !== 'docs') return
    if (event.type === 'assistant_message' && deliversEvaluation(event.text)) this.evaluationsDelivered.add(record.id)
    if (event.type === 'turn_done' && !event.isError && record.access !== 'full' && this.evaluationsDelivered.delete(record.id)) {
      void this.sessions.grantFullAccess(record.id).then(() => this.sendState())
    }
  }

  private followPlanTurn(record: SessionRecord, feature: string, isError: boolean): void {
    // However the turn ended, the rulings are no longer in flight: Approve is the user's again, on the spec as it stands.
    const applied = this.applying.delete(feature)
    const reviewed = this.reviewingDocs.delete(feature)
    if (applied || reviewed) void this.sendState()
    // The clean check was the go-ahead for the build; the docs listing was the last thing between it and the implementer.
    if (reviewed && !isError) void this.build.implementAfterApproval(record)
    if (!isError) void this.followPlan(record)
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
    await this.sessions.send(child.id, reconcileKickoff(child.engineSessionId !== undefined), 'Checking the spec against the code')
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
        await this.sessions.send(parentId, decisionsHandoffPrompt(feature, unproposed), `${unproposed.length} open decision${unproposed.length === 1 ? '' : 's'} handed over`)
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
    const decisions = await readDecisions(decisionsPath(this.workspaceRoot, feature))
    await mkdir(dirname(path), { recursive: true })
    await writeBoard(path, deriveBoard(parseSpec(spec.body), existing, await readScenarioContext(contextPath(this.workspaceRoot, feature)), spec.built, decisions))
    await this.sendState()
    if (existing) return this.build.implementAfterApproval(plan)
    this.reviewingDocs.add(feature)
    await this.sendToPlanner(plan, docsAfterApprovalPrompt(feature, cutCoveredDocs()), DOCS_REVIEW_LABEL)
  }

  /** A build the last window cut off mid-turn goes on where it stood. */
  resumeCutOffBuilds(): Promise<void> {
    return this.build.resumeCutOffBuilds()
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
      const label = 'Bringing the plan files to the contract'
      if (live) await this.sessions.send(live.id, prompt, label)
      else await this.newSession('plan', feature, prompt, undefined, label)
    }
    await this.sendState()
    return report
  }

  /**
   * The `Kiwipow Agent: Build Repo Map` command. The build is mechanical and runs
   * in the extension host: no engine is started, so nothing is spent and
   * nothing is asked of the user while it runs.
   */
  async buildRepoMap(): Promise<void> {
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kiwipow Agent: building the repo map' },
        (progress) => buildRepoMap(this.workspaceRoot, (line) => progress.report({ message: line })),
      )
      const count = result.projects.length
      void vscode.window.showInformationMessage(`Kiwipow Agent: repo map built — ${count} project${count === 1 ? '' : 's'}.`)
    } catch (error) {
      void vscode.window.showWarningMessage(`Kiwipow Agent: the repo map could not be built: ${errorMessage(error)}`)
    }
  }

  /**
   * The `Kiwipow Agent: Build Docs Map` command. Unlike the repo map this one
   * spends a turn, so it says up front how many docs it has to read and
   * nothing at all when the map is already current.
   */
  async buildDocsMapCommand(ignored: string[]): Promise<void> {
    const plan = await planDocsMap(this.workspaceRoot, ignored)
    if (plan.current && (await this.docsMapIsComposed())) {
      void vscode.window.showInformationMessage('Kiwipow Agent: the docs map is current.')
      return
    }
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kiwipow Agent: building the docs map' },
        (progress) => this.buildDocsMap(ignored, (line) => progress.report({ message: line })),
      )
      const described = result.described.length
      const left = result.undescribed.length
      const tail = left === 0 ? '' : `, ${left} still to describe`
      void vscode.window.showInformationMessage(`Kiwipow Agent: docs map built: ${described} doc${described === 1 ? '' : 's'}${tail}.`)
    } catch (error) {
      void vscode.window.showWarningMessage(`Kiwipow Agent: the docs map could not be built: ${errorMessage(error)}`)
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
      await this.sessions.send(record.id, docsMapKickoff(docs), `Describing ${docs.length} doc${docs.length === 1 ? '' : 's'}`)
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

  /** Every plan under `specs/`, the command's entry point; one summary at the end. */
  async migratePlans(): Promise<void> {
    const plans = await listPlans(this.workspaceRoot)
    if (plans.length === 0) {
      void vscode.window.showInformationMessage('Kiwipow Agent: no plans to migrate.')
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
    void vscode.window.showInformationMessage(`Kiwipow Agent: migrated ${plans.length} plan${plans.length === 1 ? '' : 's'}; ${parts.join('; ')}.`)
  }

  /** `handed` says the planner has the remaining problems now; otherwise its turn is over and they are the user's to look at. */
  private reportMigration(report: MigrationReport, handed: boolean): void {
    const left = report.problems.length
    if (left === 0) {
      const done = report.steps.length > 0 ? `: ${report.steps.join(' ')}` : '.'
      void vscode.window.showInformationMessage(`Kiwipow Agent: "${report.feature}" is on contract${done}`)
      return
    }
    const problems = `${left} contract problem${left === 1 ? '' : 's'}`
    void vscode.window.showWarningMessage(
      `Kiwipow Agent: "${report.feature}" has ${problems}; ${handed ? 'the planner is rearranging the spec' : 'see the plan bar'}.`,
    )
  }

  private attach(entry: ChatPanel): void {
    const { webview } = entry.panel
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')] }
    webview.html = webviewHtml(webview, this.extensionUri, 'chat-app')
    webview.onDidReceiveMessage((message: FromWebview) => {
      this.handle(message, entry).catch((error: unknown) => {
        const text = errorMessage(error)
        void vscode.window.showErrorMessage(`Kiwipow Agent: ${text}`)
      })
    })
  }

  /** The session the tab shows, or nothing while it shows the new-session screen. */
  private shownBy(entry: ChatPanel): SessionRecord | undefined {
    return entry.tabId ? this.sessions.get(entry.tabId) : undefined
  }

  private async handle(message: FromWebview, entry: ChatPanel): Promise<void> {
    const shown = this.shownBy(entry)
    switch (message.type) {
      case 'ready':
        await this.sendState()
        if (entry.tabId) await this.sendTranscript(entry.tabId)
        return
      case 'send':
        return this.sendFromTab(message, shown, entry)
      case 'link_open_file':
        return this.linkOpenFile(entry)
      case 'agents_md_answer': {
        const tidy = await this.agentsMd.answer(message.scope, message.answer)
        // A tab on the new-session screen takes the tidy chat; one showing a session keeps it.
        if (tidy) await this.newSession('chat', undefined, agentsMdTidyKickoff(tidy.scope, tidy.agentsPath, tidy.bundles), entry.tabId ? undefined : entry, `Tidying ${tidy.agentsPath}`)
        return
      }
      case 'permission':
        return this.answerPermission(message)
      case 'question':
        if (!this.sessions.get(message.sessionId)) return
        await this.sessions.respondToQuestion(message.sessionId, message.requestId, message.outcome)
        return
      case 'interrupt':
        if (shown) await this.sessions.interrupt(this.targetOf(shown, message.sessionId, false).id)
        return
      case 'compact':
        if (shown) this.sessions.compact(this.targetOf(shown, message.sessionId, false).id)
        return
      case 'set_allow_writes':
        if (shown) this.allowWrites.setEnabled(this.targetOf(shown, message.sessionId, false).id, message.enabled)
        void this.sendState()
        return
      case 'set_session_model': {
        const profile = this.registeredModels().find((m) => m.name === message.name)
        if (shown && profile) await this.switchModel(shown.id, profile)
        void this.sendState()
        return
      }
      case 'approve_plan':
        // The approval is the go-ahead, so the build starts at once rather than waiting on another prompt.
        if (shown?.mode === 'code-plan' && shown.access !== 'full') {
          await this.sessions.grantFullAccess(shown.id, this.profileFor('code-build'))
          await this.sessions.send(shown.id, codePlanBuildKickoff(), 'Plan approved: building it')
          await this.sendState()
        }
        return
      case 'reconnect_mcp':
        if (shown) await this.sessions.reconnectMcp(this.targetOf(shown, message.sessionId, false).id, message.server)
        return
      case 'set_default_profile':
        await this.profileDefaults.set(message.name)
        await this.sendState()
        return
      case 'switch_session':
        await this.open(message.sessionId, entry)
        return
      case 'new_session':
        return this.startFromCard(message, entry)
      case 'resume_plan':
        return this.resumePlan(message.feature, entry)
      case 'approve_spec':
        return this.approveSpec(shown)
      case 'send_rulings':
        return this.sendRulings(shown)
      case 'rule_decision':
        return this.ruleDecision(shown, message)
      case 'add_comment':
        return this.reviewing(shown, (review) => void addComment(review, message.target, message.text))
      case 'edit_comment':
        return this.reviewing(shown, (review) => editComment(review, message.comment, message.text))
      case 'remove_comment':
        return this.reviewing(shown, (review) => removeComment(review, message.comment))
      case 'strike_item':
        return this.reviewing(shown, (review) => strikeItem(review, message.item))
      case 'unstrike_item':
        return this.reviewing(shown, (review) => unstrikeItem(review, message.item))
      case 'resolve_comment':
        // Resolving a comment, including a disagreement, is the human's own act; it needs no draft.
        return this.reviewing(shown, (review) => resolveComment(review, message.comment), false)
      case 'submit_review':
        return this.submitReview(shown)
      case 'check_spec': {
        // The way back in when a check failed or was stopped: approval started the first one.
        const record = this.planRecordOf(shown)
        return record ? this.startCheck(record) : undefined
      }
      case 'stop_check':
        return this.stopCheck(shown)
      case 'stop_cleanup':
        return shown?.feature ? this.cleanup.stop(shown.feature) : undefined
      case 'cleanup_decision':
        return shown?.feature ? this.cleanup.decide(shown.feature, message.decision, message.paths) : undefined
      case 'sweep_sizes':
        return shown?.feature ? this.cleanup.sweep(shown.feature) : undefined
      case 'repair_spec':
        return shown?.feature ? this.reportMigration(await this.repairPlan(shown.feature), true) : undefined
      case 'implement_spec':
        return this.implementSpec(shown)
      case 'verify_spec':
        return shown?.feature ? void (await this.build.verify(shown.feature, true)) : undefined
      case 'open_file':
        return this.openFile(message)
      case 'open_edit_diff':
        return this.openEditDiff(message)
    }
  }

  private async sendFromTab(message: WebviewMessage<'send'>, shown: SessionRecord | undefined, entry: ChatPanel): Promise<void> {
    const text = withLinkedFiles(message.text, message.files ?? [])
    if (!shown) {
      await this.newSession('chat', undefined, text, entry)
      return
    }
    // The phase the person picked names the run they talk to; nothing here guesses another.
    if (!message.sessionId) throw new Error('The message names no conversation to go to.')
    const run = this.targetOf(shown, message.sessionId, true)
    if (run.mode === 'cleanup') await this.cleanup.reengage(run)
    await this.followProfile(run)
    // A model switch picked while a turn of this chat session was in flight takes effect now (B10).
    await this.applyPendingModelSwitch(run)
    await this.sessions.send(run.id, text)
  }

  private linkOpenFile(entry: ChatPanel): void {
    // With focus in the view there may be no active text editor, so the file on screen is the one meant.
    const editor = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0]
    if (!editor) {
      void vscode.window.showWarningMessage('Kiwipow Agent: no file is open in the editor to link.')
      return
    }
    void entry.panel.webview.postMessage({
      type: 'linked_file',
      path: linkedFilePath(this.workspaceRoot, editor.document.uri.fsPath),
    } satisfies ToWebview)
  }

  private async answerPermission(message: WebviewMessage<'permission'>): Promise<void> {
    if (!this.sessions.get(message.sessionId)) return
    // The rules are in place before the call runs, so a second call they cover in the same turn already passes.
    const { remember, ...decision } = message.decision
    if (remember?.project.length) await this.permissions.allowForProject(remember.project)
    if (remember?.session.length) await this.permissions.allowForSession(message.sessionId, remember.session)
    await this.sessions.respondToPermission(message.sessionId, message.requestId, decision)
  }

  private async startFromCard(message: WebviewMessage<'new_session'>, entry: ChatPanel): Promise<void> {
    // One filing at a time: a second would propose the same entries again.
    const filing = message.mode === 'file-decisions' ? this.sessions.list().find((r) => r.mode === 'file-decisions' && this.sessions.isLive(r.id)) : undefined
    if (filing) return this.open(filing.id, entry)
    const prompt = withLinkedFiles(message.prompt ?? '', message.files ?? [])
    // The docs card, the filing and the migration have nothing to fill in, so their sessions start on the job rather than waiting for a prompt.
    const kickoff =
      message.mode === 'docs'
        ? { text: docsEvaluationKickoff(), label: 'Evaluating the docs' }
        : message.mode === 'file-decisions'
          ? { text: fileDecisionsKickoff(), label: 'Filing the decisions' }
          : message.mode === 'doc-migration'
            ? { text: docMigrationKickoff(), label: 'Migrating the docs' }
            : undefined
    if (prompt !== '' || !kickoff) await this.newSession(message.mode, message.feature, prompt, entry)
    else await this.newSession(message.mode, message.feature, kickoff.text, entry, kickoff.label)
  }

  private async approveSpec(shown: SessionRecord | undefined): Promise<void> {
    const record = this.planRecordOf(shown)
    const path = this.specPathOf(shown)
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
    await this.sendToPlanner(record, docsAfterApprovalPrompt(feature, cutCoveredDocs()), DOCS_REVIEW_LABEL)
  }

  private async sendRulings(shown: SessionRecord | undefined): Promise<void> {
    const record = this.planRecordOf(shown)
    if (!record?.feature) return
    if (!(await this.handOverRulings(record))) throw new Error('No decision is pending; there is nothing to send.')
  }

  private async ruleDecision(shown: SessionRecord | undefined, message: WebviewMessage<'rule_decision'>): Promise<void> {
    const path = this.specPathOf(shown)
    const feature = shown?.feature
    if (!path || !feature) return
    // Decisions come after approval, so an approved spec takes a ruling; an implemented one is settled.
    const spec = await readSpecState(path)
    if (!spec.exists || spec.status === 'implemented') throw new Error('The feature is implemented: there is nothing left to rule on.')
    const decisions = decisionsPath(this.workspaceRoot, feature)
    await writeFile(decisions, withRuling(await readFile(decisions, 'utf8'), message.decision, message.ruling), 'utf8')
    await this.sendState()
  }

  private async submitReview(shown: SessionRecord | undefined): Promise<void> {
    const record = this.planRecordOf(shown)
    if (!record?.feature) return
    await submitReview({
      courier: this.courier(),
      cwd: this.workspaceRoot,
      feature: record.feature,
      owner: { sessionId: record.id },
    })
    await this.sendState()
  }

  private async stopCheck(shown: SessionRecord | undefined): Promise<void> {
    const record = this.planRecordOf(shown)
    // Task runs and cleanups live under the same tab; only the check is this button's to stop.
    const child = record ? this.sessions.list().find((r) => r.parentId === record.id && r.mode === 'reconcile' && this.sessions.isLive(r.id)) : undefined
    if (!record || !child) return
    this.checks.set(record.id, { live: false, text: 'Check stopped' })
    await this.sessions.close(child.id)
    await this.sendState()
    this.changed.fire()
  }

  private async implementSpec(shown: SessionRecord | undefined): Promise<void> {
    const record = this.planRecordOf(shown)
    const path = this.specPathOf(shown)
    if (record?.mode !== 'plan' || !record.feature || !path) return
    assertImplementable(await readSpecState(path), await readTasks(tasksPath(this.workspaceRoot, record.feature)))
    await this.build.startImplementing(record)
  }

  private async openFile(message: WebviewMessage<'open_file'>): Promise<void> {
    // An edit names its file absolutely; a task names it relative to the workspace.
    const path = isAbsolute(message.path) ? message.path : join(this.workspaceRoot, message.path)
    const file = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
    const at = new vscode.Position(editLine(message.line, file.lineCount), 0)
    await vscode.window.showTextDocument(file, { selection: new vscode.Range(at, at) })
  }

  private async openEditDiff(message: WebviewMessage<'open_edit_diff'>): Promise<void> {
    // The path comes back from the webview, so only a snapshot this extension wrote is opened.
    if (!isRunSnapshot(runsRoot(this.workspaceRoot), message.snapshot)) return
    await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(message.snapshot), vscode.Uri.file(message.path), editDiffTitle(message.label))
  }

  /**
   * The plan session of a tab. The tab is the feature, whichever of its runs
   * is speaking, so the plan bar's acts belong to the planner even while an
   * implementer or a cleanup holds the floor.
   */
  private planRecordOf(shown: SessionRecord | undefined): SessionRecord | undefined {
    if (!shown?.feature) return shown
    return this.sessions.list().find((r) => r.mode === 'plan' && r.feature === shown.feature) ?? shown
  }

  private specPathOf(shown: SessionRecord | undefined): string | undefined {
    return shown?.feature ? specPath(this.workspaceRoot, shown.feature) : undefined
  }

  /**
   * One review edit: read the plan and the review from disk, change the
   * review, write it back. The file is the only state, so a reload loses
   * nothing and the agent sees the same thing the human does.
   */
  private async reviewing(shown: SessionRecord | undefined, change: (review: Review, state: SpecState) => void, draftOnly = true): Promise<void> {
    const feature = shown?.feature
    const path = this.specPathOf(shown)
    if (!feature || !path) return
    const state = await readSpecState(path)
    if (draftOnly) assertCommentable(state)
    const file = reviewPath(this.workspaceRoot, feature)
    const review = await readReview(file)
    change(review, state)
    await mkdir(dirname(file), { recursive: true })
    await writeReview(file, review, `${SPECS_DIR}/${featureSlug(feature)}.spec.md`)
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
    await this.sendToPlanner(record, rulingsHandoffPrompt(feature, rulings), `${rulings.length} ruling${rulings.length === 1 ? '' : 's'} sent`)
    return true
  }

  /** A prompt for the plan session that owns the feature, or a fresh plan session when it is gone. */
  private async sendToPlanner(record: SessionRecord, prompt: string, label: string): Promise<void> {
    const courier = this.courier()
    if (courier.isLive(record.id)) await courier.send(record.id, prompt, label)
    else await courier.start(record.feature!, prompt, label)
    await this.sendState()
  }

  /** A submitted review goes to the plan session that wrote the spec, or a fresh plan session when it is gone. */
  private courier(): ReviewCourier {
    return {
      isLive: (sessionId) => this.sessions.isLive(sessionId),
      send: (sessionId, text, label) => this.sessions.send(sessionId, text, label),
      start: async (feature, prompt, label) => {
        await this.newSession('plan', feature, prompt, undefined, label)
      },
    }
  }

  private async planState(shown: SessionRecord): Promise<PlanState | undefined> {
    const path = this.specPathOf(shown)
    // The bar belongs to the feature's planner, not to whichever of its runs is speaking: they share the tab.
    const record = this.planRecordOf(shown)
    const feature = record?.feature
    if (!path || !record || !feature) return undefined
    const state = await readSpecState(path)
    const fromPlan = record.mode === 'plan' && state.exists
    const check = this.checks.get(record.id)
    const verification = this.build.lineOf(feature)
    const cleanupState = this.cleanup.stateOf(feature)
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
      ...cleanupState,
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
      atWork: runs.some((r) => r.status === 'planning' || r.status === 'implementing') || check?.live === true || verification?.live === true || cleanupState.cleanup?.live === true,
      ...(blocked ? { blocked } : {}),
      ...(failure ? { failure } : {}),
    }
  }

  /**
   * A tab is the feature, however many runs it takes, and otherwise the one
   * session that belongs to no feature. Its title heads the view: the
   * feature, or the chat's own title, which its first message sets.
   */
  private tab(record: SessionRecord): SessionTab {
    return {
      // Keyed the same way wherever the tab is named, so a message about one run reaches the tab that holds it.
      id: this.tabIdOf(record),
      title: record.feature ?? record.title,
      mode: record.mode,
      access: record.access ?? 'scoped',
      profileName: record.profile.name,
      status: mostUrgent(this.runsOf(record).map((r) => this.statusOf(r.id))),
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

  /** The run a message from the tab names, which has to be one of the tab's; `speaking` also asks that it takes input. */
  private targetOf(shown: SessionRecord, sessionId: string, speaking: boolean): SessionRecord {
    const run = this.runsOf(shown).find((r) => r.id === sessionId)
    if (!run) throw new Error('That conversation is not under this tab.')
    const refused = speaking ? refusal(this.runControls(run)) : undefined
    if (refused) throw new Error(refused)
    return run
  }

  /**
   * Every tab is brought up to date. One state goes out at a time, so a slow
   * read cannot land after a newer one; the calls made while one runs share
   * the next, which reads after all of them.
   */
  private sendState(): Promise<void> {
    if (this.stateQueued) return this.stateQueued
    const run = this.stateTail.then(() => {
      this.stateQueued = undefined
      return this.postState()
    })
    this.stateQueued = run
    this.stateTail = run.catch(() => {})
    return run
  }

  /** The state as it stands, to every tab; its caption follows the session's name: a chat is named by its first message. */
  private async postState(): Promise<void> {
    const plans = await listPlans(this.workspaceRoot).catch((error: unknown) => {
      void vscode.window.showErrorMessage(`Kiwipow Agent: cannot list plans: ${errorMessage(error)}`)
      return []
    })
    const unfiled = await readUnfiled(this.workspaceRoot).catch((error: unknown) => {
      void vscode.window.showErrorMessage(`Kiwipow Agent: cannot read the unfiled decisions: ${errorMessage(error)}`)
      return []
    })
    const agentsMd = this.agentsMd.current()
    const shared = {
      plans: plans.flatMap((p) => (p.status === 'verified' ? [] : [{ feature: p.feature, status: p.status }])),
      chats: this.pastChats(),
      unfiled: unfiled.length,
      profiles: this.profileDefaults.read(),
      models: this.registeredModels(),
      ...(agentsMd ? { agentsMd } : {}),
    }
    for (const entry of this.panels) {
      const record = this.shownBy(entry)
      // A session removed under the tab leaves it on the new-session screen rather than on a session that is gone.
      if (entry.tabId && !record) delete entry.tabId
      const tab = record ? this.tab(record) : undefined
      entry.panel.title = tab?.title ?? NEW_SESSION_TITLE
      const plan = record
        ? await this.planState(record).catch((error: unknown) => {
            void vscode.window.showErrorMessage(`Kiwipow Agent: cannot read spec: ${errorMessage(error)}`)
            return undefined
          })
        : undefined
      void entry.panel.webview.postMessage({
        type: 'state',
        ...(tab ? { tab } : {}),
        // The switches belong to each run: the phase the person picked decides which of them the composer shows.
        runs: record ? this.runsOf(record).map((r) => this.runControls(r)) : [],
        ...(plan ? { plan } : {}),
        ...shared,
      } satisfies ToWebview)
    }
  }

  /**
   * The chats no tab is showing: closing one keeps the record and the
   * transcript, so the chat is offered back rather than lost. Only so many,
   * newest first: the state goes out on every status change, and a workspace's
   * whole history would ride along with it.
   */
  private pastChats(): ResumableChat[] {
    return this.sessions
      .list()
      .filter((r) => r.mode === 'chat' && !this.panelOf(r.id))
      .slice(0, 20)
      .map((r) => ({ sessionId: r.id, title: r.title, startedAt: r.createdAt }))
  }

  /** The tab's history: every run under it, oldest first, each its own conversation. */
  private async sendTranscript(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record) return
    const tabId = this.tabIdOf(record)
    const entry = this.panelOf(tabId)
    if (!entry) return
    const runs: RunSection[] = []
    for (const run of this.runsOf(record)) {
      runs.push({ ...this.runRef(run), events: (await this.sessions.transcript(run.id)).map(forDisplay) })
    }
    void entry.panel.webview.postMessage({ type: 'transcript', sessionId: tabId, runs } satisfies ToWebview)
  }

  private runRef(run: SessionRecord): RunRef {
    return {
      sessionId: run.id,
      mode: run.mode,
      title: run.title,
      ...(run.task !== undefined ? { task: run.task } : {}),
      ...(run.fixAttempt !== undefined ? { fixAttempt: run.fixAttempt } : {}),
    }
  }

  private runControls(run: SessionRecord): RunControls {
    return {
      ...this.runRef(run),
      profileName: run.profile.name,
      live: this.sessions.isLive(run.id),
      settled: run.settled === true,
      // A session granted full access writes wherever the rules let it, and the switch is its own again.
      ...(offersAllowWrites(actingMode(run)) ? { allowWrites: this.allowWrites.isEnabled(run.id) } : {}),
      ...(this.mcpServers.has(run.id) ? { mcp: this.mcpServers.get(run.id)! } : {}),
    }
  }
}
