import * as vscode from 'vscode'
import type { SessionManager, SessionRecord } from '../agent/session/session-manager'
import type { ModelOffer, ModelProfile, Step } from '../agent/session/model-profile'
import type { SessionStatus } from '../agent/session/session-status'
import type { AgentsMdOffers } from './agents-md-offers'
import { FeatureBuild } from './feature-build'
import { FeatureCleanup, type CleanupDeps } from './feature-cleanup'
import type { ChatRefresh, Notify, SessionSwitch, SizeLimits, Verifier } from './feature-runs'
import { attributeWith } from '../agent/phases/verification'
import { FileHands } from '../agent/session/file-hands'
import { PanelRegistry } from './panel-registry'
import { SessionTracker } from './session-tracker'
import { PlanActions } from './plan-actions'
import { TabView } from './tab-view'
import { DocsMapRunner } from './docs-map-runner'
import { StateBroadcaster } from './state-broadcaster'
import { MessageRouter } from './message-router'
import type { PlanState } from './protocol'
import type { RemoteAlertPort } from '../remote-control/alerts'
import { RemoteActions } from './remote-actions'
import { listDraftPlans } from '../agent/phases/plan-list'
import type { ChatViewProvider, PermissionStore, ProfileDefaultsStore } from './chat-view-provider'
import type { WindowLinkControl } from '../cross-window/cross-window'

export type ConstructorDeps = {
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
  remoteAlerts: RemoteAlertPort
  pushDefault: () => boolean
  /** One prompt on the model new plan sessions run on, answered as text: for the small asks that are not a session. */
  ask: (prompt: string) => Promise<string>
  windowLinks: WindowLinkControl
}

export type Collaborators = {
  panels: PanelRegistry
  cleanup: FeatureCleanup
  build: FeatureBuild
  planActions: PlanActions
  docsMap: DocsMapRunner
  tracker: SessionTracker
  tabView: TabView
  broadcaster: StateBroadcaster
  router: MessageRouter
  remoteActions: RemoteActions
}

/**
 * Every collaborator the provider delegates to, wired to call back into it
 * for the handful of things only it can answer: whether a tab shows a
 * session, and the acts (`handle`, `sendState`, `sendTranscript`,
 * `newSession`, `open`, `resumePlan`) its own methods carry out.
 */
export function wireCollaborators(provider: ChatViewProvider, deps: ConstructorDeps): Collaborators {
  const refresh: ChatRefresh = { sendState: () => provider.sendState(), changed: () => provider.fireChanged() }
  const notify = buildNotify()
  const panels = buildPanels(provider, deps)
  // Each waits on the other: the cleanup follows a passing test run, and ends in one.
  const cleanup = buildCleanup(deps, refresh, notify, async (feature) => ({ passed: await build.verify(feature, false), text: build.lineOf(feature)?.text ?? 'tests not run' }))
  const build: FeatureBuild = buildFeatureBuild(provider, deps, refresh, notify, cleanup, (id) => tracker.statusOf(id))
  const planActions: PlanActions = buildPlanActions(provider, deps, build, cleanup, (record) => tabView.planState(record))
  const docsMap = buildDocsMap(deps, (id) => tracker.forgetStatus(id))
  const tracker: SessionTracker = buildTracker(provider, deps, docsMap, build, cleanup, planActions, panels)
  const tabView: TabView = buildTabView(deps, tracker, build, cleanup, planActions)
  const broadcaster = buildBroadcaster(deps, panels, tabView)
  const router = buildRouter(provider, deps, tracker, tabView, planActions, cleanup, build)
  const remoteActions = buildRemoteActions(deps, planActions)
  return { panels, cleanup, build, planActions, docsMap, tracker, tabView, broadcaster, router, remoteActions }
}

function buildNotify(): Notify {
  return {
    warn: (text) => void vscode.window.showWarningMessage(`Kiwipow Agent: ${text}`),
    error: (text) => void vscode.window.showErrorMessage(`Kiwipow Agent: ${text}`),
    ask: (text, ...choices) => Promise.resolve(vscode.window.showWarningMessage(`Kiwipow Agent: ${text}`, { modal: true }, ...choices)),
  }
}

function buildPanels(provider: ChatViewProvider, deps: ConstructorDeps): PanelRegistry {
  return new PanelRegistry({
    extensionUri: deps.extensionUri,
    hasSession: (tabId) => deps.sessions.get(tabId) !== undefined,
    handle: (message, entry) => provider.handle(message, entry),
    changed: () => provider.fireChanged(),
  })
}

