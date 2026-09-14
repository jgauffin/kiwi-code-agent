import * as vscode from 'vscode'
import type { SessionManager } from '../agent/session/session-manager'
import type { ModelProfile } from '../agent/session/model-profile'
import type { SessionEvent } from '../agent/session/code-session'
import type { FromWebview, SessionSummary, ToWebview } from './protocol'

/**
 * Hosts the chat UI, in the sidebar view and in editor panels. Every attached
 * webview shows the same active session; the provider fans events out.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  private readonly webviews = new Set<vscode.Webview>()
  private activeSessionId: string | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionManager,
    private readonly profiles: () => ModelProfile[],
  ) {}

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

  /** Called by the session manager for every event of every session. */
  onSessionEvent(sessionId: string, event: SessionEvent): void {
    if (sessionId === this.activeSessionId) this.broadcast({ type: 'event', sessionId, event })
    if (event.type === 'session_started' || event.type === 'ended') void this.sendState()
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
        if (!this.activeSessionId) {
          const profile = this.profiles()[0]
          if (!profile) throw new Error('No model profiles configured (kiwiAgent.profiles)')
          await this.newSession(profile)
        }
        await this.sessions.send(this.activeSessionId!, message.text)
        return
      case 'permission':
        if (this.activeSessionId) this.sessions.respondToPermission(this.activeSessionId, message.requestId, message.decision)
        return
      case 'interrupt':
        if (this.activeSessionId) await this.sessions.interrupt(this.activeSessionId)
        return
      case 'new_session': {
        const profile = this.profiles().find((p) => p.name === message.profileName)
        if (!profile) throw new Error(`Unknown profile ${message.profileName}`)
        await this.newSession(profile)
        return
      }
      case 'switch_session':
        this.activeSessionId = message.sessionId
        await this.sendState()
        await this.sendTranscript(message.sessionId)
        return
      case 'remove_session':
        await this.sessions.remove(message.sessionId)
        if (this.activeSessionId === message.sessionId) this.activeSessionId = undefined
        await this.sendState()
        return
    }
  }

  private async newSession(profile: ModelProfile): Promise<void> {
    const record = await this.sessions.create(profile)
    this.activeSessionId = record.id
    await this.sendState()
    this.broadcast({ type: 'transcript', sessionId: record.id, events: [] })
  }

  private async sendState(): Promise<void> {
    const sessions: SessionSummary[] = this.sessions.list().map((r) => ({
      id: r.id,
      title: r.title,
      profileName: r.profile.name,
      engine: r.profile.engine,
      live: this.sessions.isLive(r.id),
    }))
    this.broadcast({
      type: 'state',
      sessions,
      ...(this.activeSessionId ? { activeSessionId: this.activeSessionId } : {}),
      profiles: this.profiles().map((p) => p.name),
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
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
