import * as vscode from 'vscode'
import type { FromWebview } from './protocol'
import { webviewHtml } from './webview-html'
import { errorMessage } from '../error-message'

/** The chat tabs' webview type; VS Code hands tabs of this type back after a window reload. */
export const CHAT_PANEL_TYPE = 'kiwiAgent.chatPanel'

/** What a tab is called before a session is started on it. */
export const NEW_SESSION_TITLE = 'New session'

/**
 * The tab's icon. `waiting` is an animated PNG that fades in and out, the only
 * way an editor tab can draw attention: VS Code takes a still image and offers
 * no animation of its own.
 */
const TAB_ICON = { idle: 'head-128.png', waiting: 'head-waiting.png' } as const
export type TabIcon = keyof typeof TAB_ICON

/**
 * A chat tab in the editor area and the session tab it shows; absent while it
 * shows the new-session screen. `icon` is the one last assigned: reassigning
 * it would start the fade over, and the state goes out far more often than the
 * status changes.
 */
export type ChatPanel = { panel: vscode.WebviewPanel; tabId?: string; icon?: TabIcon }

export type PanelRegistryDeps = {
  extensionUri: vscode.Uri
  /** Whether a session still exists for a tab a reload is restoring. */
  hasSession: (tabId: string) => boolean
  handle: (message: FromWebview, entry: ChatPanel) => Promise<void>
  changed: () => void
}

/**
 * Every chat tab open in the editor area: one webview panel per tab, and
 * which session, if any, it shows. The provider tells it what moved; it owns
 * nothing about why.
 */
export class PanelRegistry {
  readonly panels = new Set<ChatPanel>()

  constructor(private readonly deps: PanelRegistryDeps) {}

  panelOf(tabId: string): ChatPanel | undefined {
    for (const entry of this.panels) if (entry.tabId === tabId) return entry
    return undefined
  }

  /** Assigned only on a change: setting it again restarts the fade from the top. */
  wearIcon(entry: ChatPanel, icon: TabIcon): void {
    if (entry.icon === icon) return
    entry.icon = icon
    entry.panel.iconPath = vscode.Uri.joinPath(this.deps.extensionUri, 'docs', 'logos', TAB_ICON[icon])
  }

  /**
   * A tab VS Code restores after a window reload, its state naming the
   * session it showed. A session removed meanwhile, or already shown by
   * another tab, leaves it on the new-session screen.
   */
  restore(panel: vscode.WebviewPanel, state: { tabId?: string } | undefined): void {
    const tabId = state?.tabId
    this.adopt(panel, tabId && this.deps.hasSession(tabId) && !this.panelOf(tabId) ? tabId : undefined)
  }

  /** A new tab on the new-session screen; the tabs already open keep their sessions in view. */
  showNewSession(): void {
    this.createPanel(undefined)
  }

  createPanel(tabId: string | undefined): ChatPanel {
    const panel = vscode.window.createWebviewPanel(CHAT_PANEL_TYPE, NEW_SESSION_TITLE, vscode.ViewColumn.Active, {
      enableScripts: true,
      // A tab in the background still takes its session's events; a discarded page would miss them.
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.deps.extensionUri, 'dist')],
    })
    return this.adopt(panel, tabId)
  }

  adopt(panel: vscode.WebviewPanel, tabId: string | undefined): ChatPanel {
    const entry: ChatPanel = { panel, ...(tabId ? { tabId } : {}) }
    this.wearIcon(entry, 'idle')
    this.panels.add(entry)
    this.attach(entry)
    panel.onDidDispose(() => {
      this.panels.delete(entry)
      this.deps.changed()
    })
    this.deps.changed()
    return entry
  }

  /**
   * Brings the session's tab up: the tab already showing it, else `into`
   * (the tab the request came from), else a new one.
   */
  show(tabId: string, into: ChatPanel | undefined): void {
    const open = this.panelOf(tabId)
    if (open) open.panel.reveal()
    else if (into && this.panels.has(into)) {
      into.tabId = tabId
      into.panel.reveal()
    } else this.createPanel(tabId)
  }

  closeTab(tabId: string): void {
    this.panelOf(tabId)?.panel.dispose()
  }

  private attach(entry: ChatPanel): void {
    const { webview } = entry.panel
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.deps.extensionUri, 'dist')] }
    webview.html = webviewHtml(webview, this.deps.extensionUri, 'chat-app')
    webview.onDidReceiveMessage((message: FromWebview) => {
      this.deps.handle(message, entry).catch((error: unknown) => {
        const text = errorMessage(error)
        void vscode.window.showErrorMessage(`Kiwipow Agent: ${text}`)
      })
    })
  }
}
