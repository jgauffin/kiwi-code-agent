import * as vscode from 'vscode'
import { SessionManager, type SessionListener, type SessionRecord, type SessionStore } from './agent/session/session-manager'
import type { AgentExchange } from './cross-window/agent-exchange'
import { offeredModels, resolveStep, type ModelOffer, type ModelProfile, type Step } from './agent/session/model-profile'
import { RunLog } from './agent/runs/run-log'
import { MCP_CONFIG_FILE, readMcpConfig } from './agent/mcp/mcp-config'
import { migrateClaudeMcpServers } from './agent/mcp/migrate-claude-mcp'
import { McpServerSet } from './agent/mcp/mcp-servers'
import { runShell } from './agent/shell/run-shell'
import { packageScripts } from './agent/permissions/package-scripts'
import { PermissionPolicy, type PermissionRules } from './agent/permissions/permission-policy'
import type { ProjectCommands } from './agent/permissions/project-commands'
import { readOnlyTools } from './agent/permissions/tool-classes'
import { isWithin, normalizePlace } from './agent/permissions/places'
import { instructionPlaces } from './agent/permissions/instruction-places'
import { projectMemoryDir, userMemoryFile } from './agent/memory/memories'
import { ClaudeRulesFile, existsAt, oldRulesAsGrants, PersonGrantsStore, personGrantsFile, readGrantList, withGrants } from './agent/permissions/grant-stores'
import { parseGrant, type Grant, type GrantScope, type KeptGrant } from './agent/permissions/grants'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { shippedPluginDir, skillsMirrorDir } from './extension-paths'
import { scratchDir } from './agent/scratch/scratch-folder'
import type { VerifyRule } from './agent/phases/verification'
import type { ChatViewProvider, PermissionStore } from './chat/chat-view-provider'
import type { SessionSwitch, SizeLimits, Verifier } from './chat/feature-runs'
import { SessionEngines } from './session-engines'
import { readCleanupLimits, readModelSettings } from './settings/settings-store'
import { configPort } from './config-port'
import { errorMessage } from './error-message'

export function createSessionStore(context: vscode.ExtensionContext): SessionStore {
  return {
    list: () => context.workspaceState.get<SessionRecord[]>('sessions', []),
    save: (records) => Promise.resolve(context.workspaceState.update('sessions', records)),
  }
}

/** The test run once a feature's board is all tested: the `kiwiAgent.verify` rules, read when the run starts. */
export function createVerifier(): Verifier {
  return {
    rules: () => vscode.workspace.getConfiguration('kiwiAgent').get<VerifyRule[]>('verify', []),
    failureBudget: () => vscode.workspace.getConfiguration('kiwiAgent').get<number>('verifyFailureBudget', 3),
    retrySeconds: () => vscode.workspace.getConfiguration('kiwiAgent').get<number>('verifyRetrySeconds', 30),
    run: async (command, dir) => {
      const result = await runShell(command, { cwd: dir, timeoutMs: 600_000 })
      return { ok: result.ended === 'exit' && result.exitCode === 0, output: result.output }
    },
  }
}

/** The cleanup after a feature's tests pass: the `kiwiAgent.cleanup` limits, read when the sizes are measured. */
export function createSizeLimits(): SizeLimits {
  return {
    limits: () => readCleanupLimits(configPort()),
    ignore: () => vscode.workspace.getConfiguration('kiwiAgent').get<string[]>('cleanup.ignore', []),
  }
}

// Kept on the session record, so the switch survives a reload and a new thread; the record changes at once, the save follows.
export function createAllowWritesControl(getSessions: () => SessionManager, output: vscode.OutputChannel): SessionSwitch {
  return {
    isEnabled: (id) => getSessions().get(id)?.allowWrites ?? false,
    setEnabled: (id, enabled) =>
      void getSessions()
        .setAllowWrites(id, enabled)
        .catch((error: unknown) => output.appendLine(`could not save Allow writes: ${errorMessage(error)}`)),
  }
}

/** The commands the user has already defined for this project: they run without a prompt. */
export function createProjectCommands(workspaceRoot: string, verifier: Verifier): () => ProjectCommands {
  return () => ({
    scripts: packageScripts(workspaceRoot),
    verify: verifier.rules().flatMap((rule) => [rule.command, ...(rule.build?.trim() ? [rule.build] : [])]),
  })
}

