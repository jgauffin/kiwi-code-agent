import * as vscode from 'vscode'
import type { ConfigPort } from './settings/settings-store'

/** The `kiwiAgent` section as the settings store and the session factory both read it. */
export function configPort(): ConfigPort {
  return {
    get: (key, fallback) => vscode.workspace.getConfiguration('kiwiAgent').get(key, fallback),
    update: (key, value, target) =>
      Promise.resolve(
        vscode.workspace
          .getConfiguration('kiwiAgent')
          .update(key, value, target === 'user' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace),
      ),
    hasWorkspace: () => (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
  }
}
