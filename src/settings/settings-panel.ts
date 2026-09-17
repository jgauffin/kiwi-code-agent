import * as vscode from 'vscode'
import { webviewHtml } from '../chat/webview-html'
import type { FromSettingsWebview, SettingsTarget, ToSettingsWebview } from './protocol'
import type { SettingsStore } from './settings-store'

export const SETTINGS_PANEL_TYPE = 'kiwiAgent.settingsPanel'

/** Hosts the settings page in one editor panel; every write goes through the store and the page is re-sent after it. */
export class SettingsPanel {
  private panel: vscode.WebviewPanel | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: SettingsStore,
  ) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal()
      return
    }
    this.adopt(vscode.window.createWebviewPanel(SETTINGS_PANEL_TYPE, 'KiwiAgent Settings', vscode.ViewColumn.Active, { retainContextWhenHidden: true }))
  }

  /** A new panel, or one VS Code revived after a window reload. */
  adopt(panel: vscode.WebviewPanel): void {
    this.panel?.dispose()
    this.panel = panel
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')] }
    panel.webview.html = webviewHtml(panel.webview, this.extensionUri, 'settings-app')
    panel.webview.onDidReceiveMessage((message: FromSettingsWebview) => {
      this.handle(message).catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error)
        void vscode.window.showErrorMessage(`KiwiAgent: ${text}`)
      })
    })
    // An edit in settings.json shows up on the page as well.
    const watch = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('kiwiAgent')) void this.send()
    })
    panel.onDidDispose(() => {
      watch.dispose()
      if (this.panel === panel) this.panel = undefined
    })
  }

  private async handle(message: FromSettingsWebview): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          return
        case 'save':
          await this.store.save(message.key, message.value)
          return
        case 'save_profile':
          await this.store.saveProfile(message.index, message.profile)
          return
        case 'remove_profile':
          await this.store.removeProfile(message.index)
          return
        case 'set_api_key':
          await this.store.setApiKey(message.name, message.value)
          return
        case 'open_settings_file':
          await openSettingsFile(message.target)
          return
      }
    } finally {
      // The page shows what the host holds, whether the write went through or was refused.
      await this.send()
    }
  }

  private async send(): Promise<void> {
    if (!this.panel) return
    const message: ToSettingsWebview = { type: 'settings', snapshot: await this.store.snapshot() }
    await this.panel.webview.postMessage(message)
  }
}

async function openSettingsFile(target: SettingsTarget): Promise<void> {
  await vscode.commands.executeCommand(target === 'user' ? 'workbench.action.openSettingsJson' : 'workbench.action.openWorkspaceSettingsFile')
}
