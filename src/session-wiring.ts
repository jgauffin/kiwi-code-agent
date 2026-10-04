import * as vscode from 'vscode'
import { SessionManager, type SessionRecord, type SessionStore } from './agent/session/session-manager'
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

/** Per session, the rules in force: the project's plus the session's own. `engines` and `sessions` are resolved when a policy is actually asked for, well after both exist. */
export function createPolicyFor(
  workspaceRoot: string,
  getSessions: () => SessionManager,
  getEngines: () => SessionEngines,
  projectCommands: () => ProjectCommands,
  allowWritesControl: SessionSwitch,
  policies: Map<string, PermissionPolicy>,
): (sessionId: string) => PermissionPolicy {
  return (sessionId) => {
    const existing = policies.get(sessionId)
    if (existing) return existing
    const policy = new PermissionPolicy(
      workspaceRoot,
      () => {
        const rules = permissionRules()
        return { ...rules, allow: [...rules.allow, ...(getSessions().get(sessionId)?.allowed ?? [])] }
      },
      {
        readOnly: readOnlyTools(() => getEngines().toolsOf(sessionId)),
        project: projectCommands,
        writesAllowed: () => allowWritesControl.isEnabled(sessionId),
        scratch: scratchDir(sessionId),
      },
    )
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
  })
}

/** `getChat` is resolved only once a session event or tool call actually happens, well after the chat view exists. */
export function createSessions(
  store: SessionStore,
  engines: SessionEngines,
  workspaceRoot: string,
  policyFor: (sessionId: string) => PermissionPolicy,
  getChat: () => ChatViewProvider,
): SessionManager {
  return new SessionManager(
    store,
    (record, onProgress) => engines.create(record, onProgress),
    (id) => RunLog.forSession(workspaceRoot, id),
    (id, event) => getChat().onSessionEvent(id, event),
    // The edit diff and the command lines are added once, before the event is logged, so a reload shows the same thing.
    async (id, event) => policyFor(id).decorate((await engines.recorderOf(id)?.decorate(event)) ?? event),
    async (id, call) => {
      const outcome = await policyFor(id).preToolUse(call)
      return outcome !== undefined && 'allow' in outcome && outcome.allow === true
    },
  )
}

export function createPermissionStore(getSessions: () => SessionManager): PermissionStore {
  return {
    allowForProject: async (rules) => {
      const config = vscode.workspace.getConfiguration('kiwiAgent')
      const current = permissionRules().allow
      const merged = [...current, ...rules.filter((r) => !current.includes(r))]
      await config.update('permissions.allow', merged, vscode.ConfigurationTarget.Workspace)
    },
    allowForSession: (sessionId, rules) => getSessions().allowForSession(sessionId, rules),
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

/** Read on every tool call, so a rule just written applies at once. */
export function permissionRules(): PermissionRules {
  const config = vscode.workspace.getConfiguration('kiwiAgent')
  return {
    allow: config.get<string[]>('permissions.allow', []),
    deny: config.get<string[]>('permissions.deny', []),
    denyGitWrites: config.get('permissions.denyGitWrites', false),
  }
}
