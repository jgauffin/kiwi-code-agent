import * as vscode from 'vscode'
import { SPECS_GLOB } from '../agent/phases/blind-plan'
import { readSpecState } from '../agent/phases/spec-file'
import { isSpecPath, specBadge } from './spec-files'

/** Where every spec stands, read from its front matter and shown on the file in the explorer, so the repository's state is visible without opening anything. */
export function specDecorations(workspaceRoot: string): vscode.Disposable {
  const changed = new vscode.EventEmitter<vscode.Uri[]>()
  const provider = vscode.window.registerFileDecorationProvider({
    onDidChangeFileDecorations: changed.event,
    provideFileDecoration: async (uri) => {
      if (uri.scheme !== 'file' || !isSpecPath(workspaceRoot, uri.fsPath)) return undefined
      const spec = await readSpecState(uri.fsPath)
      if (!spec.exists) return undefined
      const { badge, tooltip } = specBadge(spec.status)
      return new vscode.FileDecoration(badge, tooltip)
    },
  })
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, SPECS_GLOB))
  const refresh = (uri: vscode.Uri) => changed.fire([uri])
  return vscode.Disposable.from(provider, watcher, watcher.onDidCreate(refresh), watcher.onDidChange(refresh), watcher.onDidDelete(refresh))
}
