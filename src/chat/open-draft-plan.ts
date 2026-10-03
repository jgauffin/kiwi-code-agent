import * as vscode from 'vscode'
import { listDraftPlans, type PlanSummary } from '../agent/phases/plan-list'
import { SPECS_DIR } from '../agent/phases/blind-plan'
import type { ChatViewProvider } from './chat-view-provider'
import { errorMessage } from '../error-message'

const HAS_DRAFTS = 'kiwiAgent.hasDraftPlans'

/**
 * The Sessions view's "open draft plan" action: shown while a spec under
 * `specs/` is still a draft, it picks the draft up the same way the
 * new-session screen's pick-up list does, feature already open included.
 */
export function openDraftPlanAction(chat: ChatViewProvider, workspaceRoot: string, output: vscode.OutputChannel): vscode.Disposable {
  const refresh = async (): Promise<void> => {
    const drafts = await listDraftPlans(workspaceRoot)
    output.appendLine(`draft plans under ${workspaceRoot}/${SPECS_DIR}: ${drafts.map((d) => d.feature).join(', ') || 'none'}`)
    await vscode.commands.executeCommand('setContext', HAS_DRAFTS, drafts.length > 0)
  }
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, `${SPECS_DIR}/*.spec.md`))
  const onChange = () => void refresh().catch(report)
  void refresh().catch(report)

  const open = async (): Promise<void> => {
    const drafts = await listDraftPlans(workspaceRoot)
    const draft = drafts.length === 1 ? drafts[0] : await pick(drafts)
    if (!draft) return
    await chat.resumePlan(draft.feature)
  }

  return vscode.Disposable.from(
    watcher,
    watcher.onDidCreate(onChange),
    watcher.onDidChange(onChange),
    watcher.onDidDelete(onChange),
    vscode.commands.registerCommand('kiwiAgent.openDraftPlan', () => open().catch(report)),
  )
}

async function pick(drafts: PlanSummary[]): Promise<PlanSummary | undefined> {
  if (drafts.length === 0) return undefined
  const chosen = await vscode.window.showQuickPick(
    drafts.map((d) => ({ label: d.feature, draft: d })),
    { placeHolder: 'Plan still in draft' },
  )
  return chosen?.draft
}

function report(error: unknown): void {
  const text = errorMessage(error)
  void vscode.window.showErrorMessage(`Kiwipow Agent: ${text}`)
}
