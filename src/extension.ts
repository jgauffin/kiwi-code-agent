import * as vscode from 'vscode'
import { mkdirSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { SessionManager, type SessionRecord, type SessionStore } from './agent/session/session-manager'
import type { ModelProfile } from './agent/session/model-profile'
import type { CodeSession } from './agent/session/code-session'
import { SdkSession } from './agent/sdk-session/sdk-session'
import { hostExecutableAsNode, type NodeRuntime } from './agent/sdk-session/node-runtime'
import { RunLog } from './agent/runs/run-log'
import { OpenAiSession } from './agent/openai-session/openai-session'
import { OpenAiClient } from './agent/openai-session/openai-client'
import { buildSystemPrompt } from './agent/openai-session/system-prompt'
import { readTool } from './agent/openai-session/tools/read'
import { writeTool } from './agent/openai-session/tools/write'
import { editTool } from './agent/openai-session/tools/edit'
import { globTool } from './agent/openai-session/tools/glob'
import { grepTool } from './agent/openai-session/tools/grep'
import { bashTool } from './agent/openai-session/tools/bash'
import { runShell } from './agent/shell/run-shell'
import { TurnVerifier, type VerifyRule } from './agent/verify/turn-verifier'
import { ChatViewProvider, type VerifyControl } from './chat/chat-view-provider'

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('KiwiAgent')
  // Without a folder open the engine still needs a working directory that exists.
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath
  mkdirSync(workspaceRoot, { recursive: true })
  const cliPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'cli.mjs').fsPath

  const store: SessionStore = {
    list: () => context.workspaceState.get<SessionRecord[]>('sessions', []),
    save: (records) => Promise.resolve(context.workspaceState.update('sessions', records)),
  }

  const verifiers = new Map<string, TurnVerifier>()
  const verifyWanted = new Map<string, boolean>()
  const verifyControl: VerifyControl = {
    available: verifyRules().length > 0,
    isEnabled: (id) => verifiers.get(id)?.enabled ?? verifyWanted.get(id) ?? false,
    setEnabled: (id, enabled) => {
      verifyWanted.set(id, enabled)
      const v = verifiers.get(id)
      if (v) v.enabled = enabled
    },
  }

  const createEngine = async (record: SessionRecord): Promise<CodeSession> => {
    const { profile } = record
    const hooks = verifier(workspaceRoot)
    if (hooks) {
      hooks.enabled = verifyWanted.get(record.id) ?? false
      verifiers.set(record.id, hooks)
    }
    const withHooks = hooks ? { hooks } : {}
    switch (profile.engine) {
      case 'claude-sdk':
        return new SdkSession({
          id: record.id,
          profile,
          cwd: workspaceRoot,
          cliPath,
          runtime: nodeRuntime(),
          ...(record.engineSessionId ? { resumeEngineSessionId: record.engineSessionId } : {}),
          env: { CLAUDE_AGENT_SDK_CLIENT_APP: 'kiwi-agent-vscode/0.0.1' },
          ...withHooks,
          query,
          onStderr: (chunk) => output.append(chunk),
        })
      case 'openai-compatible': {
        if (!profile.baseUrl) throw new Error(`Profile "${profile.name}" has no baseUrl`)
        if (!profile.apiKeySecret) throw new Error(`Profile "${profile.name}" has no apiKeySecret`)
        const apiKey = await context.secrets.get(secretKey(profile.apiKeySecret))
        if (!apiKey) throw new Error(`No API key stored for "${profile.apiKeySecret}". Run "KiwiAgent: Set API Key for Profile".`)
        return new OpenAiSession({
          id: record.id,
          profile,
          cwd: workspaceRoot,
          client: new OpenAiClient({ baseUrl: profile.baseUrl, apiKey }),
          tools: [readTool, writeTool, editTool, globTool, grepTool, bashTool()],
          systemPrompt: await buildSystemPrompt(workspaceRoot, profile.systemPromptFile),
          ...withHooks,
        })
      }
    }
  }

  let chat: ChatViewProvider
  const sessions = new SessionManager(
    store,
    createEngine,
    (id) => RunLog.forSession(workspaceRoot, id),
    (id, event) => chat.onSessionEvent(id, event),
  )
  chat = new ChatViewProvider(context.extensionUri, sessions, profiles, verifyControl)

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider('kiwiAgent.chat', chat, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('kiwiAgent.openChat', () => chat.openInEditor()),
    vscode.commands.registerCommand('kiwiAgent.setApiKey', () => setApiKey(context)),
    { dispose: () => void sessions.disposeAll() },
  )
}

function profiles(): ModelProfile[] {
  return vscode.workspace.getConfiguration('kiwiAgent').get<ModelProfile[]>('profiles', [])
}

function verifyRules(): VerifyRule[] {
  return vscode.workspace.getConfiguration('kiwiAgent').get<VerifyRule[]>('verify', [])
}

/** Turn-boundary build/test verification from the `kiwiAgent.verify` rules; none configured means no hook. */
function verifier(cwd: string): TurnVerifier | undefined {
  const rules = verifyRules()
  if (rules.length === 0) return undefined
  return new TurnVerifier({
    cwd,
    rules,
    failureBudget: vscode.workspace.getConfiguration('kiwiAgent').get<number>('verifyFailureBudget', 3),
    run: async (command, dir) => {
      const result = await runShell(command, { cwd: dir, timeoutMs: 600_000 })
      return { ok: result.ended === 'exit' && result.exitCode === 0, output: result.output }
    },
  })
}

/**
 * The extension host may have no `node` on PATH, but its own executable runs
 * as Node when asked. A configured path wins so a machine with a specific
 * Node install can use it.
 */
function nodeRuntime(): NodeRuntime {
  const configured = vscode.workspace.getConfiguration('kiwiAgent').get<string>('nodePath', '')
  return configured ? { command: configured, args: [], env: {} } : hostExecutableAsNode(process.execPath)
}

async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const names = [...new Set(profiles().map((p) => p.apiKeySecret).filter((n): n is string => !!n))]
  if (names.length === 0) {
    void vscode.window.showInformationMessage('No profile declares an apiKeySecret.')
    return
  }
  const name = names.length === 1 ? names[0] : await vscode.window.showQuickPick(names, { title: 'API key for' })
  if (!name) return
  const key = await vscode.window.showInputBox({ title: `API key: ${name}`, password: true, ignoreFocusOut: true })
  if (key === undefined) return
  await context.secrets.store(secretKey(name), key)
  void vscode.window.showInformationMessage(`Stored API key for ${name}.`)
}

function secretKey(name: string): string {
  return `kiwiAgent.apiKey.${name}`
}
