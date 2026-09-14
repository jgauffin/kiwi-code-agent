import * as vscode from 'vscode'
import { mkdirSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { SessionManager, type SessionMode, type SessionRecord, type SessionStore } from './agent/session/session-manager'
import { SessionsTree } from './chat/sessions-tree'
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
import type { SessionHooks } from './agent/session/hooks'
import { ScopeGuard } from './agent/phases/scope-guard'
import { BLIND_PLAN_TOOLS, blindPlanPrompt, blindPlanScope } from './agent/phases/blind-plan'
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

  /** What a session's mode dictates, independent of engine: hooks, prompt, tool set. */
  const setupFor = (record: SessionRecord): { hooks?: SessionHooks; systemPrompt?: string; toolNames?: string[] } => {
    switch (record.mode) {
      case 'chat': {
        const hooks = verifier(workspaceRoot)
        if (!hooks) return {}
        hooks.enabled = verifyWanted.get(record.id) ?? false
        verifiers.set(record.id, hooks)
        return { hooks }
      }
      case 'plan': {
        if (!record.feature) throw new Error('A plan session needs a feature name')
        return {
          hooks: new ScopeGuard(workspaceRoot, blindPlanScope(record.feature)),
          systemPrompt: blindPlanPrompt(record.feature, workspaceRoot),
          toolNames: BLIND_PLAN_TOOLS,
        }
      }
    }
  }

  const createEngine = async (record: SessionRecord): Promise<CodeSession> => {
    const { profile } = record
    const setup = setupFor(record)
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
          ...(setup.hooks ? { hooks: setup.hooks } : {}),
          ...(setup.systemPrompt !== undefined ? { systemPrompt: setup.systemPrompt } : {}),
          ...(setup.toolNames ? { tools: setup.toolNames } : {}),
          query,
          onStderr: (chunk) => output.append(chunk),
        })
      case 'openai-compatible': {
        if (!profile.baseUrl) throw new Error(`Profile "${profile.name}" has no baseUrl`)
        if (!profile.apiKeySecret) throw new Error(`Profile "${profile.name}" has no apiKeySecret`)
        const apiKey = await context.secrets.get(secretKey(profile.apiKeySecret))
        if (!apiKey) throw new Error(`No API key stored for "${profile.apiKeySecret}". Run "KiwiAgent: Set API Key for Profile".`)
        const allTools = [readTool, writeTool, editTool, globTool, grepTool, bashTool()]
        return new OpenAiSession({
          id: record.id,
          profile,
          cwd: workspaceRoot,
          client: new OpenAiClient({ baseUrl: profile.baseUrl, apiKey }),
          tools: setup.toolNames ? allTools.filter((t) => setup.toolNames!.includes(t.name)) : allTools,
          systemPrompt: setup.systemPrompt ?? (await buildSystemPrompt(workspaceRoot, profile.systemPromptFile)),
          ...(setup.hooks ? { hooks: setup.hooks } : {}),
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
  chat = new ChatViewProvider(context.extensionUri, sessions, profileFor, verifyControl)
  const tree = new SessionsTree(
    sessions,
    () => chat.activeId,
    (id) => chat.statusOf(id),
  )

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider('kiwiAgent.chat', chat, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerTreeDataProvider('kiwiAgent.sessions', tree),
    chat.onDidChange(() => tree.refresh()),
    vscode.commands.registerCommand('kiwiAgent.newSession', () => chat.showNewSession()),
    vscode.commands.registerCommand('kiwiAgent.openSession', (id: string) => chat.open(id)),
    vscode.commands.registerCommand('kiwiAgent.removeSession', (record: SessionRecord) => chat.remove(record.id)),
    vscode.commands.registerCommand('kiwiAgent.openChat', () => chat.openInEditor()),
    vscode.commands.registerCommand('kiwiAgent.setApiKey', () => setApiKey(context)),
    { dispose: () => void sessions.disposeAll() },
  )
}

function profiles(): ModelProfile[] {
  return vscode.workspace.getConfiguration('kiwiAgent').get<ModelProfile[]>('profiles', [])
}

/** The profile a new session runs on comes from settings, per mode. */
function profileFor(mode: SessionMode): ModelProfile {
  const config = vscode.workspace.getConfiguration('kiwiAgent')
  const all = profiles()
  const active = config.get<string>('activeProfile', '')
  const name = (mode === 'plan' && config.get<string>('planProfile', '')) || active
  const profile = all.find((p) => p.name === name) ?? all[0]
  if (!profile) throw new Error('No model profiles configured (kiwiAgent.profiles)')
  if (name && profile.name !== name) {
    void vscode.window.showWarningMessage(`KiwiAgent: profile "${name}" not found, using "${profile.name}".`)
  }
  return profile
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
