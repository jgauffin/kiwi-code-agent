import * as vscode from 'vscode'
import type { SessionManager, SessionMode, SessionRecord } from '../agent/session/session-manager'
import type { ModelProfile } from '../agent/session/model-profile'
import type { SessionEvent } from '../agent/session/code-session'
import { nextStatus, type SessionStatus } from '../agent/session/session-status'
import type { FromWebview, SessionTab, ToWebview } from './protocol'

/** Per-session verify-on-stop switch; `available` is false when no rules are configured. */
export interface VerifyControl {
  readonly available: boolean
  isEnabled(sessionId: string): boolean
  setEnabled(sessionId: string, enabled: boolean): void
}

/**
 * Hosts the chat UI, in the sidebar view and in editor panels. Every attached
 * webview shows the same active session; the provider fans events out and
 * tracks each session's status for the tabs and the Sessions view.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  private readonly webviews = new Set<vscode.Webview>()
  private readonly statuses = new Map<string, SessionStatus>()
  private readonly changed = new vscode.EventEmitter<void>()
  /** Fires when the active session, a status or the session list changed. */
  readonly onDidChange = this.changed.event
  private activeSessionId: string | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionManager,
    private readonly profileFor: (mode: SessionMode) => ModelProfile,
    private readonly verify: VerifyControl,
  ) {}

  get activeId(): string | undefined {
    return this.activeSessionId
  }

  statusOf(sessionId: string): SessionStatus {
    return this.statuses.get(sessionId) ?? 'idle'
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.attach(view.webview)
    view.onDidDispose(() => this.webviews.delete(view.webview))
  }

  openInEditor(): void {
    const panel = vscode.window.createWebviewPanel('kiwiAgent.chatPanel', 'KiwiAgent', vscode.ViewColumn.Beside, {
      retainContextWhenHidden: true,
    })
    this.attach(panel.webview)
    panel.onDidDispose(() => this.webviews.delete(panel.webview))
  }

  async newSession(mode: SessionMode, feature?: string, prompt?: string): Promise<void> {
    if (mode === 'plan' && !feature) throw new Error('A plan session needs a feature name')
    const record = await this.sessions.create(this.profileFor(mode), mode, feature)
    this.activeSessionId = record.id
    this.sendState()
    this.broadcast({ type: 'transcript', sessionId: record.id, events: [] })
    this.changed.fire()
    if (prompt) await this.sessions.send(record.id, prompt)
  }

  showNewSession(): void {
    this.broadcast({ type: 'show_new_session' })
  }

  async open(sessionId: string): Promise<void> {
    if (!this.sessions.get(sessionId)) return
    this.activeSessionId = sessionId
    this.sendState()
    await this.sendTranscript(sessionId)
    this.changed.fire()
  }

  async close(sessionId: string): Promise<void> {
    await this.sessions.close(sessionId)
    if (this.activeSessionId === sessionId) this.activeSessionId = undefined
    this.sendState()
    this.changed.fire()
  }

  async remove(sessionId: string): Promise<void> {
    await this.sessions.remove(sessionId)
    this.statuses.delete(sessionId)
    if (this.activeSessionId === sessionId) this.activeSessionId = undefined
    this.sendState()
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
        this.sendState()
        this.changed.fire()
      }
    }
    if (sessionId === this.activeSessionId) this.broadcast({ type: 'event', sessionId, event })
    if (event.type === 'session_started' || event.type === 'ended') {
      this.sendState()
      this.changed.fire()
    }
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
        this.sendState()
        if (this.activeSessionId) await this.sendTranscript(this.activeSessionId)
        return
      case 'send':
        if (!this.activeSessionId) await this.newSession('chat')
        await this.sessions.send(this.activeSessionId!, message.text)
        return
      case 'permission':
        if (this.activeSessionId) this.sessions.respondToPermission(this.activeSessionId, message.requestId, message.decision)
        return
      case 'interrupt':
        if (this.activeSessionId) await this.sessions.interrupt(this.activeSessionId)
        return
      case 'set_verify':
        if (this.activeSessionId) this.verify.setEnabled(this.activeSessionId, message.enabled)
        this.sendState()
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
    }
  }

  /** Tabs: live sessions plus the active one, in creation order (list is newest first). */
  private tabs(): SessionTab[] {
    return this.sessions
      .list()
      .filter((r) => this.sessions.isLive(r.id) || r.id === this.activeSessionId)
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

  private sendState(): void {
    const active = this.activeSessionId
    this.broadcast({
      type: 'state',
      tabs: this.tabs(),
      ...(active && this.verify.available ? { verify: this.verify.isEnabled(active) } : {}),
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
