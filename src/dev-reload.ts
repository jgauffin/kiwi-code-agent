import * as vscode from 'vscode'
import { watch } from 'node:fs'
import { join } from 'node:path'

/**
 * Development loop: when the extension is loaded from the repo and its own
 * bundle is rebuilt, offer to reload the window. A packaged install never
 * sees its dist change, so this is inert there.
 */
export function watchOwnBundle(context: vscode.ExtensionContext): vscode.Disposable {
  const bundle = join(context.extensionPath, 'dist')
  let timer: NodeJS.Timeout | undefined
  let watcher: ReturnType<typeof watch> | undefined
  try {
    watcher = watch(bundle, (_, file) => {
      if (file !== 'extension.js' && file !== 'webview.js') return
      clearTimeout(timer)
      timer = setTimeout(() => {
        void vscode.window.showInformationMessage('KiwiAgent was rebuilt.', 'Reload Window').then((choice) => {
          if (choice) void vscode.commands.executeCommand('workbench.action.reloadWindow')
        })
      }, 500)
    })
  } catch (error) {
    // Only reachable when dist/ is missing, which is a broken install, not a dev loop.
    void vscode.window.showWarningMessage(`KiwiAgent: cannot watch ${bundle}: ${(error as Error).message}`)
  }
  return { dispose: () => watcher?.close() }
}
