import * as vscode from 'vscode'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { errorMessage } from '../error-message'
import { CrossWindow, type LinkPrompts, type LinkedSessions } from './cross-window'
import { FileLinkStore } from './file-link-store'
import { FileMailbox } from './file-mailbox'
import { PRESENCE_TTL_MS } from './window-links'

/** How soon a message from the other window is picked up. */
const POLL_MS = 1000
/** Well inside the time after which the other side shows this window as disconnected. */
const HEARTBEAT_MS = PRESENCE_TTL_MS / 3

/** The same folder opened again is the same workspace to the other windows; a hash keeps it usable as a folder name. */
function workspaceIdOf(workspaceRoot: string): string {
  const key = process.platform === 'win32' ? workspaceRoot.toLowerCase() : workspaceRoot
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

const prompts: LinkPrompts = {
  async pickWay() {
    const create = { label: 'Create a pairing code', detail: 'Enter it in a chat session of the other window.', way: 'create' as const }
    const enter = { label: 'Enter a pairing code', detail: 'The code a chat session of the other window created.', way: 'enter' as const }
    return (await vscode.window.showQuickPick([create, enter], { title: 'Link this chat to another window' }))?.way
  },
  async showCode(code, validMinutes) {
    await vscode.env.clipboard.writeText(code)
    void vscode.window.showInformationMessage(
      `Kiwipow Agent: pairing code ${code}, copied to the clipboard. Enter it in the other window within ${validMinutes} minutes, under Linked work on its new-session screen or Link window on a chat.`,
    )
  },
  async askCode() {
    return vscode.window.showInputBox({ title: 'Link this chat to another window', prompt: 'The pairing code the other window created', ignoreFocusOut: true })
  },
}

/** This window's end of cross-window chat, polling for the other side for as long as the extension runs. */
export function createCrossWindow(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  sessions: LinkedSessions,
  changed: () => void,
  output: vscode.OutputChannel,
): CrossWindow {
  const crossWindow = new CrossWindow({
    store: new FileLinkStore(),
    mailbox: new FileMailbox(),
    self: { workspaceId: workspaceIdOf(workspaceRoot), workspaceName: vscode.workspace.name ?? basename(workspaceRoot) },
    sessions,
    // A remote, container or WSL host has a home folder of its own, which the windows on this machine never read.
    onLocalMachine: () => vscode.env.remoteName === undefined,
    limit: () => vscode.workspace.getConfiguration('kiwiAgent').get<number>('linkedAgentMessageLimit', 20),
    prompts,
    changed,
  })
  const report = (what: string) => (error: unknown) => output.appendLine(`cross-window chat: ${what}: ${errorMessage(error)}`)
  const beat = () => {
    try {
      crossWindow.heartbeat()
    } catch (error) {
      report('could not mark this window as open')(error)
    }
  }
  let polling = false
  const poll = () => {
    if (polling) return
    polling = true
    crossWindow
      .poll()
      .catch(report('could not take messages from the other window'))
      .finally(() => (polling = false))
  }
  beat()
  const heartbeat = setInterval(beat, HEARTBEAT_MS)
  const poller = setInterval(poll, POLL_MS)
  context.subscriptions.push({
    dispose: () => {
      clearInterval(heartbeat)
      clearInterval(poller)
      try {
        crossWindow.leave()
      } catch (error) {
        report('could not tell the other window this one closed')(error)
      }
    },
  })
  return crossWindow
}
