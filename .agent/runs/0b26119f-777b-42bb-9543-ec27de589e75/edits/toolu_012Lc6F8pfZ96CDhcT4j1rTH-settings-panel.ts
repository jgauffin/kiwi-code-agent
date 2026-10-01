import * as vscode from 'vscode'
import type { MemoryScope } from '../agent/memory/memories'
import { webviewHtml } from '../chat/webview-html'
import type { FromSettingsWebview, SettingsTarget, ToSettingsWebview } from './protocol'
import type { SettingsStore } from './settings-store'

export const SETTINGS_PANEL_TYPE = 'kiwiAgent.settingsPanel'

/**
 * What an OpenAI-compatible endpoint says it serves, off the base URL and key
 * as the form has them now rather than what was last saved; an empty
 * `apiKeyValue` falls back to what is already stored under `name`.
 */
export type ModelLister = (args: { name: string; baseUrl: string; apiKeyValue: string }) => Promise<string[]>

/** A memory's own file, absolute, to open it for the person to change by hand. */
export type MemoryPathOf = (scope: MemoryScope, file: string) => string

/** Hosts the settings page in one editor panel; every write goes through the store and the page is re-sent after it. */
export class SettingsPanel {
  private panel: vscode.WebviewPanel | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: SettingsStore,
    private readonly listModels: ModelLister,
    private readonly memoryPathOf: MemoryPathOf,
  ) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal()
      return
    }
    this.adopt(vscode.window.createWebviewPanel(SETTINGS_PANEL_TYPE, 'Kiwipow Agent Settings', vscode.ViewColumn.Active, { retainContextWhenHidden: true }))
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
        void vscode.window.showErrorMessage(`Kiwipow Agent: ${text}`)
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
        case 'save_provider':
          await this.store.saveProvider(message.index, message.provider)
          return
        case 'remove_provider':
          await this.store.removeProvider(message.index)
          return
        case 'refresh_models':
          await this.refreshModels(message)
          return
        case 'set_api_key':
          await this.store.setApiKey(message.name, message.value)
          return
        case 'open_settings_file':
          await openSettingsFile(message.target)
          return
        case 'open_memory':
          await openMemoryFile(this.memoryPathOf(message.scope, message.file))
          return
        case 'forget_memory':
          await this.store.forgetMemory(message.scope, message.title)
          return
      }
    } finally {
      // The page shows what the host holds, whether the write went through or was refused.
      await this.send()
    }
  }

  private async refreshModels(args: { name: string; baseUrl: string; apiKeyValue: string }): Promise<void> {
    const models = await this.listModels(args)
    if (!this.panel) return
    const message: ToSettingsWebview = { type: 'models', provider: args.name, models }
    await this.panel.webview.postMessage(message)
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
