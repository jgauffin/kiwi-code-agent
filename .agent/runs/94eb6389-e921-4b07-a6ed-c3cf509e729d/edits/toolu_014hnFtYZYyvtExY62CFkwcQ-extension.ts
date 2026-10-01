import * as vscode from 'vscode'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { SessionManager, type SessionRecord, type SessionStore } from './agent/session/session-manager'
import { recordOf, SessionsTree, type SessionNode } from './chat/sessions-tree'
import { providerModel, resolveStep, type ModelProfile, type Step } from './agent/session/model-profile'
import { RunLog } from './agent/runs/run-log'
import { OpenAiClient } from './agent/openai-session/openai-client'
import { MCP_CONFIG_FILE, readMcpConfig } from './agent/mcp/mcp-config'
import { migrateClaudeMcpServers } from './agent/mcp/migrate-claude-mcp'
import { McpServerSet } from './agent/mcp/mcp-servers'
import { runShell } from './agent/shell/run-shell'
import { packageScripts } from './agent/permissions/package-scripts'
import { PermissionPolicy, type PermissionRules } from './agent/permissions/permission-policy'
import type { ProjectCommands } from './agent/permissions/project-commands'
import { readOnlyTools } from './agent/permissions/tool-classes'
import { SPECS_DIR } from './agent/phases/blind-plan'
import { sweepPlans } from './agent/phases/plan-housekeeping'
import { ensureAgentDirIgnored } from './agent/agent-dir-ignore'
import { KIWI_DIR, migrateLayout } from './agent/kiwi-dir'
import { scratchDir } from './agent/scratch/scratch-folder'
import type { VerifyRule } from './agent/phases/verification'
import { CHAT_PANEL_TYPE, ChatViewProvider, type PermissionStore } from './chat/chat-view-provider'
import type { SessionSwitch, SizeLimits, Verifier } from './chat/feature-runs'
import { openDraftPlanAction } from './chat/open-draft-plan'
import { watchOwnBundle } from './dev-reload'
import { SessionEngines } from './session-engines'
import { forgetMemory, listMemories, memoryPath } from './agent/memory/memories'
import { appliedBundles, applyBundle, appliedBundleText, matchingBundles, removeBundle, workspaceSignals, type BundleScope } from './agent/instructions/bundles'
import { applyMove, moveOfferDue, pendingMove } from './agent/instructions/claude-md-move'
import {
  applyRequiredBundles,
  bundleSources,
  bundleUpdates,
  fetchableSources,
  fetchSource,
  fileSourceCache,
  gitPort,
  hashBundleText,
  pendingSources,
  type HandEditCheck,
} from './agent/instructions/bundle-sources'
import { SETTINGS_PANEL_TYPE, SettingsPanel } from './settings/settings-panel'
import { SettingsStore, readCleanupLimits, readModelSettings, secretKey, type BundlePort, type ConfigPort, type MemoryPort } from './settings/settings-store'