/** Per session, the answers in force: the workspace's, the person's own and the session's own. `engines` and `sessions` are resolved when a policy is actually asked for, well after both exist. */
export function createPolicyFor(
  workspaceRoot: string,
  context: vscode.ExtensionContext,
  getSessions: () => SessionManager,
  getEngines: () => SessionEngines,
  projectCommands: () => ProjectCommands,
  allowWritesControl: SessionSwitch,
  policies: Map<string, PermissionPolicy>,
  grants: GrantSources,
): (sessionId: string) => PermissionPolicy {
  return (sessionId) => {
    const existing = policies.get(sessionId)
    if (existing) return existing
    const policy = new PermissionPolicy(workspaceRoot, () => permissionRules(grants, getSessions().get(sessionId), workspaceRoot), {
      readOnly: readOnlyTools(() => getEngines().toolsOf(sessionId)),
      project: projectCommands,
      writesAllowed: () => allowWritesControl.isEnabled(sessionId),
      scratch: scratchDir(sessionId),
      readable: instructionPlaces(workspaceRoot, [shippedPluginDir(context), skillsMirrorDir(context, sessionId)]),
      writable: [projectMemoryDir(workspaceRoot), userMemoryFile()],
      rulesFiles: [personGrantsFile(), claudeUserSettingsFile()],
    })
    policies.set(sessionId, policy)
    return policy
  }
}

/** The user's and the workspace's `.mcp.json`, read once and again on every change; `sessions` is resolved when a session runs, after it exists. */
export function createMcp(workspaceRoot: string, getSessions: () => SessionManager, output: vscode.OutputChannel): McpServerSet {
  // Claude Code's user-wide servers into `~/.mcp.json`, once. Every read waits for it, so the first one already sees them.
  const mcpMigration = migrateClaudeMcpServers().then(
    (names) => {
      if (names.length > 0) output.appendLine(`moved ${names.join(', ')} from Claude Code's settings to ~/${MCP_CONFIG_FILE}`)
    },
    (error: unknown) => output.appendLine(`could not read Claude Code's MCP servers: ${errorMessage(error)}`),
  )
  return new McpServerSet(
    async () => {
      await mcpMigration
      return readMcpConfig(workspaceRoot)
    },
    () => getSessions().liveSessions(),
    (message) => void vscode.window.showWarningMessage(`Kiwipow Agent: ${message}`),
  )
}

/** `getChat` and `getSessions` are resolved once the engines run a session, well after both are built. */
export function createEngines(params: {
  context: vscode.ExtensionContext
  output: vscode.OutputChannel
  workspaceRoot: string
  mcp: McpServerSet
  verifier: Verifier
  policyFor: (sessionId: string) => PermissionPolicy
  planIgnore: () => string[]
  getChat: () => ChatViewProvider
  getSessions: () => SessionManager
  getExchange: () => AgentExchange
}): SessionEngines {
  return new SessionEngines({
    context: params.context,
    output: params.output,
    config: configPort(),
    workspaceRoot: params.workspaceRoot,
    mcp: params.mcp,
    verifier: params.verifier,
    policyFor: params.policyFor,
    planIgnore: params.planIgnore,
    buildDocsMap: (ignored, onProgress) => params.getChat().buildDocsMap(ignored, onProgress),
    conversation: (id) => params.getSessions().conversation(id),
    exchange: params.getExchange,
  })
}

/** `getChat` is resolved only once a session event or tool call actually happens, well after the chat view exists. */
export function createSessions(
  store: SessionStore,
  engines: SessionEngines,
  workspaceRoot: string,
  policyFor: (sessionId: string) => PermissionPolicy,
  getChat: () => ChatViewProvider,
  /** Told of every event besides the chat, for what follows a session's turns from outside it. */
  observe: SessionListener,
): SessionManager {
  return new SessionManager(
    store,
    (record, onProgress) => engines.create(record, onProgress),
    (id) => RunLog.forSession(workspaceRoot, id),
    (id, event) => {
      getChat().onSessionEvent(id, event)
      observe(id, event)
    },
    // The edit diff and the command lines are added once, before the event is logged, so a reload shows the same thing.
    async (id, event) => policyFor(id).decorate((await engines.recorderOf(id)?.decorate(event)) ?? event),
    async (id, call) => {
      const outcome = await policyFor(id).preToolUse(call)
      return outcome !== undefined && 'allow' in outcome && outcome.allow === true
    },
  )
}

/** The workspace's kept answers, read fresh so two writes in a row never lose one. */
function workspaceGrants(): Grant[] {
  return readGrantList(vscode.workspace.getConfiguration('kiwiAgent').get<unknown[]>('permissions.grants', []))
}

async function addWorkspaceGrants(grants: readonly Grant[]): Promise<void> {
  await vscode.workspace.getConfiguration('kiwiAgent').update('permissions.grants', withGrants(workspaceGrants(), grants), vscode.ConfigurationTarget.Workspace)
}

/**
 * Each kept answer goes where its scope lives. An answer from the prompt is
 * read again as a grant here, so one the prompt could not have offered (an
 * allow naming flags) is never kept.
 */
