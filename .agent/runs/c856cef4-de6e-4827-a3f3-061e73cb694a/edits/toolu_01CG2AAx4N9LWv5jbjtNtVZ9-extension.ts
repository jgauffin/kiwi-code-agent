import * as vscode from 'vscode'
import { mkdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { SessionManager, type SessionMode, type SessionRecord, type SessionStore } from './agent/session/session-manager'
import { recordOf, SessionsTree, type SessionNode } from './chat/sessions-tree'
import { providerModel, resolvePhase, resolveStep, type ModelProfile, type PhaseProfile } from './agent/session/model-profile'
import { choiceFor, chooseProfile, type FeaturePhaseChoices, type PhaseChoiceStore } from './agent/session/phase-choices'
import type { CodeSession } from './agent/session/code-session'
import { SdkSession } from './agent/sdk-session/sdk-session'
import { hostExecutableAsNode, type NodeRuntime } from './agent/sdk-session/node-runtime'
import { RunLog } from './agent/runs/run-log'
import { OpenAiSession } from './agent/openai-session/openai-session'
import { OpenAiClient } from './agent/openai-session/openai-client'
import { messagesFromEvents } from './agent/openai-session/history'
import { buildSystemPrompt } from './agent/openai-session/system-prompt'
import { readTool } from './agent/openai-session/tools/read'
import { writeTool } from './agent/openai-session/tools/write'
import { editTool } from './agent/openai-session/tools/edit'
import { runScriptTool } from './agent/openai-session/tools/run-script'
import { join } from 'node:path'
import { globTool } from './agent/openai-session/tools/glob'
import { grepTool } from './agent/openai-session/tools/grep'
import { bashTool } from './agent/openai-session/tools/bash'
import { askUserTool } from './agent/openai-session/tools/ask-user'
import { TaskBoardGuard, taskBoardTools } from './agent/openai-session/tools/task-board'
import { jsonQueryTool, jsonSchemaTool } from './agent/openai-session/tools/json'
import { skillTool } from './agent/openai-session/tools/skill'
import { copyTool, moveTool } from './agent/openai-session/tools/move-copy'
import { codeOutlineTool } from './agent/code-outline/code-outline-tool'
import { CODE_READING, CodeOutlineGate } from './agent/code-outline/code-outline-gate'
import { SCRIPT_WRITING, ScriptGate } from './agent/script/script-gate'
import { codeSearchTool } from './agent/code-outline/code-search'
import type { Tool } from './agent/openai-session/tools/tool'
import { indexSkills } from './agent/skills/skill-index'
import { MCP_CONFIG_FILE, readMcpConfig } from './agent/mcp/mcp-config'
import { connectMcp } from './agent/mcp/mcp-connect'
import { McpServerSet } from './agent/mcp/mcp-servers'
import { McpToolHost } from './agent/mcp/mcp-tool-host'
import { runShell } from './agent/shell/run-shell'
import { composeHooks, type SessionHooks } from './agent/session/hooks'
import { StaleWriteGuard } from './agent/session/stale-write-guard'
import { FileHands } from './agent/session/file-hands'
import { FileEditRecorder } from './agent/edits/file-edit-recorder'
import { packageScripts } from './agent/permissions/package-scripts'
import { PermissionPolicy, type PermissionRules } from './agent/permissions/permission-policy'
import type { ProjectCommands } from './agent/permissions/project-commands'
import { readOnlyTools } from './agent/permissions/tool-classes'
import { ScopeGuard, readableIn } from './agent/phases/scope-guard'
import { BLIND_PLAN_TOOLS, PLAN_DIR, blindPlanPrompt, blindPlanScope } from './agent/phases/blind-plan'
import { markdownSearchTool } from './agent/openai-session/tools/markdown-search'
import { DOC_READING, OutlineGate } from './agent/openai-session/tools/markdown/outline-gate'
import { RECONCILE_TOOLS, reconcilePrompt, reconcileScope } from './agent/phases/reconcile'
import { IMPLEMENT_TOOLS, implementPrompt } from './agent/phases/implement'
import { CLEANUP_TOOLS, cleanupPrompt, cleanupScope } from './agent/phases/cleanup'
import { sweepPlans } from './agent/phases/plan-housekeeping'
import { ensureAgentDirIgnored } from './agent/agent-dir-ignore'
import { scratchDir, scratchInstruction } from './agent/scratch/scratch-folder'
import { SpecContract } from './agent/phases/spec-model'
import { ScenarioContextContract } from './agent/phases/scenario-context'
import { withRepoMap, workspaceRepoMap } from './agent/repo-map/session-context'
import { outlineDocsMap, withDocsMap, workspaceDocsMap, type DocsMapStyle } from './agent/docs-map/session-context'
import { renderOutlineMap } from './agent/docs-map/outline-map'
import { DOCS_MAP_TOOLS, docsMapPrompt, docsMapScope } from './agent/phases/docs-map'
import { DocsMapContract } from './agent/docs-map/entry'
import { DOCS_EVALUATION_TOOLS, docsEvaluationPrompt, docsEvaluationScope } from './agent/phases/docs-evaluation'
import { FILE_DECISIONS_TOOLS, fileDecisionsPrompt, fileDecisionsScope } from './agent/phases/file-decisions'
import { CHAT_DECISIONS, UnfiledContract } from './agent/phases/unfiled-decisions'
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
import { SETTINGS_PANEL_TYPE, SettingsPanel } from './settings/settings-panel'
import { SettingsStore, readCleanupLimits, readModelSettings, secretKey, type ConfigPort } from './settings/settings-store'
import { compactAtFor, DEFAULT_COMPACT_AT_TOKENS } from './agent/session/compaction-point'

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

/**
 * Tools the extension provides to every engine, beside the engine's own file
 * and shell tools. A mode's tool set decides which of them it is offered; a
 * chat session names none, so it gets them all.
 */
const OWN_TOOLS: Tool[] = [jsonSchemaTool, jsonQueryTool, codeOutlineTool, askUserTool, moveTool, copyTool, runScriptTool()]

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('KiwiAgent')
  // Without a folder open the engine still needs a working directory that exists.
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath
  mkdirSync(workspaceRoot, { recursive: true })
  void ensureAgentDirIgnored(workspaceRoot).then(
    (result) => {
      if (result === 'added') output.appendLine('added .agent/ to .gitignore')
    },
    (error: unknown) => output.appendLine(`could not add .agent/ to .gitignore: ${error instanceof Error ? error.message : String(error)}`),
  )
  void sweepPlans(workspaceRoot, new Date()).then(
    (report) => {
      for (const path of report.converted) output.appendLine(`plan housekeeping: converted ${path} to JSON`)
      for (const path of report.moved) output.appendLine(`plan housekeeping: moved ${path} to the working files`)
      for (const path of report.blocked) output.appendLine(`plan housekeeping: left ${path}, the working files already hold one of that name`)
      for (const path of report.implemented) output.appendLine(`plan housekeeping: marked ${path} implemented`)
      for (const path of report.removed) output.appendLine(`plan housekeeping: removed ${path}`)
    },
    (error: unknown) => output.appendLine(`plan housekeeping failed: ${error instanceof Error ? error.message : String(error)}`),
  )
  const cliPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'cli.mjs').fsPath
  // The skills this extension ships, as a plugin folder the Claude engine loads and a skill root ours reads.
  const pluginPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'plugin').fsPath

  const store: SessionStore = {
    list: () => context.workspaceState.get<SessionRecord[]>('sessions', []),
    save: (records) => Promise.resolve(context.workspaceState.update('sessions', records)),
  }

  // Per feature and per user, beside the sessions themselves rather than in the spec or the tasks file (B7).
  const phaseChoiceStore: PhaseChoiceStore = {
    read: () => context.workspaceState.get<FeaturePhaseChoices>('modelChoices', {}),
    save: (choices) => Promise.resolve(context.workspaceState.update('modelChoices', choices)),
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
    limits: () => readCleanupLimits(configPort()),
    ignore: () => vscode.workspace.getConfiguration('kiwiAgent').get<string[]>('cleanup.ignore', []),
  }

  const writesAllowed = new Map<string, boolean>()
  const allowWritesControl: SessionSwitch = {
    isEnabled: (id) => writesAllowed.get(id) ?? false,
    setEnabled: (id, enabled) => void writesAllowed.set(id, enabled),
  }

  /** Per session, the tools it was given: what tells the permission policy which of them only look. */
  const sessionTools = new Map<string, readonly Tool[]>()

  /** Per session, what captures the file it is about to edit and turns it into the diff the chat shows. */
  const editRecorders = new Map<string, FileEditRecorder>()

  /** Rules allowed "for session": they hold beside the project's until the extension host goes. */
  const sessionAllowed = new Map<string, string[]>()
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
        return { ...rules, allow: [...rules.allow, ...(sessionAllowed.get(sessionId) ?? [])] }
      },
      {
        readOnly: readOnlyTools(() => sessionTools.get(sessionId) ?? []),
        project: projectCommands,
        writesAllowed: () => allowWritesControl.isEnabled(sessionId),
        scratch: scratchDir(sessionId),
      },
    )
    policies.set(sessionId, policy)
    return policy
  }

  /** A start-up phase, reported in the status bar and in the session's own chat. */
  type StartProgress = (line: string) => void

  /**
   * The repo map as the session's system prompt carries it: built first when it
   * is behind, with the progress of the build visible while the start waits.
   * Taken here, at engine creation, so the map a session works from is fixed
   * for the life of that engine.
   */
  const withMap = async (record: SessionRecord, systemPrompt: string, onProgress: StartProgress): Promise<string> =>
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'KiwiAgent: repo map' }, (progress) =>
      withRepoMap(record.mode, systemPrompt, workspaceRepoMap(workspaceRoot), {
        onProgress: (line) => {
          progress.report({ message: line })
          onProgress(line)
        },
      }),
    )

  /** Docs the blind planner must not see, so neither the map nor the evaluation may describe them. */
  const planIgnore = (): string[] => vscode.workspace.getConfiguration('kiwiAgent').get<string[]>('planIgnore', [])

  /**
   * The docs map as a session working in the intent carries it. Describing a
   * doc costs a turn, so only the docs that changed are read, and a build that
   * cannot deliver leaves the session on the map as it last stood.
   */
  const withDocs = async (record: SessionRecord, systemPrompt: string, onProgress: StartProgress): Promise<string> => {
    const ignored = planIgnore()
    const style = vscode.workspace.getConfiguration('kiwiAgent').get<DocsMapStyle>('docsMap.style', 'described')
    const source =
      style === 'outline'
        ? outlineDocsMap(() => renderOutlineMap(workspaceRoot, ignored))
        : workspaceDocsMap(workspaceRoot, ignored, (onProgress) => chat.buildDocsMap(ignored, onProgress))
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'KiwiAgent: docs map' }, (progress) =>
      withDocsMap(record.mode, systemPrompt, source, {
        style,
        onProgress: (line) => {
          progress.report({ message: line })
          onProgress(line)
        },
      }),
    )
  }

  /** What a session's mode dictates, independent of engine: hooks, prompt, tool set, and the files a search may hand back. */
  type ModeSetup = { hooks?: SessionHooks; systemPrompt?: string; toolNames?: string[]; readable?: (relPath: string) => boolean }

  const setupFor = async (record: SessionRecord, onProgress: StartProgress): Promise<ModeSetup> => {
    const setup = await modeSetup(record, onProgress)
    const runDir = RunLog.forSession(workspaceRoot, record.id).dir
    // What the session started from, so a run can be judged against it later (which docs map it had, for one).
    if (setup.systemPrompt !== undefined) {
      await mkdir(runDir, { recursive: true })
        .then(() => writeFile(join(runDir, 'system-prompt.md'), setup.systemPrompt!, 'utf8'))
        .catch((error: unknown) => output.appendLine(`could not record the system prompt: ${error instanceof Error ? error.message : String(error)}`))
    }
    // Last in line, so a call another hook denies is never captured: nothing changed.
    const recorder = new FileEditRecorder({ cwd: workspaceRoot, runDir })
    editRecorders.set(record.id, recorder)
    // After the mode's scope, so a doc the session may not read is never outlined. The docs map
    // describes every section, so it reads docs whole; plan files are the work and are read whole too.
    const gate: SessionHooks[] = record.mode === 'docs-map' ? [] : [new OutlineGate(workspaceRoot, [`${PLAN_DIR}/**`]), new CodeOutlineGate(workspaceRoot)]
    if (!setup.toolNames || setup.toolNames.includes('RunScript')) gate.push(new ScriptGate())
    // Every session that writes is held to the same check, whatever it writes and whichever engine runs it.
    const staleWrites = new StaleWriteGuard(workspaceRoot, new FileHands(workspaceRoot, record.id, record.mode, record.feature))
    // The permission rules apply to every session; a mode's own hooks may still deny. Any session may record an unfiled decision.
    return { ...setup, hooks: composeHooks(policyFor(record.id), ...(setup.hooks ? [setup.hooks] : []), ...gate, staleWrites, new UnfiledContract(workspaceRoot), recorder) }
  }

  const modeSetup = async (record: SessionRecord, onProgress: StartProgress): Promise<ModeSetup> => {
    switch (record.mode) {
      case 'chat':
        return {}
      case 'implement': {
        if (!record.feature) throw new Error('An implement session needs a feature name')
        return {
          // The user's answers amend the task's rules, held to the contract like the planner's writes.
          hooks: composeHooks(new TaskBoardGuard(workspaceRoot, record.feature), new SpecContract(workspaceRoot)),
          systemPrompt: await withMap(record, implementPrompt(record.feature, workspaceRoot, verifier.rules()), onProgress),
          toolNames: IMPLEMENT_TOOLS,
        }
      }
      case 'plan': {
        if (!record.feature) throw new Error('A plan session needs a feature name')
        const scope = blindPlanScope(record.feature, planIgnore())
        return {
          // The contract answers on the write that broke it, so the planner fixes the spec in the same turn.
          hooks: composeHooks(new ScopeGuard(workspaceRoot, scope), new SpecContract(workspaceRoot)),
          systemPrompt: await withDocs(record, blindPlanPrompt(record.feature, workspaceRoot), onProgress),
          toolNames: BLIND_PLAN_TOOLS,
          readable: readableIn(scope),
        }
      }
      case 'docs': {
        const scope = docsEvaluationScope(planIgnore())
        return {
          hooks: new ScopeGuard(workspaceRoot, scope),
          systemPrompt: await withDocs(record, docsEvaluationPrompt(workspaceRoot), onProgress),
          toolNames: DOCS_EVALUATION_TOOLS,
          readable: readableIn(scope),
        }
      }
      case 'file-decisions': {
        const scope = fileDecisionsScope(planIgnore())
        return {
          hooks: composeHooks(new ScopeGuard(workspaceRoot, scope), new SpecContract(workspaceRoot)),
          systemPrompt: await withDocs(record, fileDecisionsPrompt(workspaceRoot), onProgress),
          toolNames: FILE_DECISIONS_TOOLS,
          readable: readableIn(scope),
        }
      }
      case 'docs-map': {
        return {
          // The entry contract answers on the write that broke it, so a bad anchor never reaches a planner's prompt.
          hooks: composeHooks(new ScopeGuard(workspaceRoot, docsMapScope(record.files ?? [])), new DocsMapContract(workspaceRoot)),
          systemPrompt: docsMapPrompt(workspaceRoot),
          toolNames: DOCS_MAP_TOOLS,
        }
      }
      case 'reconcile': {
        if (!record.feature) throw new Error('A reconcile session needs a feature name')
        return {
          hooks: composeHooks(
            new ScopeGuard(workspaceRoot, reconcileScope(record.feature)),
            new SpecContract(workspaceRoot),
            new ScenarioContextContract(workspaceRoot, record.feature),
          ),
          systemPrompt: await withMap(record, reconcilePrompt(record.feature, workspaceRoot), onProgress),
          toolNames: RECONCILE_TOOLS,
        }
      }
      case 'cleanup': {
        if (!record.feature || !record.files) throw new Error('A cleanup session needs a feature name and the files to split')
        return {
          hooks: new ScopeGuard(workspaceRoot, cleanupScope(record.files)),
          systemPrompt: cleanupPrompt(record.feature, workspaceRoot, readCleanupLimits(configPort())),
          toolNames: CLEANUP_TOOLS,
        }
      }
    }
  }

  /** The workspace's `.mcp.json`, read once and again on every change; `sessions` is resolved when a session runs, after it exists. */
  const mcp = new McpServerSet(
    () => readMcpConfig(workspaceRoot),
    () => sessions.liveSessions(),
    (message) => void vscode.window.showWarningMessage(`KiwiAgent: ${message}`),
  )

  /** An engine start-up step in the output channel, timed, so a start that stalls shows the step it stalled on. */
  const traceStart = (record: SessionRecord, line: string): void =>
    output.appendLine(`${new Date().toISOString()} [${record.id.slice(0, 8)} ${record.mode}] ${line}`)

  /** The endpoint's requests in the output channel: sent, answered with a status, or failed, each timed. */
  const tracedFetch =
    (record: SessionRecord): typeof fetch =>
    async (input, init) => {
      const started = Date.now()
      const size = typeof init?.body === 'string' ? `${init.body.length} chars` : 'no body'
      traceStart(record, `${init?.method ?? 'GET'} ${String(input)} (${size})`)
      try {
        const response = await fetch(input, init)
        traceStart(record, `${response.status} ${response.statusText} after ${Date.now() - started} ms`)
        return response
      } catch (error) {
        traceStart(record, `request failed after ${Date.now() - started} ms: ${error instanceof Error ? error.message : String(error)}`)
        throw error
      }
    }

  const createEngine = async (record: SessionRecord, onProgress: StartProgress): Promise<CodeSession> => {
    const { profile } = record
    traceStart(record, `starting ${profile.engine} engine, profile "${profile.name}", model ${profile.model}${record.engineSessionId ? `, resuming ${record.engineSessionId}` : ''}`)
    try {
      const session = await startEngine(record, (line) => {
        traceStart(record, line)
        onProgress(line)
      })
      traceStart(record, 'engine up')
      return session
    } catch (error) {
      traceStart(record, `engine failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
      throw error
    }
  }

  const startEngine = async (record: SessionRecord, onProgress: StartProgress): Promise<CodeSession> => {
    const { profile } = record
    const setup = await setupFor(record, onProgress)
    traceStart(record, `mode set up: ${setup.systemPrompt?.length ?? 0} chars of system prompt, tools ${setup.toolNames?.join(', ') ?? 'all'}`)
    const allowed = (tools: Tool[]) => (setup.toolNames ? tools.filter((t) => setup.toolNames!.includes(t.name)) : tools)
    const ownTools = [...OWN_TOOLS, markdownSearchTool(setup.readable), codeSearchTool(setup.readable), ...(record.feature ? taskBoardTools(record.feature) : [])]
    // A mode with a tool set of its own names no MCP server; only a chat takes the workspace's.
    if (!setup.toolNames) onProgress('Reading the MCP servers')
    const mcpServers = setup.toolNames ? undefined : await mcp.current()
    // Only a session with a shell runs what it writes; the scoped phases have none, and their scope would deny the folder anyway.
    const scratch = !setup.toolNames || setup.toolNames.includes('Bash') ? scratchDir(record.id) : undefined
    if (scratch)
      await mkdir(join(workspaceRoot, scratch), { recursive: true }).catch((error: unknown) =>
        output.appendLine(`could not create the scratch folder: ${error instanceof Error ? error.message : String(error)}`),
      )
    const scratchLine = scratch ? `\n${scratchInstruction(scratch)}` : ''
    switch (profile.engine) {
      case 'claude-sdk':
        // Until the engine reports in, the wait is on its own start-up.
        onProgress('Starting Claude Code')
        // A key stored on the provider is the user's choice over the editor's Claude login; none leaves that login in charge.
        const anthropicKey = profile.apiKeySecret ? await context.secrets.get(secretKey(profile.apiKeySecret)) : undefined
        traceStart(record, anthropicKey ? `using the API key "${profile.apiKeySecret}"` : 'no API key stored, using the editor login')
        const scriptTools = [globTool, grepTool, bashTool(), jsonSchemaTool, jsonQueryTool, codeOutlineTool]
        sessionTools.set(record.id, [...allowed(ownTools), ...scriptTools])
        return new SdkSession({
          ownTools: allowed(ownTools),
          scriptTools,
          ...(mcpServers ? { mcpServers } : {}),
          id: record.id,
          profile,
          cwd: workspaceRoot,
          cliPath,
          pluginPath,
          runtime: nodeRuntime(),
          ...(record.engineSessionId ? { resumeEngineSessionId: record.engineSessionId } : {}),
          // Telemetry posts go through axios, which cannot authenticate against a
          // corporate proxy asking for NTLM, leaving 407s in the session diagnostics.
          env: {
            CLAUDE_AGENT_SDK_CLIENT_APP: 'kiwi-agent-vscode/0.0.1',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            ...(anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey } : {}),
          },
          ...(setup.hooks ? { hooks: setup.hooks } : {}),
          ...(setup.systemPrompt !== undefined
            ? { systemPrompt: setup.systemPrompt + scratchLine }
            : { appendSystemPrompt: `${DOC_READING}\n${CODE_READING}\n${SCRIPT_WRITING}\n${CHAT_DECISIONS}${scratchLine}` }),
          ...(setup.toolNames ? { tools: setup.toolNames } : {}),
          compactAtTokens: compactAtTokens(profile),
          query,
          onStderr: (chunk) => output.append(chunk),
          ...(vscode.workspace.getConfiguration('kiwiAgent').get<boolean>('traceEngine', false)
            ? { trace: (line: string) => output.appendLine(`[${record.id.slice(0, 8)}] ${line}`) }
            : {}),
        })
      case 'openai-compatible': {
        if (!profile.baseUrl) throw new Error(`Profile "${profile.name}" has no baseUrl`)
        if (!profile.apiKeySecret) throw new Error(`Profile "${profile.name}" has no apiKeySecret`)
        traceStart(record, `reading the API key "${profile.apiKeySecret}"`)
        const apiKey = await context.secrets.get(secretKey(profile.apiKeySecret))
        if (!apiKey) throw new Error(`No API key stored for "${profile.apiKeySecret}". Set it on the provider in KiwiAgent settings.`)
        onProgress(`Connecting to ${profile.name}`)
        // Indexed per session so a skill added to the workspace or the user profile shows up on the next one.
        const skills = await indexSkills(workspaceRoot, undefined, join(pluginPath, 'skills'))
        traceStart(record, `${skills.length} skills indexed`)
        const allTools = [readTool, writeTool, editTool, globTool, grepTool, ...ownTools, bashTool(), ...(skills.length ? [skillTool(skills)] : [])]
        // A session that ran before, or continues one that did, picks its conversation up from the run log.
        const resume = record.engineSessionId
          ? { engineSessionId: record.engineSessionId, history: messagesFromEvents(await sessions.conversation(record.id)) }
          : undefined
        if (resume) traceStart(record, `${resume.history.length} messages of history rebuilt`)
        traceStart(record, `building the session: ${allowed(allTools).map((t) => t.name).join(', ')}`)
        sessionTools.set(record.id, allowed(allTools))
        const contextWindow = vscode.workspace.getConfiguration('kiwiAgent').get<Record<string, number>>('contextWindows', {})[profile.model]
        return new OpenAiSession({
          id: record.id,
          profile,
          cwd: workspaceRoot,
          client: new OpenAiClient({ baseUrl: profile.baseUrl, apiKey, fetch: tracedFetch(record) }),
          tools: allowed(allTools),
          systemPrompt: (setup.systemPrompt ?? (await buildSystemPrompt(workspaceRoot, profile.systemPromptFile))) + scratchLine,
          ...(resume ? { resume } : {}),
          ...(contextWindow ? { contextWindow } : {}),
          compactAtTokens: compactAtTokens(profile),
          ...(setup.hooks ? { hooks: setup.hooks } : {}),
          ...(mcpServers
            ? { mcp: { host: new McpToolHost(connectMcp(workspaceRoot, (server, chunk) => output.append(`[mcp ${server}] ${chunk}`))), servers: mcpServers } }
            : {}),
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
  const settings = new SettingsStore(configPort(), {
    has: async (name) => (await context.secrets.get(secretKey(name))) !== undefined,
    store: (name, value) => Promise.resolve(context.secrets.store(secretKey(name), value)),
    move: async (from, to) => {
      const value = await context.secrets.get(secretKey(from))
      if (value === undefined) return
      await context.secrets.store(secretKey(to), value)
      await context.secrets.delete(secretKey(from))
    },
    delete: (name) => Promise.resolve(context.secrets.delete(secretKey(name))),
  })
  const settingsPanel = new SettingsPanel(context.extensionUri, settings, async ({ name, baseUrl, apiKeyValue }) => {
    if (!baseUrl) return []
    const apiKey = apiKeyValue || (await context.secrets.get(secretKey(name)))
    if (!apiKey) throw new Error(`No API key typed or stored for "${name}".`)
    return new OpenAiClient({ baseUrl, apiKey }).listModels()
  })
  chat = new ChatViewProvider(
    context.extensionUri,
    sessions,
    (mode, feature) => phaseProfileFor(phaseChoiceStore, mode, feature),
    phaseChoiceStore,
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
    // The panel says which session it showed, so a reload brings each tab back on its own session.
    vscode.window.registerWebviewPanelSerializer(CHAT_PANEL_TYPE, {
      deserializeWebviewPanel: (panel, state: { tabId?: string } | undefined) => {
        chat.adoptPanel(panel, state?.tabId)
        return Promise.resolve()
      },
    }),
    vscode.window.registerTreeDataProvider('kiwiAgent.sessions', tree),
    chat.onDidChange(() => tree.refresh()),
    vscode.commands.registerCommand('kiwiAgent.newSession', () => chat.showNewSession()),
    vscode.commands.registerCommand('kiwiAgent.openChat', () => chat.showNewSession()),
    vscode.commands.registerCommand('kiwiAgent.openSession', (id: string) => chat.open(id)),
    vscode.commands.registerCommand('kiwiAgent.resumePlan', (feature: string) =>
      chat.resumePlan(feature).catch((error: unknown) => {
        void vscode.window.showErrorMessage(`KiwiAgent: ${error instanceof Error ? error.message : String(error)}`)
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
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, `${PLAN_DIR}/*.spec.md`))
  return vscode.Disposable.from(watcher, watcher.onDidCreate(onChange), watcher.onDidChange(onChange), watcher.onDidDelete(onChange))
}

/** What a step runs on absent any feature choice: the settings default, resolved against the providers it names. */
function profileFor(mode: SessionMode): ModelProfile {
  const { providers, profiles, activeProfile } = readModelSettings(configPort())
  const profile = profiles.find((p) => p.name === activeProfile) ?? profiles[0]
  if (!profile) throw new Error('No model profiles configured (kiwiAgent.profiles)')
  if (activeProfile && profile.name !== activeProfile) {
    void vscode.window.showWarningMessage(`KiwiAgent: profile "${activeProfile}" not found, using "${profile.name}".`)
  }
  return resolveStep(profile, providers, mode)
}

/**
 * What a feature's phase runs on: its own choice, from `phaseChoiceStore`,
 * when the profile it names is still configured, the settings default
 * otherwise (B1, B2). A step with no feature (chat and the modes that stand
 * on their own) never has a choice to look up.
 */
function phaseProfileFor(phaseChoiceStore: PhaseChoiceStore, mode: SessionMode, feature: string | undefined): PhaseProfile {
  const settingsDefault = profileFor(mode)
  if (!feature) return { kind: 'ok', profile: settingsDefault, isDefault: true }
  const { providers, profiles } = readModelSettings(configPort())
  const chosen = choiceFor(phaseChoiceStore.read(), feature, mode)
  return resolvePhase(mode, chosen, profiles, providers, settingsDefault)
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

/**
 * The extension host may have no `node` on PATH, but its own executable runs
 * as Node when asked. A configured path wins so a machine with a specific
 * Node install can use it.
 */
function nodeRuntime(): NodeRuntime {
  const configured = vscode.workspace.getConfiguration('kiwiAgent').get<string>('nodePath', '')
  return configured ? { command: configured, args: [], env: {} } : hostExecutableAsNode(process.execPath)
}

/** Read from the settings as they stand, not the profile the session was made with, so a limit set since applies. */
function compactAtTokens(profile: ModelProfile): number {
  const fallback = vscode.workspace.getConfiguration('kiwiAgent').get<number>('compactAtTokens', DEFAULT_COMPACT_AT_TOKENS)
  return compactAtFor(profile, readModelSettings(configPort()).providers, fallback)
}