/** The `kiwiAgent` section as the settings store and the session factory both read it. */
function configPort(): ConfigPort {
  return {
    get: (key, fallback) => vscode.workspace.getConfiguration('kiwiAgent').get(key, fallback),
    update: (key, value, target) =>
      Promise.resolve(
        vscode.workspace
          .getConfiguration('kiwiAgent')
          .update(key, value, target === 'user' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace),
      ),
    hasWorkspace: () => (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Kiwipow Agent')
  // Without a folder open the engine still needs a working directory that exists.
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath
  mkdirSync(workspaceRoot, { recursive: true })
  // The housekeeping reads the current layout, so an older one is moved first.
  const migrated = migrateLayout(workspaceRoot, homedir()).then(
    (report) => {
      for (const move of report.moved) output.appendLine(`layout: moved ${move.from} to ${move.to}`)
      for (const path of report.blocked) output.appendLine(`layout: left ${path}, its new place already holds one of that name`)
    },
    (error: unknown) => output.appendLine(`layout migration failed: ${error instanceof Error ? error.message : String(error)}`),
  )
  void migrated.then(() => ensureAgentDirIgnored(workspaceRoot)).then(
    (result) => {
      if (result === 'added') output.appendLine(`added ${KIWI_DIR}/ to .gitignore`)
    },
    (error: unknown) => output.appendLine(`could not add ${KIWI_DIR}/ to .gitignore: ${error instanceof Error ? error.message : String(error)}`),
  )
  void migrated.then(() => sweepPlans(workspaceRoot, new Date())).then(
    (report) => {
      for (const path of report.converted) output.appendLine(`plan housekeeping: converted ${path} to JSON`)
      for (const path of report.moved) output.appendLine(`plan housekeeping: moved ${path} to the working files`)
      for (const path of report.blocked) output.appendLine(`plan housekeeping: left ${path}, the working files already hold one of that name`)
      for (const path of report.implemented) output.appendLine(`plan housekeeping: marked ${path} implemented`)
      for (const path of report.removed) output.appendLine(`plan housekeeping: removed ${path}`)
    },
    (error: unknown) => output.appendLine(`plan housekeeping failed: ${error instanceof Error ? error.message : String(error)}`),
  )

  const store: SessionStore = {
    list: () => context.workspaceState.get<SessionRecord[]>('sessions', []),
    save: (records) => Promise.resolve(context.workspaceState.update('sessions', records)),
  }

  /** The test run once a feature's board is all tested: the `kiwiAgent.verify` rules, read when the run starts. */
  const verifier: Verifier = {
    rules: () => vscode.workspace.getConfiguration('kiwiAgent').get<VerifyRule[]>('verify', []),
    failureBudget: () => vscode.workspace.getConfiguration('kiwiAgent').get<number>('verifyFailureBudget', 3),
    retrySeconds: () => vscode.workspace.getConfiguration('kiwiAgent').get<number>('verifyRetrySeconds', 30),
    run: async (command, dir) => {
      const result = await runShell(command, { cwd: dir, timeoutMs: 600_000 })
      return { ok: result.ended === 'exit' && result.exitCode === 0, output: result.output }
    },
  }

  /** The cleanup after a feature's tests pass: the `kiwiAgent.cleanup` limits, read when the sizes are measured. */
  const sizeLimits: SizeLimits = {
    limits: () => readCleanupLimits(configPort()),
    ignore: () => vscode.workspace.getConfiguration('kiwiAgent').get<string[]>('cleanup.ignore', []),
  }

  // Kept on the session record, so the switch survives a reload and a new thread; the record changes at once, the save follows.
  const allowWritesControl: SessionSwitch = {
    isEnabled: (id) => sessions.get(id)?.allowWrites ?? false,
    setEnabled: (id, enabled) =>
      void sessions.setAllowWrites(id, enabled).catch((error: unknown) => output.appendLine(`could not save Allow writes: ${error instanceof Error ? error.message : String(error)}`)),
  }

  /** The commands the user has already defined for this project: they run without a prompt. */
  const projectCommands = (): ProjectCommands => ({ scripts: packageScripts(workspaceRoot), verify: verifier.rules().map((rule) => rule.command) })
  /** Per session, the rules in force: the project's plus the session's own. */
  const policies = new Map<string, PermissionPolicy>()
  const policyFor = (sessionId: string): PermissionPolicy => {
    const existing = policies.get(sessionId)
    if (existing) return existing
    const policy = new PermissionPolicy(
      workspaceRoot,
      () => {
        const rules = permissionRules()
        return { ...rules, allow: [...rules.allow, ...(sessions.get(sessionId)?.allowed ?? [])] }
      },
      {
        readOnly: readOnlyTools(() => engines.toolsOf(sessionId)),
        project: projectCommands,
        writesAllowed: () => allowWritesControl.isEnabled(sessionId),
        scratch: scratchDir(sessionId),
      },
    )
    policies.set(sessionId, policy)
    return policy
  }

  /** Docs the blind planner must not see, so neither the map nor the evaluation may describe them. */
  const planIgnore = (): string[] => vscode.workspace.getConfiguration('kiwiAgent').get<string[]>('planIgnore', [])

  // Claude Code's user-wide servers into `~/.mcp.json`, once. Every read waits for it, so the first one already sees them.
  const mcpMigration = migrateClaudeMcpServers().then(
    (names) => {
      if (names.length > 0) output.appendLine(`moved ${names.join(', ')} from Claude Code's settings to ~/${MCP_CONFIG_FILE}`)
    },
    (error: unknown) => output.appendLine(`could not read Claude Code's MCP servers: ${error instanceof Error ? error.message : String(error)}`),
  )

  /** The user's and the workspace's `.mcp.json`, read once and again on every change; `sessions` is resolved when a session runs, after it exists. */
  const mcp: McpServerSet = new McpServerSet(
    async () => {
      await mcpMigration
      return readMcpConfig(workspaceRoot)
    },
    () => sessions.liveSessions(),
    (message) => void vscode.window.showWarningMessage(`Kiwipow Agent: ${message}`),
  )

  let chat: ChatViewProvider
  const engines: SessionEngines = new SessionEngines({
    context,
    output,
    config: configPort(),
    workspaceRoot,
    mcp,
    verifier,
    policyFor,
    planIgnore,
    buildDocsMap: (ignored, onProgress) => chat.buildDocsMap(ignored, onProgress),
    conversation: (id) => sessions.conversation(id),
  })
  const sessions: SessionManager = new SessionManager(
    store,
    (record, onProgress) => engines.create(record, onProgress),
    (id) => RunLog.forSession(workspaceRoot, id),
    (id, event) => chat.onSessionEvent(id, event),
    // The edit diff and the command lines are added once, before the event is logged, so a reload shows the same thing.
    async (id, event) => policyFor(id).decorate((await engines.recorderOf(id)?.decorate(event)) ?? event),
  )
  const permissionStore: PermissionStore = {
    allowForProject: async (rules) => {
      const config = vscode.workspace.getConfiguration('kiwiAgent')
      const current = permissionRules().allow
      const merged = [...current, ...rules.filter((r) => !current.includes(r))]
      await config.update('permissions.allow', merged, vscode.ConfigurationTarget.Workspace)
    },
    allowForSession: (sessionId, rules) => sessions.allowForSession(sessionId, rules),
  }
  const memoryPort: MemoryPort = {
    list: () => listMemories(workspaceRoot),
    forget: (scope, title) => forgetMemory(scope, title, workspaceRoot),
  }
  /** `kiwiAgent` keys naming bundle sources and remembering the person's answers about them; read fresh each time, written back under the same key. */
  const bundleConfig = () => vscode.workspace.getConfiguration('kiwiAgent')
  const namedBundleSources = (): string[] => bundleSources(bundleConfig().get<string[]>('bundleSources', []), bundleConfig().get<string[]>('projectBundleSources', []))
  const acceptedBundleSources = (): string[] => bundleConfig().get<string[]>('bundleSources.accepted', [])
  const bundleHashes = (): Record<string, string> => bundleConfig().get<Record<string, string>>('bundleHashes', {})
  const hashKey = (scope: BundleScope, source: string, name: string): string => `${scope}|${source}|${name}`
  const sourceCache = fileSourceCache(homedir())
  const fetchAllSources = () => Promise.all(fetchableSources(namedBundleSources(), new Set(acceptedBundleSources())).map((source) => fetchSource(source, gitPort, sourceCache)))
  /** A bundle's block was last written with this text; kept per workspace so a later hand edit can be told from an update before it replaces it. */
  const recordBundleHash = async (scope: BundleScope, source: string, name: string, hash: string): Promise<void> => {
    if (!vscode.workspace.workspaceFolders?.length) return
    await bundleConfig().update('bundleHashes', { ...bundleHashes(), [hashKey(scope, source, name)]: hash }, vscode.ConfigurationTarget.Workspace)
  }
  const clearBundleHash = async (scope: BundleScope, source: string, name: string): Promise<void> => {
    if (!vscode.workspace.workspaceFolders?.length) return
    const rest = { ...bundleHashes() }
    delete rest[hashKey(scope, source, name)]
    await bundleConfig().update('bundleHashes', rest, vscode.ConfigurationTarget.Workspace)
  }
  const bundlePort: BundlePort = {
    available: async () => (await fetchAllSources()).flatMap((source) => source.bundles),
    matching: async () => matchingBundles(await bundlePort.available(), await workspaceSignals(workspaceRoot)),
    applied: () => appliedBundles(workspaceRoot),
    apply: async (scope, bundle) => {
      await applyBundle(scope, bundle, workspaceRoot)
      await recordBundleHash(scope, bundle.source, bundle.name, hashBundleText(bundle.text))
    },
    remove: async (scope, source, name) => {
      await removeBundle(scope, source, name, workspaceRoot)
      await clearBundleHash(scope, source, name)
    },
  }
  // A source newly named is offered for acceptance, a source's required bundles are kept applied, and a newer version already fetched is put to the person — all once per activation, and only with a real project open.
  if (vscode.workspace.workspaceFolders?.length) {
    void (async () => {
      for (const repo of pendingSources(namedBundleSources(), new Set(acceptedBundleSources()))) {
        const choice = await vscode.window.showInformationMessage(`Kiwipow Agent: accept "${repo}" as a bundle source?`, 'Accept', 'Not now')
        if (choice === 'Accept') await bundleConfig().update('bundleSources.accepted', [...acceptedBundleSources(), repo], vscode.ConfigurationTarget.Global)
      }
      const fetched = await fetchAllSources()
      const newlyRequired = await applyRequiredBundles(fetched, await appliedBundles(workspaceRoot), workspaceRoot)
      for (const bundle of newlyRequired) {
        const text = await appliedBundleText(bundle.scope, bundle.source, bundle.name, workspaceRoot)
        if (text !== undefined) await recordBundleHash(bundle.scope, bundle.source, bundle.name, hashBundleText(text))
      }
      if (newlyRequired.length > 0) {
        output.appendLine(`bundles: applied ${newlyRequired.length} required bundle${newlyRequired.length === 1 ? '' : 's'} (${newlyRequired.map((b) => b.name).join(', ')})`)
      }
      const applied = await appliedBundles(workspaceRoot)
      const checks: HandEditCheck[] = await Promise.all(
        applied.map(async (a) => ({
          scope: a.scope,
          source: a.source,
          name: a.name,
          writtenHash: bundleHashes()[hashKey(a.scope, a.source, a.name)],
          currentText: await appliedBundleText(a.scope, a.source, a.name, workspaceRoot),
        })),
      )
      const dismissed = new Map(Object.entries(bundleConfig().get<Record<string, string>>('bundleUpdatesDismissed', {})))
      for (const update of bundleUpdates(fetched, applied, checks, dismissed)) {
        const editedNote = update.handEdited ? ' Its block was edited by hand since it was applied.' : ''
        const choice = await vscode.window.showInformationMessage(
          `Kiwipow Agent: "${update.name}" has a newer version (${update.from} \u2192 ${update.to}).${editedNote}`,
          'Update',
          'Keep this version',
        )
        if (choice === 'Update') {
          const candidate = fetched.find((source) => source.source === update.source)?.bundles.find((b) => b.name === update.name)
          if (candidate) await bundlePort.apply(update.scope, candidate)
        } else if (choice === 'Keep this version') {
          const dismissedMap = bundleConfig().get<Record<string, string>>('bundleUpdatesDismissed', {})
          await bundleConfig().update(
            'bundleUpdatesDismissed',
            { ...dismissedMap, [hashKey(update.scope, update.source, update.name)]: update.to },
            vscode.ConfigurationTarget.Workspace,
          )
        }
      }
    })().catch((error: unknown) => output.appendLine(`bundle sources: ${error instanceof Error ? error.message : String(error)}`))
  }
  // The workspace's own CLAUDE.md, and the person's own, are each offered once to move into AGENTS.md; a decline is remembered so it is not raised again.
  void (async () => {
    const offers: { scope: BundleScope; label: string; dismissedKey: string; target: vscode.ConfigurationTarget }[] = [
      ...(vscode.workspace.workspaceFolders?.length
        ? [{ scope: 'project' as const, label: "This workspace's", dismissedKey: 'claudeMdMoveDismissed', target: vscode.ConfigurationTarget.Workspace }]
        : []),
      { scope: 'user' as const, label: 'Your own', dismissedKey: 'claudeMdMoveDismissedUser', target: vscode.ConfigurationTarget.Global },
    ]
    for (const { scope, label, dismissedKey, target } of offers) {
      const move = await pendingMove(scope, workspaceRoot, homedir())
      if (!moveOfferDue(move, bundleConfig().get(dismissedKey, false))) continue
      const preview = move.mergedText.length > 1200 ? `${move.mergedText.slice(0, 1200)}\u2026` : move.mergedText
      const choice = await vscode.window.showInformationMessage(
        `Kiwipow Agent: ${label} CLAUDE.md still holds its rules. Move them into AGENTS.md, where both engines already read them?`,
        { modal: true, detail: `AGENTS.md will read:\n\n${preview}\n\nCLAUDE.md is removed once you confirm.` },
        'Move',
        'Not now',
      )
      if (choice === 'Move') {
        await applyMove(move)
        output.appendLine(`CLAUDE.md: moved ${label.toLowerCase()} rules into ${move.agentsPath}`)
      } else if (choice === 'Not now') {
        await bundleConfig().update(dismissedKey, true, target)
      }
    }
  })().catch((error: unknown) => output.appendLine(`CLAUDE.md move: ${error instanceof Error ? error.message : String(error)}`))
  const settings = new SettingsStore(
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
    bundlePort,
  )
  const settingsPanel = new SettingsPanel(
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
  chat = new ChatViewProvider(
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
  )
  const tree = new SessionsTree(
    sessions,
    workspaceRoot,
    (id) => chat.isOpen(id),
    (id) => chat.statusOf(id),
  )

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
        void vscode.window.showErrorMessage(`Kiwipow Agent: ${error instanceof Error ? error.message : String(error)}`)
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
    openDraftPlanAction(chat, sessions, workspaceRoot, output),
    watchOwnBundle(context),
  )
  stopSessions = () => sessions.disposeAll()
  // A build the last window cut off mid-turn carries on without a prompt.
  chat.resumeCutOffBuilds().catch((error: unknown) => output.appendLine(`resuming cut-off builds failed: ${error instanceof Error ? error.message : String(error)}`))
}

/** What deactivation waits on: the engines stopping, and which turns that cut off, saved for the next window. */
let stopSessions: (() => Promise<void>) | undefined

export function deactivate(): Promise<void> | undefined {
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
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, `${SPECS_DIR}/*.spec.md`))
  return vscode.Disposable.from(watcher, watcher.onDidCreate(onChange), watcher.onDidChange(onChange), watcher.onDidDelete(onChange))
}

