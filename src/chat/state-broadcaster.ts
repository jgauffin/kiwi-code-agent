import * as vscode from 'vscode'
import type { SessionManager, SessionRecord } from '../agent/session/session-manager'
import { lastActive } from '../agent/session/session-manager'
import { stoppedOnUser } from '../agent/session/session-status'
import type { ModelOffer } from '../agent/session/model-profile'
import { listPlans, type PlanSummary } from '../agent/phases/plan-list'
import { readUnfiled } from '../agent/phases/unfiled-decisions'
import { sessionGroups } from './session-groups'
import type { ResumableChat, RunSection, ToWebview } from './protocol'
import { forDisplay } from './display-event'
import { runRef, runsOf, tabIdOf } from './tab-view'
import { NEW_SESSION_TITLE, type ChatPanel, type PanelRegistry } from './panel-registry'
import type { TabView } from './tab-view'
import type { AgentsMdOffers } from './agents-md-offers'
import type { ProfileDefaultsStore } from './chat-view-provider'
import { errorMessage } from '../error-message'

export type StateBroadcasterDeps = {
  workspaceRoot: string
  sessions: SessionManager
  panels: PanelRegistry
  tabView: TabView
  profileDefaults: ProfileDefaultsStore
  registeredModels: () => ModelOffer[]
  agentsMd: AgentsMdOffers
}

/**
 * What every tab is told: the state as it stands, and its own history. One
 * state goes out at a time, so a slow read cannot land after a newer one.
 */
export class StateBroadcaster {
  /** The last state sent, settled either way: the next one waits on it. */
  private stateTail: Promise<void> = Promise.resolve()
  /** A state not started yet; every call made before it starts shares it. */
  private stateQueued: Promise<void> | undefined

  constructor(private readonly deps: StateBroadcasterDeps) {}

  /**
   * Every tab is brought up to date. One state goes out at a time, so a slow
   * read cannot land after a newer one; the calls made while one runs share
   * the next, which reads after all of them.
   */
  send(): Promise<void> {
    if (this.stateQueued) return this.stateQueued
    const run = this.stateTail.then(() => {
      this.stateQueued = undefined
      return this.postState()
    })
    this.stateQueued = run
    this.stateTail = run.catch(() => {})
    return run
  }

  /** The tab's history: every run under it, oldest first, each its own conversation. */
  async transcript(sessionId: string): Promise<void> {
    const { sessions, panels } = this.deps
    const record = sessions.get(sessionId)
    if (!record) return
    const tabId = tabIdOf(sessions, record)
    const entry = panels.panelOf(tabId)
    if (!entry) return
    const runs: RunSection[] = []
    for (const run of runsOf(sessions, record)) {
      runs.push({ ...runRef(run), events: (await sessions.transcript(run.id)).map(forDisplay) })
    }
    void entry.panel.webview.postMessage({ type: 'transcript', sessionId: tabId, runs } satisfies ToWebview)
  }

  /** The state as it stands, to every tab; its caption follows the session's name: a chat is named by its first message. */
  private async postState(): Promise<void> {
    const { workspaceRoot, panels } = this.deps
    const plans = await listPlans(workspaceRoot).catch((error: unknown) => {
      void vscode.window.showErrorMessage(`Kiwipow Agent: cannot list plans: ${errorMessage(error)}`)
      return []
    })
    const unfiled = await readUnfiled(workspaceRoot).catch((error: unknown) => {
      void vscode.window.showErrorMessage(`Kiwipow Agent: cannot read the unfiled decisions: ${errorMessage(error)}`)
      return []
    })
    const shared = this.sharedState(plans, unfiled.length)
    for (const entry of panels.panels) await this.updatePanel(entry, shared)
  }

  /** What every tab is told alike: the plans and chats it can pick up, and what new sessions run on. */
  private sharedState(plans: PlanSummary[], unfiledCount: number) {
    const { sessions, profileDefaults, registeredModels, agentsMd } = this.deps
    const groups = sessionGroups(sessions.list(), plans)
    const current = agentsMd.current()
    return {
      plans: groups.plans.map((p) => ({
        feature: p.feature,
        status: p.status,
        ...(p.lastActiveAt ? { lastActiveAt: p.lastActiveAt } : {}),
        ...(p.authored ? { authored: p.authored } : {}),
        ...(p.review ? { review: p.review } : {}),
      })),
      chats: this.pastChats(groups.chats),
      unfiled: unfiledCount,
      profiles: profileDefaults.read(),
      models: registeredModels().map((m) => ({ name: m.profile.name, efforts: [...m.efforts] })),
      ...(current ? { agentsMd: current } : {}),
    }
  }

  /** One tab's own line and, while it shows a session, its plan bar. */
  private async updatePanel(entry: ChatPanel, shared: ReturnType<StateBroadcaster['sharedState']>): Promise<void> {
    const { sessions, panels, tabView } = this.deps
    const record = entry.tabId ? sessions.get(entry.tabId) : undefined
    // A session removed under the tab leaves it on the new-session screen rather than on a session that is gone.
    if (entry.tabId && !record) delete entry.tabId
    const tab = record ? tabView.tab(record) : undefined
    entry.panel.title = tab?.title ?? NEW_SESSION_TITLE
    panels.wearIcon(entry, tab && stoppedOnUser(tab.status) ? 'waiting' : 'idle')
    const plan = record ? await this.planStateOf(record) : undefined
    void entry.panel.webview.postMessage({
      type: 'state',
      ...(tab ? { tab } : {}),
      // The switches belong to each run: the phase the person picked decides which of them the composer shows.
      runs: record ? runsOf(sessions, record).map((r) => tabView.runControls(r)) : [],
      ...(plan ? { plan } : {}),
      ...shared,
    } satisfies ToWebview)
  }

  private planStateOf(record: SessionRecord) {
    return this.deps.tabView.planState(record).catch((error: unknown) => {
      void vscode.window.showErrorMessage(`Kiwipow Agent: cannot read spec: ${errorMessage(error)}`)
      return undefined
    })
  }

  /**
   * The conversations no tab is showing: closing one keeps the record and the
   * transcript, so it is offered back rather than lost. Only so many, newest
   * worked in first: the state goes out on every status change, and a
   * workspace's whole history would ride along with it.
   */
  private pastChats(conversations: SessionRecord[]): ResumableChat[] {
    return conversations
      .filter((r) => !this.deps.panels.panelOf(r.id))
      .slice(0, 20)
      .map((r) => ({ sessionId: r.id, title: r.title, mode: r.mode, lastActiveAt: lastActive(r) }))
  }
}
