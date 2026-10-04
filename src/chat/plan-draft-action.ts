import * as vscode from 'vscode'
import { readFile } from 'node:fs/promises'
import type { ChatViewProvider } from './chat-view-provider'
import { errorMessage } from '../error-message'
import { draftFeatureOf, specFeatureOf } from './spec-files'

const DRAFT_OPEN = 'kiwiAgent.draftSpecOpen'

/**
 * The planner a click from the spec itself: the editor's title bar carries a
 * button while the open file is a spec still in draft, and the explorer's
 * right-click menu offers any spec, whatever its status. A badge in the
 * explorer cannot be clicked, so the menu is the way in from the file.
 *
 * The open editor is read from its text rather than from disk, so approving a
 * spec in the editor takes the button away on save.
 */
export function planDraftAction(chat: ChatViewProvider, workspaceRoot: string): vscode.Disposable {
  const draftInEditor = (editor: vscode.TextEditor | undefined): string | undefined => {
    const document = editor?.document
    if (!document || document.uri.scheme !== 'file') return undefined
    return draftFeatureOf(workspaceRoot, document.uri.fsPath, document.getText())
  }
  const track = (editor: vscode.TextEditor | undefined) =>
    void vscode.commands.executeCommand('setContext', DRAFT_OPEN, draftInEditor(editor) !== undefined)
  track(vscode.window.activeTextEditor)

  /** The file right-clicked on, or the one being read when the command comes from the title bar or the palette. */
  const featureOf = async (uri: vscode.Uri | undefined): Promise<string | undefined> => {
    if (!uri || uri.scheme !== 'file') return draftInEditor(vscode.window.activeTextEditor)
    const spec = specFeatureOf(workspaceRoot, uri.fsPath, await readFile(uri.fsPath, 'utf8'))
    return spec?.feature
  }

  const plan = async (uri: vscode.Uri | undefined): Promise<void> => {
    const feature = await featureOf(uri)
    if (!feature) {
      void vscode.window.showWarningMessage('Kiwipow Agent: that file is not one of this workspace\u2019s specs.')
      return
    }
    await chat.resumePlan(feature)
  }

  return vscode.Disposable.from(
    vscode.window.onDidChangeActiveTextEditor(track),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document === vscode.window.activeTextEditor?.document) track(vscode.window.activeTextEditor)
    }),
    vscode.commands.registerCommand('kiwiAgent.planThisSpec', (uri?: vscode.Uri) =>
      plan(uri).catch((error: unknown) => void vscode.window.showErrorMessage(`Kiwipow Agent: ${errorMessage(error)}`)),
    ),
  )
}
