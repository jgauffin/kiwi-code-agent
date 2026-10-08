import * as vscode from 'vscode'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import type { SessionManager } from './agent/session/session-manager'
import { recordOf, SessionsTree, type SessionNode } from './chat/sessions-tree'
import { OpenAiClient } from './agent/openai-session/openai-client'
import { MCP_CONFIG_FILE } from './agent/mcp/mcp-config'
import type { McpServerSet } from './agent/mcp/mcp-servers'
import type { PermissionPolicy } from './agent/permissions/permission-policy'
import { SPECS_ANY_GLOB } from './agent/phases/blind-plan'
import { CHAT_PANEL_TYPE, ChatViewProvider, type PermissionStore } from './chat/chat-view-provider'
import type { SessionSwitch, SizeLimits, Verifier } from './chat/feature-runs'
import { openDraftPlanAction } from './chat/open-draft-plan'
import { specDecorations } from './chat/spec-decorations'
import { planDraftAction } from './chat/plan-draft-action'
import { watchOwnBundle } from './dev-reload'
import type { SessionEngines } from './session-engines'
import { forgetMemory, listMemories, memoryPath } from './agent/memory/memories'
import { bundleFilePath, type BundleScope } from './agent/instructions/bundles'
import { applyMove, pendingMove } from './agent/instructions/claude-md-move'
import { AgentsMdOffers, type OfferKind } from './chat/agents-md-offers'
import { readOptional } from './agent/workspace-files'
import { BundleUpkeep } from './settings/bundle-upkeep'
import { SETTINGS_PANEL_TYPE, SettingsPanel } from './settings/settings-panel'
import { SettingsStore, secretKey, type BundlePort, type MemoryPort, type RemoteControlPort } from './settings/settings-store'
import { errorMessage } from './error-message'
import type { RemoteControlService } from './remote-control/remote-control-service'
import { configPort } from './config-port'
import { runStartupMigrations } from './agent/startup-migrations'
import {
  createAllowWritesControl,
  createEngines,
  createMcp,
  createPermissionStore,
  createPersonRulesStore,
  createPolicyFor,
  createProjectCommands,
  createSessionStore,
  createSessions,
  createSizeLimits,
  createVerifier,
  profileFor,
  registeredModels,
} from './session-wiring'
import type { PersonRulesStore } from './agent/permissions/person-rules'
import { createRemoteControl, pushDefault, remoteAlertPort, remoteControlPort, syncRemoteControlConnection } from './remote-control/remote-control-wiring'

function createMemoryPort(workspaceRoot: string): MemoryPort {
  return {
    list: () => listMemories(workspaceRoot),
    forget: (scope, title) => forgetMemory(scope, title, workspaceRoot),
  }
}

function createBundles(output: vscode.OutputChannel, workspaceRoot: string): BundleUpkeep {
  const bundles = new BundleUpkeep({
    config: configPort(),
    ask: (text, ...choices) => Promise.resolve(vscode.window.showInformationMessage(`Kiwipow Agent: ${text}`, ...choices)),
    log: (line) => output.appendLine(line),
    workspaceRoot,
  })
  bundles.onActivate().catch((error: unknown) => output.appendLine(`bundle sources: ${errorMessage(error)}`))
  return bundles
}

/**
 * The workspace's AGENTS.md and the person's own are each offered over the
 * chat what they still need: a CLAUDE.md moved in, a tidy-up once long. An
 * answer is remembered so it is not raised again. `getChat` is resolved only
 * once an offer actually changes, well after the chat view exists.
 */
