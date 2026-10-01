import * as vscode from 'vscode'
import { mkdirSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { SessionManager, isPlanning, type SessionMode, type SessionRecord, type SessionStore } from './agent/session/session-manager'
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
import { askUserTool } from './agent/openai-session/tools/ask-user'
import { jsonQueryTool, jsonSchemaTool } from './agent/openai-session/tools/json'
import { skillTool } from './agent/openai-session/tools/skill'
import type { Tool } from './agent/openai-session/tools/tool'
import { indexSkills } from './agent/skills/skill-index'
import { runShell } from './agent/shell/run-shell'
import { composeHooks, type SessionHooks } from './agent/session/hooks'
import { FileEditRecorder } from './agent/edits/file-edit-recorder'
import { PermissionPolicy, type PermissionRules } from './agent/permissions/permission-policy'
import { WriteAllowance } from './agent/permissions/write-allowance'
import { ScopeGuard } from './agent/phases/scope-guard'
import { BLIND_PLAN_TOOLS, blindPlanPrompt, blindPlanScope } from './agent/phases/blind-plan'
import { RECONCILE_TOOLS, reconcilePrompt, reconcileScope } from './agent/phases/reconcile'
import { IMPLEMENT_TOOLS, implementPrompt } from './agent/phases/implement'
import { CLEANUP_TOOLS, cleanupPrompt, cleanupScope } from './agent/phases/cleanup'
import type { Thresholds } from './agent/cleanup/oversized'
import { SpecContract } from './agent/phases/spec-model'
import type { VerifyRule } from './agent/phases/verification'
import {
  CHAT_PANEL_TYPE,
  ChatViewProvider,
  type PermissionStore,
  type SessionSwitch,
  type SizeLimits,
  type Verifier,
} from './chat/chat-view-provider'
import { openDraftPlanAction } from './chat/open-draft-plan'
import { watchOwnBundle } from './dev-reload'

/**
 * Tools the extension provides to every engine, beside the engine's own file
 * and shell tools. A mode's tool set decides which of them it is offered; a
 * chat session names none, so it gets them all.
 */
const OWN_TOOLS: Tool[] = [jsonSchemaTool, jsonQueryTool, askUserTool]

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

  /** The test run once a feature's board is all tested: the `kiwiAgent.verify` rules, read when the run starts. */
  const verifier: Verifier = {
    rules: () => vscode.workspace.getConfiguration('kiwiAgent').get<VerifyRule[]>('verify', []),
    failureBudget: () => vscode.workspace.getConfiguration('kiwiAgent').get<number>('verifyFailureBudget', 3),
    run: async (command, dir) => {
      const result = await runShell(command, { cwd: dir, timeoutMs: 600_000 })
      return { ok: result.ended === 'exit' && result.exitCode === 0, output: result.output }
    },
  }

  /** The cleanup after a feature's tests pass: the `kiwiAgent.cleanup` limits, read when the sizes are measured. */
  const sizeLimits: SizeLimits = {
    thresholds: () => cleanupThresholds(),
    ignore: () => vscode.workspace.getConfiguration('kiwiAgent').get<string[]>('cleanup.ignore', []),
  }

  const writesAllowed = new Map<string, boolean>()
  const allowWritesControl: SessionSwitch = {
    isEnabled: (id) => writesAllowed.get(id) ?? false,
    setEnabled: (id, enabled) => void writesAllowed.set(id, enabled),
  }

  /** The composer's per-session switch: writes without a prompt. */
  const switchableHooks = (record: SessionRecord): { hooks: SessionHooks } => ({
    hooks: new WriteAllowance(() => allowWritesControl.isEnabled(record.id)),
  })

  /** Per session, what captures the file it is about to edit and turns it into the diff the chat shows. */
  const editRecorders = new Map<string, FileEditRecorder>()

  /** Rules allowed "for session": they hold beside the project's until the extension host goes. */
  const sessionAllowed = new Map<string, string[]>()
  /** Per session, the rules in force: the project's plus the session's own. */
  const policies = new Map<string, PermissionPolicy>()
  const policyFor = (sessionId: string): PermissionPolicy => {
    const existing = policies.get(sessionId)
    if (existing) return existing
    const policy = new PermissionPolicy(workspaceRoot, () => {
      const { allow, deny } = permissionRules()
      return { allow: [...allow, ...(sessionAllowed.get(sessionId) ?? [])], deny }
    })
    policies.set(sessionId, policy)
    return policy
  }

  /** What a session's mode dictates, independent of engine: hooks, prompt, tool set. */
  const setupFor = (record: SessionRecord): { hooks?: SessionHooks; systemPrompt?: string; toolNames?: string[] } => {
    const setup = modeSetup(record)
    // Last in line, so a call another hook denies is never captured: nothing changed.
    const recorder = new FileEditRecorder({ cwd: workspaceRoot, runDir: RunLog.forSession(workspaceRoot, record.id).dir })
    editRecorders.set(record.id, recorder)
    // The permission rules apply to every session; a mode's own hooks may still deny.
    return { ...setup, hooks: composeHooks(policyFor(record.id), ...(setup.hooks ? [setup.hooks] : []), recorder) }
  }

  const modeSetup = (record: SessionRecord): { hooks?: SessionHooks; systemPrompt?: string; toolNames?: string[] } => {
    switch (record.mode) {
      case 'chat':
        return switchableHooks(record)
      case 'implement': {
        if (!record.feature) throw new Error('An implement session needs a feature name')
        return {
          ...switchableHooks(record),
          systemPrompt: implementPrompt(record.feature, workspaceRoot),
          toolNames: IMPLEMENT_TOOLS,
        }
      }
      case 'plan': {
        if (!record.feature) throw new Error('A plan session needs a feature name')
        const ignored = vscode.workspace.getConfiguration('kiwiAgent').get<string[]>('planIgnore', [])
        return {
          // The contract answers on the write that broke it, so the planner fixes the spec in the same turn.
          hooks: composeHooks(new ScopeGuard(workspaceRoot, blindPlanScope(record.feature, ignored)), new SpecContract(workspaceRoot)),
          systemPrompt: blindPlanPrompt(record.feature, workspaceRoot),
          toolNames: BLIND_PLAN_TOOLS,
        }
      }
      case 'reconcile': {
        if (!record.feature) throw new Error('A reconcile session needs a feature name')
        return {
          hooks: composeHooks(new ScopeGuard(workspaceRoot, reconcileScope(record.feature)), new SpecContract(workspaceRoot)),
          systemPrompt: reconcilePrompt(record.feature, workspaceRoot),
          toolNames: RECONCILE_TOOLS,
        }
      }
      case 'cleanup': {
        if (!record.feature || !record.files) throw new Error('A cleanup session needs a feature name and the files to split')
        return {
          hooks: new ScopeGuard(workspaceRoot, cleanupScope(record.files)),
          systemPrompt: cleanupPrompt(record.feature, workspaceRoot, cleanupThresholds()),
          toolNames: CLEANUP_TOOLS,
        }
      }
    }
  }

  const createEngine = async (record: SessionRecord): Promise<CodeSession> => {
    const { profile } = record
    const setup = setupFor(record)
    const allowed = (tools: Tool[]) => (setup.toolNames ? tools.filter((t) => setup.toolNames!.includes(t.name)) : tools)
    switch (profile.engine) {
      case 'claude-sdk':
        return new SdkSession({
          ownTools: allowed(OWN_TOOLS),
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
          ...(vscode.workspace.getConfiguration('kiwiAgent').get<boolean>('traceEngine', false)
            ? { trace: (line: string) => output.appendLine(`[${record.id.slice(0, 8)}] ${line}`) }
            : {}),
        })
      case 'openai-compatible': {
        if (!profile.baseUrl) throw new Error(`Profile "${profile.name}" has no baseUrl`)
        if (!profile.apiKeySecret) throw new Error(`Profile "${profile.name}" has no apiKeySecret`)
        const apiKey = await context.secrets.get(secretKey(profile.apiKeySecret))
        if (!apiKey) throw new Error(`No API key stored for "${profile.apiKeySecret}". Run "KiwiAgent: Set API Key for Profile".`)
        // Indexed per session so a skill added to the workspace shows up on the next one.
        const skills = await indexSkills(workspaceRoot)
        const allTools = [readTool, writeTool, editTool, globTool, grepTool, ...OWN_TOOLS, bashTool(), ...(skills.length ? [skillTool(skills)] : [])]
        return new OpenAiSession({
          id: record.id,
          profile,
          cwd: workspaceRoot,
          client: new OpenAiClient({ baseUrl: profile.baseUrl, apiKey }),
          tools: allowed(allTools),
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
    // The edit diff and the command lines are added once, before the event is logged, so a reload shows the same thing.
    async (id, event) => policyFor(id).decorate((await editRecorders.get(id)?.decorate(event)) ?? event),
  )
  const permissionStore: PermissionStore = {
    allowForProject: async (rules) => {
      const config = vscode.workspace.getConfiguration('kiwiAgent')
      const current = permissionRules().allow
      const merged = [...current, ...rules.filter((r) => !current.includes(r))]
      await config.update('permissions.allow', merged, vscode.ConfigurationTarget.Workspace)
    },
    allowForSession: (sessionId, rules) => {
      const current = sessionAllowed.get(sessionId) ?? []
      sessionAllowed.set(sessionId, [...current, ...rules.filter((r) => !current.includes(r))])
    },
  }
  chat = new ChatViewProvider(
    context.extensionUri,
    sessions,
    profileFor,
    verifier,
    sizeLimits,
    allowWritesControl,
    permissionStore,
    workspaceRoot,
    context.workspaceState,
  )
  const tree = new SessionsTree(
    sessions,
    () => chat.activeId,
    (id) => chat.statusOf(id),
  )

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider('kiwiAgent.chat', chat, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewPanelSerializer(CHAT_PANEL_TYPE, {
      deserializeWebviewPanel: async (panel) => chat.adoptPanel(panel),
    }),
    vscode.window.registerTreeDataProvider('kiwiAgent.sessions', tree),
    chat.onDidChange(() => tree.refresh()),
    vscode.commands.registerCommand('kiwiAgent.newSession', () => chat.showNewSession()),
    vscode.commands.registerCommand('kiwiAgent.openSession', (id: string) => chat.open(id)),
    vscode.commands.registerCommand('kiwiAgent.removeSession', (record: SessionRecord) => chat.remove(record.id)),
    vscode.commands.registerCommand('kiwiAgent.openChat', () => chat.openInEditor()),
    vscode.commands.registerCommand('kiwiAgent.setApiKey', () => setApiKey(context)),
    vscode.commands.registerCommand('kiwiAgent.migratePlans', () => chat.migratePlans()),
    openDraftPlanAction(chat, sessions, workspaceRoot, output),
    watchOwnBundle(context),
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
  const name = (isPlanning(mode) && config.get<string>('planProfile', '')) || active
  const profile = all.find((p) => p.name === name) ?? all[0]
  if (!profile) throw new Error('No model profiles configured (kiwiAgent.profiles)')
  if (name && profile.name !== name) {
    void vscode.window.showWarningMessage(`KiwiAgent: profile "${name}" not found, using "${profile.name}".`)
  }
  return profile
}

function cleanupThresholds(): Thresholds {
  const config = vscode.workspace.getConfiguration('kiwiAgent')
  return {
    functionLines: config.get<number>('cleanup.functionLines', 25),
    typeLines: config.get<number>('cleanup.typeLines', 200),
    fileLines: config.get<number>('cleanup.fileLines', 400),
  }
}

/** Read on every tool call, so a rule just written applies at once. */
function permissionRules(): PermissionRules {
  const config = vscode.workspace.getConfiguration('kiwiAgent')
  return { allow: config.get<string[]>('permissions.allow', []), deny: config.get<string[]>('permissions.deny', []) }
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