function buildCleanup(deps: ConstructorDeps, refresh: ChatRefresh, notify: Notify, verify: CleanupDeps['verify']): FeatureCleanup {
  const { workspaceRoot, sessions, profileFor, sizeLimits } = deps
  return new FeatureCleanup({ workspaceRoot, sessions, profileFor, sizeLimits, refresh, notify, verify })
}

function buildFeatureBuild(
  provider: ChatViewProvider,
  deps: ConstructorDeps,
  refresh: ChatRefresh,
  notify: Notify,
  cleanup: FeatureCleanup,
  statusOf: (sessionId: string) => SessionStatus,
): FeatureBuild {
  const { workspaceRoot, sessions, profileFor, verifier, allowWrites } = deps
  return new FeatureBuild({
    workspaceRoot,
    sessions,
    profileFor,
    verifier,
    attribute: (feature) => attributeWith(new FileHands(workspaceRoot, `verify-${feature}`, 'implement', feature), feature, workspaceRoot),
    allowWrites,
    statusOf,
    isOpen: (id) => provider.isOpen(id),
    refresh,
    notify,
    listener: cleanup,
  })
}

function buildPlanActions(
  provider: ChatViewProvider,
  deps: ConstructorDeps,
  build: FeatureBuild,
  cleanup: FeatureCleanup,
  planState: (record: SessionRecord) => Promise<PlanState | undefined>,
): PlanActions {
  const { workspaceRoot, sessions, profileFor } = deps
  return new PlanActions({
    workspaceRoot,
    sessions,
    profileFor,
    build,
    cleanup,
    newSession: (mode, feature, prompt, into, label) => provider.newSession(mode, feature, prompt, into, label),
    open: (sessionId, into) => provider.open(sessionId, into),
    planState,
    sendState: () => provider.sendState(),
    changed: () => provider.fireChanged(),
  })
}

function buildDocsMap(deps: ConstructorDeps, forgetStatus: (sessionId: string) => void): DocsMapRunner {
  const { workspaceRoot, sessions, profileFor } = deps
  return new DocsMapRunner({ workspaceRoot, sessions, profileFor, forgetStatus })
}

function buildTracker(
  provider: ChatViewProvider,
  deps: ConstructorDeps,
  docsMap: DocsMapRunner,
  build: FeatureBuild,
  cleanup: FeatureCleanup,
  planActions: PlanActions,
  panels: PanelRegistry,
): SessionTracker {
  const { sessions, profileFor, remoteAlerts, pushDefault } = deps
  return new SessionTracker({
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
    remoteAlerts,
    pushDefault,
  })
}

function buildTabView(deps: ConstructorDeps, tracker: SessionTracker, build: FeatureBuild, cleanup: FeatureCleanup, planActions: PlanActions): TabView {
  const { workspaceRoot, sessions, allowWrites, windowLinks } = deps
  return new TabView({ workspaceRoot, sessions, tracker, build, cleanup, planActions, allowWrites, windowLinks })
}

function buildBroadcaster(deps: ConstructorDeps, panels: PanelRegistry, tabView: TabView): StateBroadcaster {
  const { workspaceRoot, sessions, profileDefaults, registeredModels, agentsMd } = deps
  return new StateBroadcaster({ workspaceRoot, sessions, panels, tabView, profileDefaults, registeredModels, agentsMd })
}

function buildRouter(
  provider: ChatViewProvider,
  deps: ConstructorDeps,
  tracker: SessionTracker,
  tabView: TabView,
  planActions: PlanActions,
  cleanup: FeatureCleanup,
  build: FeatureBuild,
): MessageRouter {
  const { workspaceRoot, sessions, profileFor, registeredModels, profileDefaults, allowWrites, permissions, agentsMd, ask, windowLinks } = deps
  return new MessageRouter({
    workspaceRoot,
    sessions,
    profileFor,
    ask,
    registeredModels,
    profileDefaults,
    allowWrites,
    windowLinks,
    permissions,
    agentsMd,
    tracker,
    tabView,
    planActions,
    cleanup,
    build,
    newSession: (mode, feature, prompt, into, label) => provider.newSession(mode, feature, prompt, into, label),
    open: (sessionId, into) => provider.open(sessionId, into),
    resumePlan: (feature, into, note) => provider.resumePlan(feature, into, note),
    resumePlanAside: (feature, stayOn) => provider.resumePlanAside(feature, stayOn),
    sendState: () => provider.sendState(),
    sendTranscript: (sessionId) => provider.sendTranscript(sessionId),
  })
}

function buildRemoteActions(deps: ConstructorDeps, planActions: PlanActions): RemoteActions {
  const { sessions, workspaceRoot } = deps
  return new RemoteActions({
    sessions,
    plans: planActions,
    isDraft: async (feature) => (await listDraftPlans(workspaceRoot)).some((d) => d.feature === feature),
  })
}