/** What a step runs on: the active profile's model for it, resolved against the providers it names. `attempt` counts the fixes of a failed test run. */
function profileFor(step: Step, attempt?: number): ModelProfile {
  const { providers, profiles, activeProfile } = readModelSettings(configPort())
  const profile = profiles.find((p) => p.name === activeProfile) ?? profiles[0]
  if (!profile) throw new Error('No model profiles configured (kiwiAgent.profiles)')
  if (activeProfile && profile.name !== activeProfile) {
    void vscode.window.showWarningMessage(`Kiwipow Agent: profile "${activeProfile}" not found, using "${profile.name}".`)
  }
  return resolveStep(profile, providers, step, attempt)
}

/** Every model the providers serve, as the chat picker offers them. */
function registeredModels(): ModelProfile[] {
  const { providers } = readModelSettings(configPort())
  return providers.flatMap((provider) => provider.models.map((model) => providerModel(provider, model)))
}

/** Read on every tool call, so a rule just written applies at once. */
function permissionRules(): PermissionRules {
  const config = vscode.workspace.getConfiguration('kiwiAgent')
  return {
    allow: config.get<string[]>('permissions.allow', []),
    deny: config.get<string[]>('permissions.deny', []),
    denyGitWrites: config.get('permissions.denyGitWrites', false),
  }
}