export function createPermissionStore(getSessions: () => SessionManager, grants: GrantSources, workspaceRoot: string): PermissionStore {
  const root = normalizePlace(workspaceRoot)
  return {
    keep: async (sessionId, kept) => {
      const valid = kept.flatMap((k) => {
        const grant = parseGrant(k)
        return grant ? [{ grant, scope: k.scope }] : []
      })
      const of = (scope: GrantScope) => valid.filter((k) => k.scope === scope).map((k) => k.grant)
      // A workspace's answer about a place outside it is a path on this machine: kept with the person's own, tied to this workspace.
      const inside = of('workspace').filter((g) => isWithin(root, g.place))
      const outside = of('workspace').filter((g) => !isWithin(root, g.place)).map((g): Grant => ({ ...g, workspace: root }))
      if (of('session').length) await getSessions().keepForSession(sessionId, of('session'))
      if (inside.length) await addWorkspaceGrants(inside)
      if (of('person').length || outside.length) await grants.person.add([...of('person'), ...outside])
    },
  }
}

/** What a step runs on: the active profile's model for it, resolved against the providers it names. `attempt` counts the fixes of a failed test run. */
export function profileFor(step: Step, attempt?: number): ModelProfile {
  const { providers, profiles, activeProfile } = readModelSettings(configPort())
  const profile = profiles.find((p) => p.name === activeProfile) ?? profiles[0]
  if (!profile) throw new Error('No model profiles configured (kiwiAgent.profiles)')
  if (activeProfile && profile.name !== activeProfile) {
    void vscode.window.showWarningMessage(`Kiwipow Agent: profile "${activeProfile}" not found, using "${profile.name}".`)
  }
  return resolveStep(profile, providers, step, attempt)
}

/** Every model the providers serve, as the chat picker offers them. */
export function registeredModels(): ModelOffer[] {
  return offeredModels(readModelSettings(configPort()).providers)
}

/**
 * Where kept answers come from besides the session's own: the person's file,
 * and the Claude engine's own settings, the workspace's and the person's,
 * read as grants of the scope each lives in.
 */
export type GrantSources = { person: PersonGrantsStore; claudeWorkspace: ClaudeRulesFile[]; claudePerson: ClaudeRulesFile }

export function createGrantSources(workspaceRoot: string, output: vscode.OutputChannel): GrantSources {
  const report = (error: unknown) => output.appendLine(`permissions: ${errorMessage(error)}`)
  const origin = { workspace: workspaceRoot, home: homedir(), exists: existsAt }
  return {
    person: new PersonGrantsStore(homedir(), report),
    claudeWorkspace: ['settings.json', 'settings.local.json'].map((name) => new ClaudeRulesFile(join(workspaceRoot, '.claude', name), origin, report)),
    claudePerson: new ClaudeRulesFile(claudeUserSettingsFile(), origin, report),
  }
}

function claudeUserSettingsFile(): string {
  return join(homedir(), '.claude', 'settings.json')
}

/** Read on every tool call, so an answer just kept applies at once: every scope's, each marked with the scope it lives in. */
export function permissionRules(sources: GrantSources, session: SessionRecord | undefined, workspaceRoot: string): PermissionRules {
  const config = vscode.workspace.getConfiguration('kiwiAgent')
  const scoped = (scope: GrantScope) => (list: readonly Grant[]) => list.map((grant): KeptGrant => ({ ...grant, scope }))
  const oldSession = oldRulesAsGrants(session?.allowed ?? [], session?.denied ?? [], { workspace: workspaceRoot, home: homedir(), exists: existsAt })
  return {
    grants: [
      ...scoped('workspace')([...workspaceGrants(), ...sources.claudeWorkspace.flatMap((file) => file.read())]),
      ...scoped('workspace')(sources.person.get().filter((g) => g.workspace !== undefined && samePlace(g.workspace, normalizePlace(workspaceRoot)))),
      ...scoped('person')([...sources.person.get().filter((g) => g.workspace === undefined), ...sources.claudePerson.read()]),
      ...scoped('session')([...(session?.grants ?? []), ...oldSession]),
    ],
    denyGitWrites: config.get('permissions.denyGitWrites', false),
  }
}

/**
 * Answers the workspace kept before grants existed become grants once, and
 * the old lists are cleared: a directory granted for reading or writing is
 * kept as that grant, a command prefix or a change of directory is dropped.
 */
export async function migrateWorkspaceRules(workspaceRoot: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('kiwiAgent')
  const allow = config.inspect<string[]>('permissions.allow')?.workspaceValue ?? []
  const deny = config.inspect<string[]>('permissions.deny')?.workspaceValue ?? []
  if (allow.length === 0 && deny.length === 0) return
  await addWorkspaceGrants(oldRulesAsGrants(allow, deny, { workspace: workspaceRoot, home: homedir(), exists: existsAt }))
  await config.update('permissions.allow', undefined, vscode.ConfigurationTarget.Workspace)
  await config.update('permissions.deny', undefined, vscode.ConfigurationTarget.Workspace)
}

const samePlace = (a: string, b: string): boolean => isWithin(a, b) && isWithin(b, a)
