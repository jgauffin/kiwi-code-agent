import { actingMode, isBuild, isFeatureless, stepOf, type SessionManager, type SessionRecord } from '../agent/session/session-manager'
import type { McpServerState, SessionEvent } from '../agent/session/code-session'
import type { ModelProfile, Step } from '../agent/session/model-profile'
import { appliesModelSwitchNow, lastFailure, nextStatus, takesProfile, type SessionStatus } from '../agent/session/session-status'
import type { ToWebview } from './protocol'
import { forDisplay } from './display-event'
import { runRef, tabIdOf } from './tab-view'
import type { DocsMapRunner } from './docs-map-runner'
import type { FeatureBuild } from './feature-build'
import type { FeatureCleanup } from './feature-cleanup'
import type { PlanActions } from './plan-actions'
import type { PanelRegistry } from './panel-registry'

export type SessionTrackerDeps = {
  sessions: SessionManager
  /** What a step runs on. `attempt` counts the fixes of a failed test run. */
  profileFor: (step: Step, attempt?: number) => ModelProfile
  docsMap: DocsMapRunner
  build: FeatureBuild
  cleanup: FeatureCleanup
  planActions: PlanActions
  panels: PanelRegistry
  /** Whether a tab shows the session, its own or its feature's. */
  isOpen: (sessionId: string) => boolean
  sendState: () => Promise<void>
  changed: () => void
}

/**
 * Every session's status and why its last turn failed, kept from the events
 * the session manager hands it; and what each event sets going elsewhere:
 * the plan bar, the build, the tab's own transcript.
 */
export class SessionTracker {
  private readonly statuses = new Map<string, SessionStatus>()
  /** Per session, why its last turn failed; absent once a turn goes through or the next prompt is sent. */
  private readonly failures = new Map<string, string>()
  /** Per running session, its MCP servers as the engine last reported them. */
  private readonly mcpServers = new Map<string, McpServerState[]>()
  /**
   * A chat session's model or effort switch, picked while its turn was still
   * in flight: held here rather than applied at once, so that turn finishes
   * on the model and effort it started on and the switch takes hold on the
   * next prompt instead (B10).
   */
  private readonly pendingProfileSwitch = new Map<string, ModelProfile>()

  constructor(private readonly deps: SessionTrackerDeps) {}

  has(sessionId: string): boolean {
    return this.statuses.has(sessionId)
  }

  failureOf(sessionId: string): string | undefined {
    return this.failures.get(sessionId)
  }

  /** A session gone for good: its status and its failure, if any, go with it. */
  forget(sessionId: string): void {
    this.statuses.delete(sessionId)
    this.failures.delete(sessionId)
  }

  /** The build's record is nobody's to return to; only its status need go with it. */
  forgetStatus(sessionId: string): void {
    this.statuses.delete(sessionId)
  }

  mcpServersOf(sessionId: string): McpServerState[] | undefined {
    return this.mcpServers.get(sessionId)
  }

  /** A session's status, or its running check's: the check has no tab, so its state shows on the plan's. */
  statusOf(sessionId: string): SessionStatus {
    const child = this.deps.sessions.liveChildOf(sessionId)
    return this.statuses.get(child?.id ?? sessionId) ?? 'idle'
  }

  /** Models are chosen in the profiles alone: a feature run takes a profile changed in settings on its next turn. A chat keeps its own switch. */
  async followProfile(run: SessionRecord): Promise<void> {
    if (isFeatureless(run.mode)) return
    const resolved = this.deps.profileFor(stepOf(run), run.fixAttempt)
    if (takesProfile(this.statusOf(run.id), run.profile, resolved)) await this.deps.sessions.setProfile(run.id, resolved)
  }

