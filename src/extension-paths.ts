import * as vscode from 'vscode'

/** The plugin folder this extension ships: the skills it brings, which the Claude engine loads as a plugin and our own index reads as a root. */
export function shippedPluginDir(context: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(context.extensionUri, 'dist', 'plugin').fsPath
}

/** Where a session's resolved skill list is mirrored, since the Claude engine discovers skills only from a plugin folder of its own. */
export function skillsMirrorDir(context: vscode.ExtensionContext, sessionId: string): string {
  return vscode.Uri.joinPath(context.globalStorageUri, 'skills-plugin', sessionId).fsPath
}
