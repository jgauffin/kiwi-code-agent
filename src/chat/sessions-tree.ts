import * as vscode from 'vscode'
import type { SessionManager, SessionMode, SessionRecord } from '../agent/session/session-manager'
import type { SessionStatus } from '../agent/session/session-status'
import { listPlans } from '../agent/phases/plan-list'
import { sessionGroups, type PlanEntry, type SessionGroups } from './session-groups'

const MODE_LABEL: Record<SessionMode, string> = {
  chat: 'Chat',
  plan: 'Feature planning',
  reconcile: 'Check against code',
  implement: 'Implement',
  cleanup: 'Cleanup',
  'code-plan': 'Plan',
  docs: 'Evaluate docs',
  'docs-map': 'Docs map',
  'file-decisions': 'File decisions',
}

const STATUS_ICON: Record<SessionStatus, { icon: string; color?: string }> = {
  idle: { icon: 'circle-outline' },
  planning: { icon: 'checklist', color: 'charts.blue' },
  implementing: { icon: 'tools', color: 'charts.blue' },
  needs_human: { icon: 'person', color: 'charts.orange' },
  // A question waiting on the user is its own signal: the session is blocked on an answer, not merely done.
  needs_answer: { icon: 'question', color: 'charts.purple' },
  needs_approval: { icon: 'lock', color: 'charts.purple' },
  error: { icon: 'error', color: 'charts.red' },
}

const GROUP: Record<keyof SessionGroups, { label: string; icon: string }> = {
  chats: { label: 'Chats', icon: 'comment-discussion' },
  plans: { label: 'Plans', icon: 'checklist' },
}

export type SessionNode =
  | { kind: 'group'; group: keyof SessionGroups }
  | { kind: 'session'; record: SessionRecord }
  | { kind: 'plan'; plan: PlanEntry }

/** The session a node stands for, if it has one: what stop and remove act on. */
export function recordOf(node: SessionNode): SessionRecord | undefined {
  if (node.kind === 'session') return node.record
  if (node.kind === 'plan') return node.plan.record
  return undefined
}

/** The Sessions view: the chats and the plans in a folder each, with their status; click shows one in the chat view. */
export class SessionsTree implements vscode.TreeDataProvider<SessionNode> {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event

  constructor(
    private readonly sessions: SessionManager,
    private readonly workspaceRoot: string,
    private readonly isOpen: (sessionId: string) => boolean,
    private readonly statusOf: (sessionId: string) => SessionStatus,
  ) {}

  refresh(): void {
    this.changed.fire()
  }

  async getChildren(node?: SessionNode): Promise<SessionNode[]> {
    const groups = sessionGroups(this.sessions.list(), await listPlans(this.workspaceRoot))
    if (!node) return (['chats', 'plans'] as const).filter((g) => groups[g].length > 0).map((group) => ({ kind: 'group', group }))
    if (node.kind !== 'group') return []
    if (node.group === 'chats') return groups.chats.map((record) => ({ kind: 'session', record }))
    // A plan the planner has not written a spec for yet is only its session.
    return groups.plans.map((plan) => (plan.status === undefined && plan.record ? { kind: 'session', record: plan.record } : { kind: 'plan', plan }))
  }

  getTreeItem(node: SessionNode): vscode.TreeItem {
    switch (node.kind) {
      case 'group':
        return this.groupItem(node.group)
      case 'session':
        return this.sessionItem(node.record)
      case 'plan':
        return this.planItem(node.plan)
    }
  }

  private groupItem(group: keyof SessionGroups): vscode.TreeItem {
    const { label, icon } = GROUP[group]
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded)
    item.id = `group:${group}`
    item.iconPath = new vscode.ThemeIcon(icon)
    item.contextValue = 'group'
    return item
  }

  private sessionItem(record: SessionRecord): vscode.TreeItem {
    const item = new vscode.TreeItem(record.title)
    const status = this.statusOf(record.id)
    const { icon, color } = STATUS_ICON[status]
    item.id = record.id
    item.description = `${record.profile.name} · ${status.replace('_', ' ')}${this.isOpen(record.id) ? ' · shown' : ''}`
    item.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined)
    item.tooltip = `${MODE_LABEL[record.mode]} · ${record.profile.name} · ${status.replace('_', ' ')}`
    item.contextValue = 'session'
    item.command = { command: 'kiwiAgent.openSession', title: 'Open Session', arguments: [record.id] }
    return item
  }

  /** Opened by its feature, so a spec whose session is gone starts a planner on it rather than showing nothing. */
  private planItem(plan: PlanEntry): vscode.TreeItem {
    const stage = plan.status ?? 'no spec yet'
    const item = plan.record ? this.sessionItem(plan.record) : new vscode.TreeItem(plan.feature)
    item.id = `plan:${plan.feature}`
    item.label = plan.feature
    item.description = plan.record ? `${stage} · ${item.description as string}` : stage
    if (!plan.record) {
      item.iconPath = new vscode.ThemeIcon(STATUS_ICON.idle.icon)
      item.tooltip = `Plan · ${stage}`
      item.contextValue = 'plan'
    }
    item.command = { command: 'kiwiAgent.resumePlan', title: 'Open Plan', arguments: [plan.feature] }
    return item
  }
}