  /**
   * A chat session's own model or effort switch (B9, B14): applied at once
   * when nothing is in flight, held for the next prompt when the session is
   * `underWay`, so a turn already running finishes on the model it started on
   * (B10) instead of having its engine torn down under it.
   */
  async switchProfile(id: string, profile: ModelProfile): Promise<void> {
    if (!appliesModelSwitchNow(this.statusOf(id))) {
      this.pendingProfileSwitch.set(id, profile)
      return
    }
    this.pendingProfileSwitch.delete(id)
    await this.deps.sessions.setProfile(id, profile)
  }

  /** A switch picked mid-turn, applied now that the next prompt is about to go out (B10). */
  async applyPendingProfileSwitch(run: SessionRecord): Promise<void> {
    const pending = this.pendingProfileSwitch.get(run.id)
    if (!pending) return
    this.pendingProfileSwitch.delete(run.id)
    await this.deps.sessions.setProfile(run.id, pending)
  }

  /** What a switch changes: one already picked and waiting on the next prompt, else what the session runs on now. */
  switchingFrom(record: SessionRecord): ModelProfile {
    return this.pendingProfileSwitch.get(record.id) ?? record.profile
  }

  /** Called by the session manager for every event of every session. */
  onSessionEvent(sessionId: string, event: SessionEvent): void {
    const record = this.deps.sessions.get(sessionId)
    if (record) {
      this.trackStatus(record, event)
      // A build has no tab and nobody prompts it: its events are progress for whoever is waiting.
      if (isBuild(record.mode)) return this.deps.docsMap.follow(record, event)
      if (record.parentId) this.followRun(record, event)
      this.forwardToTab(record, event)
    }
    this.trackMcpServers(sessionId, event)
    const startsOrEnds = event.type === 'session_started' || event.type === 'ended'
    // A run under the plan can hold the floor too, and whether its conversation can be compacted follows its engine.
    if (startsOrEnds) void this.deps.sendState()
    if (record?.parentId) return
    if (startsOrEnds) this.deps.changed()
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
    void this.deps.sendState()
    this.deps.changed()
  }

  /** A run under a session keeps its one line on the plan bar, and now also fills its own section of the tab. */
  private followRun(record: SessionRecord, event: SessionEvent): void {
    if (record.mode === 'cleanup') this.deps.cleanup.follow(record, event)
    else if (record.mode === 'implement') void this.deps.build.followTask(record, event)
    else this.deps.planActions.followCheck(record, event)
  }

  private forwardToTab(record: SessionRecord, event: SessionEvent): void {
    const tabId = tabIdOf(this.deps.sessions, record)
    void this.deps.panels.panelOf(tabId)?.panel.webview.postMessage({
      type: 'event',
      sessionId: tabId,
      run: runRef(record),
      event: forDisplay(event),
    } satisfies ToWebview)
  }

  /** A task run can hold the floor, so its servers are what the composer shows while it does. */
  private trackMcpServers(sessionId: string, event: SessionEvent): void {
    if (event.type === 'mcp_servers') {
      this.mcpServers.set(sessionId, event.servers)
      void this.deps.sendState()
    }
    if (event.type === 'ended') this.mcpServers.delete(sessionId)
  }

  /** What a session's own events (not a run's under it) set going: the plan bar, the build, a granted evaluation, the plan's next step. */
  private followSession(record: SessionRecord, event: SessionEvent): void {
    if (event.type === 'tool_result' && record.feature && this.deps.isOpen(record.id)) {
      // The session just wrote a plan file (a revision, proposals, a task's progress); the plan bar and view must follow.
      void this.deps.sendState()
    }
    if (event.type === 'turn_done' && !event.isError && record.mode === 'implement' && record.feature) {
      // A task run under the plan follows its amendment in followTask, before the next task starts.
      const feature = record.feature
      void this.deps.build.followAmendment(feature).then(() => this.deps.build.followBoard(feature))
    }
    if (event.type === 'turn_done' && record.mode === 'plan' && record.feature) this.deps.planActions.followPlanTurn(record, record.feature, event.isError)
  }
}
