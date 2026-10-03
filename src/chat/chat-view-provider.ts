import * as vscode from 'vscode'
import { isFeatureless, type SessionManager, type SessionMode, type SessionRecord } from '../agent/session/session-manager'
import type { ModelOffer, ModelProfile, Step } from '../agent/session/model-profile'
import type { SessionEvent } from '../agent/session/code-session'
import type { SessionStatus } from '../agent/session/session-status'
import type { DocsMapResult } from '../agent/docs-map/build'
import type { FromWebview } from './protocol'
import type { AgentsMdOffers } from './agents-md-offers'
import { FeatureBuild } from './feature-build'
import { FeatureCleanup } from './feature-cleanup'
import type { ChatRefresh, Notify, SessionSwitch, SizeLimits, Verifier } from './feature-runs'
import type { ProfileDefaults } from '../settings/settings-store'
import { attributeWith } from '../agent/phases/verification'
import { FileHands } from '../agent/session/file-hands'
import { CHAT_PANEL_TYPE, PanelRegistry, type ChatPanel } from './panel-registry'
import { SessionTracker } from './session-tracker'
import { PlanActions } from './plan-actions'
import { TabView, runsOf, tabIdOf } from './tab-view'
import { DocsMapRunner } from './docs-map-runner'
import { StateBroadcaster } from './state-broadcaster'
import { MessageRouter } from './message-router'

export { CHAT_PANEL_TYPE }

type ConstructorDeps = {
  extensionUri: vscode.Uri
  sessions: SessionManager
  profileFor: (step: Step, attempt?: number) => ModelProfile
  profileDefaults: ProfileDefaultsStore
  registeredModels: () => ModelOffer[]
  verifier: Verifier
  sizeLimits: SizeLimits
  allowWrites: SessionSwitch
  permissions: PermissionStore
  workspaceRoot: string
  agentsMd: AgentsMdOffers
}

type Collaborators = {
  panels: PanelRegistry
  cleanup: FeatureCleanup
  build: FeatureBuild
  planActions: PlanActions
  docsMap: DocsMapRunner
  tracker: SessionTracker
  tabView: TabView
  broadcaster: StateBroadcaster
  router: MessageRouter
}

/**
 * Every collaborator the provider delegates to, wired to call back into it
 * for the handful of things only it can answer: whether a tab shows a
 * session, and the acts (`handle`, `sendState`, `sendTranscript`,
 * `newSession`, `open`, `resumePlan`) its own methods carry out.
 */