function createAgentsMdOffers(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  output: vscode.OutputChannel,
  getChat: () => ChatViewProvider,
): AgentsMdOffers {
  const answered = (scope: BundleScope) => (scope === 'project' ? context.workspaceState : context.globalState)
  const answeredKey = (kind: OfferKind) => `agentsMd.${kind}Settled`
  const agentsMd = new AgentsMdOffers(
    {
      pendingMove: (scope) => pendingMove(scope, workspaceRoot, homedir()),
      readAgentsMd: async (scope) => {
        const path = bundleFilePath(scope, workspaceRoot, homedir())
        return { path, text: await readOptional(path) }
      },
      settled: (scope, kind) => answered(scope).get(answeredKey(kind), false),
      settle: async (scope, kind) => await answered(scope).update(answeredKey(kind), true),
      applyMove: async (move) => {
        await applyMove(move)
        output.appendLine(`CLAUDE.md: moved ${move.claudePath} into ${move.agentsPath}`)
      },
    },
    () => getChat().refresh(),
  )
  agentsMd
    .load(vscode.workspace.workspaceFolders?.length ? ['project', 'user'] : ['user'])
    .catch((error: unknown) => output.appendLine(`AGENTS.md offers: ${errorMessage(error)}`))
  return agentsMd
}

function createSettings(
  context: vscode.ExtensionContext,
  memoryPort: MemoryPort,
  bundlesPort: BundlePort,
  remoteControlPort: RemoteControlPort,
  personRules: PersonRulesStore,
): SettingsStore {
  return new SettingsStore(
    configPort(),
    {
      has: async (name) => (await context.secrets.get(secretKey(name))) !== undefined,
      store: (name, value) => Promise.resolve(context.secrets.store(secretKey(name), value)),
      move: async (from, to) => {
        const value = await context.secrets.get(secretKey(from))
        if (value === undefined) return
        await context.secrets.store(secretKey(to), value)
        await context.secrets.delete(secretKey(from))
      },
      delete: (name) => Promise.resolve(context.secrets.delete(secretKey(name))),
    },
    memoryPort,
    bundlesPort,
    remoteControlPort,
    personRules,
  )
}

/**
 * The newer Claude models, put to the person once: the settings page keeps the
 * same offer until it is taken or turned down, so this is the nudge for someone
 * who would otherwise never open that page. Remembered for the person rather
 * than the workspace, since the models it would change are their own settings.
 * An install made after the host came up is noticed at the next start.
 */
function offerNewerModels(context: vscode.ExtensionContext, settings: SettingsStore, output: vscode.OutputChannel): void {
  const shown = 'modelUpgrade.notified'
  void (async () => {
    try {
      const upgrade = (await settings.snapshot()).modelUpgrade
      if (!upgrade || context.globalState.get(shown, false)) return
      await context.globalState.update(shown, true)
      const moves = upgrade.moves.map((m) => `${m.from} → ${m.to}`).join(', ')
      const choice = await vscode.window.showInformationMessage(
        `Kiwipow Agent: the Claude Code installed on this machine runs newer models (${moves}). Use them for your profiles?`,
        'Use them',
        'Not now',
      )
      if (choice === 'Use them') await settings.upgradeModels()
    } catch (error: unknown) {
      output.appendLine(`newer models: ${errorMessage(error)}`)
    }
  })()
}

function createSettingsPanel(context: vscode.ExtensionContext, settings: SettingsStore, workspaceRoot: string): SettingsPanel {
  return new SettingsPanel(
    context.extensionUri,
    settings,
    async ({ name, baseUrl, apiKeyValue }) => {
      if (!baseUrl) return []
      const apiKey = apiKeyValue || (await context.secrets.get(secretKey(name)))
      if (!apiKey) throw new Error(`No API key typed or stored for "${name}".`)
      return new OpenAiClient({ baseUrl, apiKey }).listModels()
    },
    (scope, file) => memoryPath(scope, file, workspaceRoot),
  )
}

function createChat(
  context: vscode.ExtensionContext,
  sessions: SessionManager,
  settings: SettingsStore,
  verifier: Verifier,
  sizeLimits: SizeLimits,
  allowWritesControl: SessionSwitch,
  permissionStore: PermissionStore,
  workspaceRoot: string,
  agentsMd: AgentsMdOffers,
  remoteControl: RemoteControlService,
  output: vscode.OutputChannel,
  ask: (prompt: string) => Promise<string>,
): ChatViewProvider {
  const provider = new ChatViewProvider(
    context.extensionUri,
    sessions,
    profileFor,
    {
      read: () => settings.profileDefaults(),
      set: (name) => settings.save('activeProfile', name),
    },
    registeredModels,
    verifier,
    sizeLimits,
    allowWritesControl,
    permissionStore,
    workspaceRoot,
    agentsMd,
    remoteAlertPort(remoteControl),
    pushDefault,
    ask,
  )
  // The only way in from the phone: a command reaches the chat the same way a desk act would.
  remoteControl.onCommand((command) => {
    provider.handleRemoteCommand(command).catch((error: unknown) => output.appendLine(`remote control: ${errorMessage(error)}`))
  })
  return provider
}

