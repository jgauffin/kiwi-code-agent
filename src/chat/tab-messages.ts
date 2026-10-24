import * as vscode from 'vscode'
import { isAbsolute, join } from 'node:path'
import { editDiffTitle, editLine, isRunSnapshot, runsRoot } from '../agent/edits/open-edit'
import { docMigrationKickoff } from '../agent/phases/doc-migration'
import { fileDecisionsKickoff } from '../agent/phases/file-decisions'
import { featureAlreadyNamed, takenFeatureNames } from '../agent/phases/plan-list'
import { suggestFeatureName } from '../agent/phases/feature-naming'
import { errorMessage } from '../error-message'
import { linkedFilePath, withLinkedFiles } from './linked-files'
import { imageOnlyLabel } from './image-note'
import type { ToWebview } from './protocol'
import type { ChatPanel } from './panel-registry'
import type { MessageRouterDeps, WebviewMessage } from './message-router'

export function linkOpenFile(deps: MessageRouterDeps, entry: ChatPanel): void {
  // With focus in the view there may be no active text editor, so the file on screen is the one meant.
  const editor = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0]
  if (!editor) {
    void vscode.window.showWarningMessage('Kiwipow Agent: no file is open in the editor to link.')
    return
  }
  void entry.panel.webview.postMessage({
    type: 'linked_file',
    path: linkedFilePath(deps.workspaceRoot, editor.document.uri.fsPath),
  } satisfies ToWebview)
}

/** The feature names planning sessions hold, which covers one whose spec is not written yet. */
const plannedNames = (sessions: MessageRouterDeps['sessions']): string[] =>
  sessions.list().flatMap((r) => (r.mode === 'plan' && r.feature ? [r.feature] : []))

/**
 * A name for the feature being described, asked of the model so that naming one
 * is not the person's chore, and answered back to the card for them to take or
 * edit. The names in use go with the ask, so what comes back is free.
 */
export async function suggestName(deps: MessageRouterDeps, message: WebviewMessage<'suggest_feature_name'>, entry: ChatPanel): Promise<void> {
  const { workspaceRoot, sessions, ask } = deps
  const post = (answer: ToWebview) => void entry.panel.webview.postMessage(answer)
  try {
    const taken = await takenFeatureNames(workspaceRoot, plannedNames(sessions))
    post({ type: 'suggested_feature_name', name: await suggestFeatureName(ask, message.description, taken) })
  } catch (error) {
    post({ type: 'suggested_feature_name', reason: errorMessage(error) })
  }
}

export async function startFromCard(deps: MessageRouterDeps, message: WebviewMessage<'new_session'>, entry: ChatPanel): Promise<void> {
  const { sessions, newSession, open } = deps
  // One filing at a time: a second would propose the same entries again.
  const filing = message.mode === 'file-decisions' ? sessions.list().find((r) => r.mode === 'file-decisions' && sessions.isLive(r.id)) : undefined
  if (filing) return open(filing.id, entry)
  // A feature's name is its tab's identity and its spec's file name, so a second feature on a name
  // already taken would be swallowed by the first one's tab and plan over its spec.
  if (message.mode === 'plan' && message.feature) {
    const taken = await featureAlreadyNamed(deps.workspaceRoot, message.feature, plannedNames(sessions))
    if (taken) throw new Error(`"${taken}" is already planned. Pick it up below to carry on with it, or to change it once it is done.`)
  }
  const prompt = withLinkedFiles(message.prompt ?? '', message.files ?? [])
  // The filing and the docs cleanup have nothing to fill in, so their sessions start on the job rather than waiting for a prompt.
  const kickoff =
    message.mode === 'file-decisions'
      ? { text: fileDecisionsKickoff(), label: 'Filing the decisions' }
      : message.mode === 'doc-migration'
        ? { text: docMigrationKickoff(), label: 'Cleaning up the docs' }
        : undefined
  if (prompt !== '' || !kickoff) await newSession(message.mode, message.feature, prompt, entry, imageOnlyLabel(prompt, message.images?.length ?? 0), message.images ?? [])
  else await newSession(message.mode, message.feature, kickoff.text, entry, kickoff.label)
}

export async function copyText(message: WebviewMessage<'copy_text'>): Promise<void> {
  await vscode.env.clipboard.writeText(message.text)
}

export async function openFile(deps: MessageRouterDeps, message: WebviewMessage<'open_file'>): Promise<void> {
  // An edit names its file absolutely; a task names it relative to the workspace.
  const path = isAbsolute(message.path) ? message.path : join(deps.workspaceRoot, message.path)
  const file = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
  const at = new vscode.Position(editLine(message.line, file.lineCount), 0)
  await vscode.window.showTextDocument(file, { selection: new vscode.Range(at, at) })
}

export async function openEditDiff(deps: MessageRouterDeps, message: WebviewMessage<'open_edit_diff'>): Promise<void> {
  // The path comes back from the webview, so only a snapshot this extension wrote is opened.
  if (!isRunSnapshot(runsRoot(deps.workspaceRoot), message.snapshot)) return
  await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(message.snapshot), vscode.Uri.file(message.path), editDiffTitle(message.label))
}