function wireCollaborators(provider: ChatViewProvider, deps: ConstructorDeps): Collaborators {
  const { extensionUri, sessions, profileFor, profileDefaults, registeredModels, verifier, sizeLimits, allowWrites, permissions, workspaceRoot, agentsMd } = deps
  const refresh: ChatRefresh = { sendState: () => provider.sendState(), changed: () => provider.fireChanged() }
  const notify: Notify = {
    warn: (text) => void vscode.window.showWarningMessage(`Kiwipow Agent: ${text}`),
    error: (text) => void vscode.window.showErrorMessage(`Kiwipow Agent: ${text}`),
    ask: (text, ...choices) => Promise.resolve(vscode.window.showWarningMessage(`Kiwipow Agent: ${text}`, { modal: true }, ...choices)),
  }
  const panels = new PanelRegistry({
    extensionUri,
    hasSession: (tabId) => sessions.get(tabId) !== undefined,
    handle: (message, entry) => provider.handle(message, entry),
    changed: () => provider.fireChanged(),
  })
  // Each waits on the other: the cleanup follows a passing test run, and ends in one.
  const cleanup = new FeatureCleanup({
    workspaceRoot,
    sessions,
    profileFor,
    sizeLimits,
    refresh,
    notify,
    verify: async (feature) => ({ passed: await build.verify(feature, false), text: build.lineOf(feature)?.text ?? 'tests not run' }),
  })
  const build: FeatureBuild = new FeatureBuild({
    workspaceRoot,
    sessions,
    profileFor,
    verifier,
    attribute: (feature) => attributeWith(new FileHands(workspaceRoot, `verify-${feature}`, 'implement', feature), feature, workspaceRoot),
    allowWrites,
    statusOf: (id) => tracker.statusOf(id),
    isOpen: (id) => provider.isOpen(id),
    refresh,
    notify,
    listener: cleanup,
  })
  const planActions: PlanActions = new PlanActions({
    workspaceRoot,
    sessions,
    profileFor,
    build,
    newSession: (mode, feature, prompt, into, label) => provider.newSession(mode, feature, prompt, into, label),
    open: (sessionId, into) => provider.open(sessionId, into),
    planState: (record) => tabView.planState(record),
    sendState: () => provider.sendState(),
    changed: () => provider.fireChanged(),
  })
  const docsMap = new DocsMapRunner({
    workspaceRoot,
    sessions,
    profileFor,
    forgetStatus: (id) => tracker.forgetStatus(id),
  })
  const tracker: SessionTracker = new SessionTracker({
    sessions,
    profileFor,
    docsMap,
    build,
    cleanup,
    planActions,
    panels,
    isOpen: (id) => provider.isOpen(id),
    sendState: () => provider.sendState(),
    changed: () => provider.fireChanged(),
  })
  const tabView: TabView = new TabView({ workspaceRoot, sessions, tracker, build, cleanup, planActions, allowWrites })
  const broadcaster = new StateBroadcaster({ workspaceRoot, sessions, panels, tabView, profileDefaults, registeredModels, agentsMd })
  const router = new MessageRouter({
    workspaceRoot,
    sessions,
    profileFor,
    registeredModels,
    profileDefaults,
    allowWrites,
    permissions,
    agentsMd,
    tracker,
    tabView,
    planActions,
    cleanup,
    build,
    newSession: (mode, feature, prompt, into, label) => provider.newSession(mode, feature, prompt, into, label),
    open: (sessionId, into) => provider.open(sessionId, into),
    resumePlan: (feature, into) => provider.resumePlan(feature, into),
    sendState: () => provider.sendState(),
    sendTranscript: (sessionId) => provider.sendTranscript(sessionId),
  })
  return { panels, cleanup, build, planActions, docsMap, tracker, tabView, broadcaster, router }
}

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

/**
 * Hosts the chat UI: one editor tab per session, so a session keeps running
 * in view while another is started. The provider routes each session's events
 * to its tab and tracks every session's status for the Sessions view.
 */
export class ChatViewProvider {
  private readonly panels: PanelRegistry
  private readonly cleanup: FeatureCleanup
  private readonly build: FeatureBuild
  private readonly planActions: PlanActions
  private readonly docsMap: DocsMapRunner
  private readonly tracker: SessionTracker
  private readonly tabView: TabView
  private readonly broadcaster: StateBroadcaster
  private readonly router: MessageRouter
  private readonly changed = new vscode.EventEmitter<void>()
  /** Fires when a tab opened or closed, a status changed or the session list changed. */
  readonly onDidChange = this.changed.event

  constructor(
    extensionUri: vscode.Uri,
    private readonly sessions: SessionManager,
    /** What a step runs on: the active profile's model for it. `attempt` counts the fixes of a failed test run. */
    private readonly profileFor: (step: Step, attempt?: number) => ModelProfile,
    profileDefaults: ProfileDefaultsStore,
    registeredModels: () => ModelOffer[],
    verifier: Verifier,
    sizeLimits: SizeLimits,
    private readonly allowWrites: SessionSwitch,
    permissions: PermissionStore,
    private readonly workspaceRoot: string,
    agentsMd: AgentsMdOffers,
  ) {
    const built = wireCollaborators(this, {
      extensionUri,
      sessions,
      profileFor,
      profileDefaults,
      registeredModels,
      verifier,
      sizeLimits,
      allowWrites,
      permissions,
      workspaceRoot,
      agentsMd,
    })
    this.panels = built.panels
    this.cleanup = built.cleanup
    this.build = built.build
    this.planActions = built.planActions
    this.docsMap = built.docsMap
    this.tracker = built.tracker
    this.tabView = built.tabView
    this.broadcaster = built.broadcaster
    this.router = built.router
  }

