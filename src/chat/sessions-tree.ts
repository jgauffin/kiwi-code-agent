import * as vscode from 'vscode'
import type { SessionManager, SessionMode, SessionRecord } from '../agent/session/session-manager'
import type { SessionStatus } from '../agent/session/session-status'
import { sessionGroups, type SessionGroups } from './session-groups'

const MODE_LABEL: Record<SessionMode, string> = {
  chat: 'Chat',
  plan: 'Plan',
  reconcile: 'Check against code',
  implement: 'Implement',
  cleanup: 'Cleanup',
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

export type SessionNode = { kind: 'group'; group: keyof SessionGroups } | { kind: 'session'; record: SessionRecord }

/** The Sessions view: the chats and the plans in a folder each, with their status; click opens one in the chat. */
export class SessionsTree implements vscode.TreeDataProvider<SessionNode> {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event

  constructor(
    private readonly sessions: SessionManager,
    private readonly activeId: () => string | undefined,
    private readonly statusOf: (sessionId: string) => SessionStatus,
  ) {}

  refresh(): void {
    this.changed.fire()
  }

  getChildren(node?: SessionNode): SessionNode[] {
    const groups = sessionGroups(this.sessions.list())
    if (!node) return (['chats', 'plans'] as const).filter((g) => groups[g].length > 0).map((group) => ({ kind: 'group', group }))
    if (node.kind === 'group') return groups[node.group].map((record) => ({ kind: 'session', record }))
    return []
  }

  getTreeItem(node: SessionNode): vscode.TreeItem {
    return node.kind === 'group' ? this.groupItem(node.group) : this.sessionItem(node.record)
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
    const active = record.id === this.activeId()
    const { icon, color } = STATUS_ICON[status]
    item.id = record.id
    item.description = `${record.profile.name} · ${status.replace('_', ' ')}${active ? ' · open' : ''}`
    item.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined)
    item.tooltip = `${MODE_LABEL[record.mode]} · ${record.profile.name} · ${status.replace('_', ' ')}`
    item.contextValue = 'session'
    item.command = { command: 'kiwiAgent.openSession', title: 'Open Session', arguments: [record.id] }
    return item
  }
}