function createSessionsTree(sessions: SessionManager, workspaceRoot: string, chat: ChatViewProvider): SessionsTree {
  return new SessionsTree(
    sessions,
    workspaceRoot,
    (id) => chat.isOpen(id),
    (id) => chat.statusOf(id),
  )
}

/** Every command and watcher the extension offers, and the panel serializers that let a reload pick its tabs up again. */
function registerSubscriptions(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  chat: ChatViewProvider,
  tree: SessionsTree,
  sessions: SessionManager,
  settingsPanel: SettingsPanel,
  mcp: McpServerSet,
  workspaceRoot: string,
  planIgnore: () => string[],
): void {
  context.subscriptions.push(
    output,
    vscode.window.registerWebviewPanelSerializer(CHAT_PANEL_TYPE, {
      deserializeWebviewPanel: async (panel, state: { tabId?: string } | undefined) => chat.restore(panel, state),
    }),
    vscode.window.registerTreeDataProvider('kiwiAgent.sessions', tree),
    chat.onDidChange(() => tree.refresh()),
    vscode.commands.registerCommand('kiwiAgent.newSession', () => chat.showNewSession()),
    // Always a tab of its own: reusing one would hide a session that is still at work.
    vscode.commands.registerCommand('kiwiAgent.openChat', () => chat.showNewSession()),
    vscode.commands.registerCommand('kiwiAgent.openSession', (id: string) => chat.open(id)),
    vscode.commands.registerCommand('kiwiAgent.resumePlan', (feature: string) =>
      chat.resumePlan(feature).catch((error: unknown) => {
        void vscode.window.showErrorMessage(`Kiwipow Agent: ${errorMessage(error)}`)
      }),
    ),
    vscode.commands.registerCommand('kiwiAgent.removeSession', async (node: SessionNode) => {
      const record = recordOf(node)
      if (!record) return
      // A plan entry stands for its feature: removing only its newest plan session would bring an older one up in its place.
      const ids = record.mode === 'plan' ? sessions.list().filter((r) => r.feature === record.feature).map((r) => r.id) : [record.id]
      for (const id of ids) await chat.remove(id)
    }),
    vscode.commands.registerCommand('kiwiAgent.stopSession', (node: SessionNode) => {
      const record = recordOf(node)
      return record ? chat.close(record.id) : undefined
    }),
    watchSpecs(workspaceRoot, () => tree.refresh()),
    specDecorations(workspaceRoot),
    planDraftAction(chat, workspaceRoot),
    vscode.commands.registerCommand('kiwiAgent.openSettings', () => settingsPanel.open()),
    // The new-session pickers show the profiles as settings hold them, from the page or from settings.json.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('kiwiAgent.profiles') || e.affectsConfiguration('kiwiAgent.activeProfile') || e.affectsConfiguration('kiwiAgent.planProfile')) chat.refresh()
    }),
    vscode.window.registerWebviewPanelSerializer(SETTINGS_PANEL_TYPE, {
      deserializeWebviewPanel: async (panel) => settingsPanel.adopt(panel),
    }),
    vscode.commands.registerCommand('kiwiAgent.migratePlans', () => chat.migratePlans()),
    vscode.commands.registerCommand('kiwiAgent.buildRepoMap', () => chat.buildRepoMap()),
    vscode.commands.registerCommand('kiwiAgent.buildDocsMap', () => chat.buildDocsMapCommand(planIgnore())),
    watchMcpConfig(workspaceRoot, () => mcp.refresh()),
    openDraftPlanAction(chat, workspaceRoot, output),
    watchOwnBundle(context),
  )
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Kiwipow Agent')
  // Without a folder open the engine still needs a working directory that exists.
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath
  mkdirSync(workspaceRoot, { recursive: true })
  runStartupMigrations(workspaceRoot, output)

  const store = createSessionStore(context)
  const verifier = createVerifier()
  const sizeLimits = createSizeLimits()

  const policies = new Map<string, PermissionPolicy>()
  // Forward-referenced by the closures below, which only run well after all three are built.
  let chat: ChatViewProvider
  let engines: SessionEngines
  let sessions: SessionManager
  const allowWritesControl = createAllowWritesControl(() => sessions, output)
  const projectCommands = createProjectCommands(workspaceRoot, verifier)
  const personRules = createPersonRulesStore()
  const policyFor = createPolicyFor(workspaceRoot, context, () => sessions, () => engines, projectCommands, allowWritesControl, policies, personRules)
  /** Docs the blind planner must not see, so neither the map nor the evaluation may describe them. */
  const planIgnore = (): string[] => vscode.workspace.getConfiguration('kiwiAgent').get<string[]>('planIgnore', [])

  const mcp = createMcp(workspaceRoot, () => sessions, output)
  engines = createEngines({ context, output, workspaceRoot, mcp, verifier, policyFor, planIgnore, getChat: () => chat, getSessions: () => sessions })
  sessions = createSessions(store, engines, workspaceRoot, policyFor, () => chat)
  const permissionStore = createPermissionStore(() => sessions, personRules)
  const memoryPort = createMemoryPort(workspaceRoot)
  const bundles = createBundles(output, workspaceRoot)
  const agentsMd = createAgentsMdOffers(context, workspaceRoot, output, () => chat)
  const remoteControl = createRemoteControl(context, output)
  const settings = createSettings(context, memoryPort, bundles.port, remoteControlPort(remoteControl), personRules)
  const settingsPanel = createSettingsPanel(context, settings, workspaceRoot)
  offerNewerModels(context, settings, output)
  // Naming a feature runs on what its planning would, so the one ask follows the profile rather than a model of its own.
  const ask = (prompt: string) => engines.ask(profileFor('plan'), prompt)
  chat = createChat(context, sessions, settings, verifier, sizeLimits, allowWritesControl, permissionStore, workspaceRoot, agentsMd, remoteControl, output, ask)
  const tree = createSessionsTree(sessions, workspaceRoot, chat)

  registerSubscriptions(context, output, chat, tree, sessions, settingsPanel, mcp, workspaceRoot, planIgnore)
  syncRemoteControlConnection(remoteControl)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('kiwiAgent.remoteControl.enabled') || e.affectsConfiguration('kiwiAgent.remoteControl.serviceUrl')) {
        syncRemoteControlConnection(remoteControl)
      }
    }),
  )
  stopSessions = () => sessions.disposeAll()
  disconnectRemoteControl = () => remoteControl.disconnect()
  // A build the last window cut off mid-turn carries on without a prompt.
  chat.resumeCutOffBuilds().catch((error: unknown) => output.appendLine(`resuming cut-off builds failed: ${errorMessage(error)}`))
}

/** What deactivation waits on: the engines stopping, and which turns that cut off, saved for the next window. */
let stopSessions: (() => Promise<void>) | undefined
/** The one link out to the forwarding service, closed so nothing keeps calling out after the window goes. */
let disconnectRemoteControl: (() => void) | undefined

export function deactivate(): Promise<void> | undefined {
  disconnectRemoteControl?.()
  return stopSessions?.()
}

/** A save of the workspace's `.mcp.json` reaches the running sessions; so does deleting it. */
function watchMcpConfig(workspaceRoot: string, onChange: () => Promise<void>): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, MCP_CONFIG_FILE))
  const changed = () => void onChange()
  return vscode.Disposable.from(watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed))
}

/** The Sessions view lists the specs on disk, so a spec written, approved or deleted outside a session shows there too. */
function watchSpecs(workspaceRoot: string, onChange: () => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, SPECS_ANY_GLOB))
  return vscode.Disposable.from(watcher, watcher.onDidCreate(onChange), watcher.onDidChange(onChange), watcher.onDidDelete(onChange))
}
