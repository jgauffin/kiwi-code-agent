import * as vscode from 'vscode'
import { listDraftPlans, type PlanSummary } from '../agent/phases/plan-list'
import { PLAN_DIR, specPath } from '../agent/phases/blind-plan'
import type { SessionManager } from '../agent/session/session-manager'
import type { ChatViewProvider } from './chat-view-provider'

const HAS_DRAFTS = 'kiwiAgent.hasDraftPlans'

/**
 * The Sessions view's "open draft plan" action: shown while a spec under
 * `plan/` is still a draft, it opens the plan session behind the spec, or
 * the spec itself when no session for it remains.
 */
export function openDraftPlanAction(
  chat: ChatViewProvider,
  sessions: SessionManager,
  workspaceRoot: string,
  output: vscode.OutputChannel,
): vscode.Disposable {
  const refresh = async (): Promise<void> => {
    const drafts = await listDraftPlans(workspaceRoot)
    output.appendLine(`draft plans under ${workspaceRoot}/${PLAN_DIR}: ${drafts.map((d) => d.feature).join(', ') || 'none'}`)
    await vscode.commands.executeCommand('setContext', HAS_DRAFTS, drafts.length > 0)
  }
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, `${PLAN_DIR}/*.spec.md`))
  const onChange = () => void refresh().catch(report)
  void refresh().catch(report)

  const open = async (): Promise<void> => {
    const drafts = await listDraftPlans(workspaceRoot)
    const draft = drafts.length === 1 ? drafts[0] : await pick(drafts)
    if (!draft) return
    const session = sessions.list().find((r) => r.mode === 'plan' && r.feature && specPath(workspaceRoot, r.feature) === draft.path)
    if (session) await chat.open(session.id)
    else await vscode.window.showTextDocument(vscode.Uri.file(draft.path))
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
  const text = error instanceof Error ? error.message : String(error)
  void vscode.window.showErrorMessage(`KiwiAgent: ${text}`)
}