  /** Whether a tab shows the session, its own or its feature's. */
  isOpen(sessionId: string): boolean {
    const record = this.sessions.get(sessionId)
    return record !== undefined && this.panels.panelOf(tabIdOf(this.sessions, record)) !== undefined
  }

  /** A session's status, or its running check's: the check has no tab, so its state shows on the plan's. */
  statusOf(sessionId: string): SessionStatus {
    return this.tracker.statusOf(sessionId)
  }

  /**
   * A tab VS Code restores after a window reload, its state naming the
   * session it showed. A session removed meanwhile, or already shown by
   * another tab, leaves it on the new-session screen.
   */
  restore(panel: vscode.WebviewPanel, state: { tabId?: string } | undefined): void {
    this.panels.restore(panel, state)
  }

  /** A new tab on the new-session screen; the tabs already open keep their sessions in view. */
  showNewSession(): void {
    this.panels.showNewSession()
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
    const tabId = tabIdOf(this.sessions, record)
    this.panels.show(tabId, into)
    await this.sendState()
    await this.sendTranscript(tabId)
    this.changed.fire()
  }

  /** Re-reads what the state carries from settings, after they changed elsewhere. */
  refresh(): void {
    void this.sendState()
  }

  /** Picks a plan up where its spec leaves it; see `PlanActions.resumePlan`. */
  resumePlan(feature: string, into?: ChatPanel): Promise<void> {
    return this.planActions.resumePlan(feature, into)
  }

  async open(sessionId: string, into?: ChatPanel): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (record) await this.reveal(record, into)
  }

  /** Stopping a session stops the feature it stands for: every run under it, not the one it is keyed by. Its tab closes with it. */
  async close(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    const runs = record ? runsOf(this.sessions, record) : []
    for (const run of runs) await this.sessions.close(run.id)
    if (runs.length === 0) await this.sessions.close(sessionId)
    if (record) this.panels.closeTab(tabIdOf(this.sessions, record))
    void this.sendState()
    this.changed.fire()
  }

  async remove(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    const tabId = record ? tabIdOf(this.sessions, record) : undefined
    await this.sessions.remove(sessionId)
    this.tracker.forget(sessionId)
    // The tab outlives a run under it; it closes with the last one the feature had.
    if (tabId && !this.sessions.get(tabId)) this.panels.closeTab(tabId)
    void this.sendState()
    this.changed.fire()
  }

  /** Called by the session manager for every event of every session. */
  onSessionEvent(sessionId: string, event: SessionEvent): void {
    this.tracker.onSessionEvent(sessionId, event)
  }

  /** A build the last window cut off mid-turn goes on where it stood. */
  resumeCutOffBuilds(): Promise<void> {
    return this.build.resumeCutOffBuilds()
  }

  /** The `Kiwipow Agent: Build Repo Map` command. */
  buildRepoMap(): Promise<void> {
    return this.docsMap.buildRepoMapCommand()
  }

  /** The `Kiwipow Agent: Build Docs Map` command. */
  buildDocsMapCommand(ignored: string[]): Promise<void> {
    return this.docsMap.buildDocsMapCommand(ignored)
  }

  /**
   * Describes the docs that changed and composes the map. Two callers asking
   * at once (a session start and the command, or two starts) share the one
   * build rather than spending the turn twice.
   */
  buildDocsMap(ignored: string[], onProgress: (line: string) => void = () => {}): Promise<DocsMapResult> {
    return this.docsMap.build(ignored, onProgress)
  }

  /** Every plan under `specs/`, the command's entry point; one summary at the end. */
  migratePlans(): Promise<void> {
    return this.planActions.migratePlans()
  }

  /** Not part of the provider's own API: called back from `wireCollaborators` and from inside this class alike. */
  handle(message: FromWebview, entry: ChatPanel): Promise<void> {
    return this.router.handle(message, entry)
  }

  sendState(): Promise<void> {
    return this.broadcaster.send()
  }

  sendTranscript(sessionId: string): Promise<void> {
    return this.broadcaster.transcript(sessionId)
  }

  /** Fires `onDidChange`; a plain method so `wireCollaborators` can call it without reaching into the private emitter. */
  fireChanged(): void {
    this.changed.fire()
  }
}
