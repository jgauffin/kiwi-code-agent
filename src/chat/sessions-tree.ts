import * as vscode from 'vscode'
import type { SessionManager, SessionRecord } from '../agent/session/session-manager'
import type { SessionStatus } from '../agent/session/session-status'

const STATUS_ICON: Record<SessionStatus, { icon: string; color?: string }> = {
  idle: { icon: 'circle-outline' },
  planning: { icon: 'checklist', color: 'charts.blue' },
  implementing: { icon: 'tools', color: 'charts.blue' },
  verifying: { icon: 'beaker', color: 'charts.yellow' },
  needs_human: { icon: 'person', color: 'charts.orange' },
  error: { icon: 'error', color: 'charts.red' },
}

/** The Sessions view: every session, with its status; click opens it in the chat. */
export class SessionsTree implements vscode.TreeDataProvider<SessionRecord> {
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

  getChildren(): SessionRecord[] {
    return this.sessions.list()
  }

  getTreeItem(record: SessionRecord): vscode.TreeItem {
    const item = new vscode.TreeItem(record.title)
    const status = this.statusOf(record.id)
    const active = record.id === this.activeId()
    const { icon, color } = STATUS_ICON[status]
    item.id = record.id
    item.description = `${record.profile.name} · ${status.replace('_', ' ')}${active ? ' · open' : ''}`
    item.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined)
    item.tooltip = `${record.mode === 'plan' ? 'Plan' : 'Chat'} · ${record.profile.name} · ${status.replace('_', ' ')}`
    item.contextValue = 'session'
    item.command = { command: 'kiwiAgent.openSession', title: 'Open Session', arguments: [record.id] }
    return item
  }
}
