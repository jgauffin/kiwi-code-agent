import * as vscode from 'vscode'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SessionRecord } from './agent/session/session-manager'
import type { CodeSession, SessionEvent } from './agent/session/code-session'
import type { ModelProfile } from './agent/session/model-profile'
import { reasoningEffortFor } from './agent/session/effort'
import { modeSetup, type ModeContext, type ModeSetup } from './agent/session/mode-setup'
import { composeHooks, type SessionHooks } from './agent/session/hooks'
import { StaleWriteGuard } from './agent/session/stale-write-guard'
import { NoticeOfAnotherHand } from './agent/session/notice-of-another-hand'
import { FileHands } from './agent/session/file-hands'
import { compactAtFor, DEFAULT_COMPACT_AT_TOKENS } from './agent/session/compaction-point'
import { SdkSession } from './agent/sdk-session/sdk-session'
import { toolNamingLine } from './agent/sdk-session/tool-server'
import { hostExecutableAsNode, type NodeRuntime } from './agent/sdk-session/node-runtime'
import { RunLog } from './agent/runs/run-log'
import { OpenAiSession } from './agent/openai-session/openai-session'
import { OpenAiClient } from './agent/openai-session/openai-client'
import { messagesFromEvents } from './agent/openai-session/history'
import { buildSystemPrompt } from './agent/openai-session/system-prompt'
import { readTool } from './agent/openai-session/tools/read'
import { writeTool } from './agent/openai-session/tools/write'
import { EDIT_WRITING, editTool } from './agent/openai-session/tools/edit'
import { multiEditTool } from './agent/openai-session/tools/multi-edit'
import { runScriptTool } from './agent/openai-session/tools/run-script'
import { globTool } from './agent/openai-session/tools/glob'
import { grepTool } from './agent/openai-session/tools/grep'
import { bashTool } from './agent/openai-session/tools/bash'
import { askUserTool } from './agent/openai-session/tools/ask-user'
import { taskBoardTools } from './agent/openai-session/tools/task-board'
import { jsonQueryTool, jsonSchemaTool } from './agent/openai-session/tools/json'
import { skillTool } from './agent/openai-session/tools/skill'
import { copyTool, moveTool } from './agent/openai-session/tools/move-copy'
import { markdownSearchTool } from './agent/openai-session/tools/markdown-search'
import { DOC_READING, OutlineGate } from './agent/openai-session/tools/markdown/outline-gate'
import type { Tool } from './agent/openai-session/tools/tool'
import { codeOutlineTool } from './agent/code-outline/code-outline-tool'
import { CODE_READING, CodeOutlineGate } from './agent/code-outline/code-outline-gate'
import { codeSearchTool } from './agent/code-outline/code-search'
import { RepeatedEdit } from './agent/script/repeated-edit'
import { SCRIPT_WRITING, ScriptGate } from './agent/script/script-gate'
import { indexSkills } from './agent/skills/skill-index'
import { connectMcp } from './agent/mcp/mcp-connect'
import type { McpServerSet } from './agent/mcp/mcp-servers'
import { McpToolHost } from './agent/mcp/mcp-tool-host'
import { FileEditRecorder } from './agent/edits/file-edit-recorder'
import type { PermissionPolicy } from './agent/permissions/permission-policy'
import { projectScriptsInstruction } from './agent/permissions/package-scripts'
import { SPECS_DIR, SPEC_READING } from './agent/phases/blind-plan'
import { CHAT_DECISIONS, UnfiledContract } from './agent/phases/unfiled-decisions'
import { MemoryContract, memoryWritingInstructions } from './agent/memory/memories'
import { chatMemorySection, withMemories } from './agent/memory/session-context'
import { instructionsText, readInstructionFiles, withInstructionFiles } from './agent/instructions/instruction-files'
import { scratchDir, scratchInstruction } from './agent/scratch/scratch-folder'
import { withRepoMap, workspaceRepoMap } from './agent/repo-map/session-context'
import { outlineDocsMap, withDocsMap, workspaceDocsMap, type DocsMapStyle } from './agent/docs-map/session-context'
import { renderOutlineMap } from './agent/docs-map/outline-map'
import type { DocsMapResult } from './agent/docs-map/build'
import type { Verifier } from './chat/feature-runs'
import { readCleanupLimits, readModelSettings, secretKey, type ConfigPort } from './settings/settings-store'
import { errorMessage } from './error-message'

/**
 * Tools the extension provides to every engine, beside the engine's own file
 * and shell tools. A mode's tool set decides which of them it is offered; a
 * chat session names none, so it gets them all.
 */
const OWN_TOOLS: Tool[] = [jsonSchemaTool, jsonQueryTool, codeOutlineTool, askUserTool, moveTool, copyTool, runScriptTool()]

/** A start-up phase, reported in the status bar and in the session's own chat. */
type StartProgress = (line: string) => void

export type EngineDeps = {
  context: vscode.ExtensionContext
  output: vscode.OutputChannel
  config: ConfigPort
  workspaceRoot: string
  mcp: McpServerSet
  verifier: Verifier
  policyFor: (sessionId: string) => PermissionPolicy
  planIgnore: () => string[]
  buildDocsMap: (ignored: string[], onProgress: (line: string) => void) => Promise<DocsMapResult>
  /** A session's past events, for an engine that rebuilds its conversation from the run log. */
  conversation: (sessionId: string) => Promise<SessionEvent[]>
}

/** Starts a session's engine: its mode's setup, the hooks every session is held to, and the engine its profile names. */
export class SessionEngines {
  /** Per session, the tools it was given: what tells the permission policy which of them only look. */
  private readonly sessionTools = new Map<string, readonly Tool[]>()
  /** Per session, what captures the file it is about to edit and turns it into the diff the chat shows. */
  private readonly editRecorders = new Map<string, FileEditRecorder>()
  private readonly cliPath: string
  /** The skills this extension ships, as a plugin folder the Claude engine loads and a skill root ours reads. */
  private readonly pluginPath: string

  constructor(private readonly deps: EngineDeps) {
    this.cliPath = vscode.Uri.joinPath(deps.context.extensionUri, 'dist', 'cli.mjs').fsPath
    this.pluginPath = vscode.Uri.joinPath(deps.context.extensionUri, 'dist', 'plugin').fsPath
  }

  toolsOf(sessionId: string): readonly Tool[] {
    return this.sessionTools.get(sessionId) ?? []
  }

  recorderOf(sessionId: string): FileEditRecorder | undefined {
    return this.editRecorders.get(sessionId)
  }

  async create(record: SessionRecord, onProgress: StartProgress): Promise<CodeSession> {
    const { profile } = record
    this.traceStart(record, `starting ${profile.engine} engine, profile "${profile.name}", model ${profile.model}${record.engineSessionId ? `, resuming ${record.engineSessionId}` : ''}`)
    try {
      const session = await this.start(record, (line) => {
        this.traceStart(record, line)
        onProgress(line)
      })
      this.traceStart(record, 'engine up')
      return session
    } catch (error) {
      this.traceStart(record, `engine failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
      throw error
    }
  }

  private async start(record: SessionRecord, onProgress: StartProgress): Promise<CodeSession> {
    const { workspaceRoot, output } = this.deps
    const setup = await this.setupFor(record, onProgress)
    this.traceStart(record, `mode set up: ${setup.systemPrompt?.length ?? 0} chars of system prompt, tools ${setup.toolNames?.join(', ') ?? 'all'}`)
    const ownTools = [
      ...OWN_TOOLS,
      markdownSearchTool(setup.readable),
      codeSearchTool(setup.readable),
      ...(record.feature ? taskBoardTools(record.feature, new FileHands(workspaceRoot, record.id, record.mode, record.feature)) : []),
    ]
    // A mode with a tool set of its own names no MCP server; only a chat takes the workspace's.
    if (!setup.toolNames) onProgress('Reading the MCP servers')
    const mcpServers = setup.toolNames ? undefined : await this.deps.mcp.current()
    // Only a session with a shell runs what it writes; the scoped phases have none, and their scope would deny the folder anyway.
    const scratch = !setup.toolNames || setup.toolNames.includes('Bash') ? scratchDir(record.id) : undefined
    if (scratch)
      await mkdir(join(workspaceRoot, scratch), { recursive: true }).catch((error: unknown) =>
        output.appendLine(`could not create the scratch folder: ${errorMessage(error)}`),
      )
    const start: EngineStart = { record, setup, ownTools, mcpServers, scratchLine: scratch ? `\n${scratchInstruction(scratch)}` : '', onProgress }
    switch (record.profile.engine) {
      case 'claude-sdk':
        return this.startClaude(start)
      case 'openai-compatible':
        return this.startOpenAi(start)
    }
  }

  private async startClaude({ record, setup, ownTools, mcpServers, scratchLine, onProgress }: EngineStart): Promise<CodeSession> {
    const { profile } = record
    const { context, output, workspaceRoot } = this.deps
    // Until the engine reports in, the wait is on its own start-up.
    onProgress('Starting Claude Code')
    // A key stored on the provider is the user's choice over the editor's Claude login; none leaves that login in charge.
    const anthropicKey = profile.apiKeySecret ? await context.secrets.get(secretKey(profile.apiKeySecret)) : undefined
    this.traceStart(record, anthropicKey ? `using the API key "${profile.apiKeySecret}"` : 'no API key stored, using the editor login')
    // A mode with a prompt of its own already carries its memories and instruction files from
    // `modeSetup`; the chat prompt is built here, so the same pieces are added for it here instead.
    // Claude's own preset already reads the workspace's CLAUDE.md, but not AGENTS.md nor anything
    // of the person's, so the instruction files are read again rather than left to it.
    const chatMemories = setup.systemPrompt === undefined ? await chatMemorySection(workspaceRoot) : undefined
    const chatInstructionFiles = setup.systemPrompt === undefined ? await readInstructionFiles(workspaceRoot) : undefined
    const scriptTools = [globTool, grepTool]
    const offered = allowed(setup, ownTools)
    this.sessionTools.set(record.id, [...offered, ...scriptTools])
    const toolNaming = toolNamingLine(offered)
    return new SdkSession({
      ownTools: offered,
      scriptTools,
      ...(mcpServers ? { mcpServers } : {}),
      id: record.id,
      profile,
      cwd: workspaceRoot,
      cliPath: this.cliPath,
      pluginPath: this.pluginPath,
      runtime: nodeRuntime(),
      ...(record.engineSessionId ? { resumeEngineSessionId: record.engineSessionId } : {}),
      // Telemetry posts go through axios, which cannot authenticate against a
      // corporate proxy asking for NTLM, leaving 407s in the session diagnostics.
      env: {
        CLAUDE_AGENT_SDK_CLIENT_APP: 'kiwipow-agent-vscode/0.0.1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        ...(anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey } : {}),
      },
      ...(setup.hooks ? { hooks: setup.hooks } : {}),
      ...(setup.systemPrompt !== undefined
        ? { systemPrompt: setup.systemPrompt + scratchLine + toolNaming }
        : {
            appendSystemPrompt: `${DOC_READING}\n${CODE_READING}\n${SCRIPT_WRITING}\n${EDIT_WRITING}\n${projectScriptsInstruction(workspaceRoot)}\n${SPEC_READING}\n${CHAT_DECISIONS}\n${memoryWritingInstructions(workspaceRoot)}${chatMemories ? `\n\n${chatMemories}` : ''}${chatInstructionFiles?.length ? `\n\n${instructionsText(chatInstructionFiles)}` : ''}${scratchLine}${toolNaming}`,
          }),
      ...(setup.toolNames ? { tools: setup.toolNames } : {}),
      compactAtTokens: this.compactAtTokens(profile),
      query,
      onStderr: (chunk) => output.append(chunk),
      ...(vscode.workspace.getConfiguration('kiwiAgent').get<boolean>('traceEngine', false)
        ? { trace: (line: string) => output.appendLine(`[${record.id.slice(0, 8)}] ${line}`) }
        : {}),
    })
  }

  private async startOpenAi({ record, setup, ownTools, mcpServers, scratchLine, onProgress }: EngineStart): Promise<CodeSession> {
    const { profile } = record
    const { context, output, workspaceRoot } = this.deps
    if (!profile.baseUrl) throw new Error(`Profile "${profile.name}" has no baseUrl`)
    if (!profile.apiKeySecret) throw new Error(`Profile "${profile.name}" has no apiKeySecret`)
    this.traceStart(record, `reading the API key "${profile.apiKeySecret}"`)
    const apiKey = await context.secrets.get(secretKey(profile.apiKeySecret))
    if (!apiKey) throw new Error(`No API key stored for "${profile.apiKeySecret}". Set it on the provider in Kiwipow Agent settings.`)
    onProgress(`Connecting to ${profile.name}`)
    // Indexed per session so a skill added to the workspace or the user profile shows up on the next one.
    const skills = await indexSkills(workspaceRoot, undefined, join(this.pluginPath, 'skills'))
    this.traceStart(record, `${skills.length} skills indexed`)
    const allTools = [readTool, writeTool, editTool, multiEditTool, globTool, grepTool, ...ownTools, bashTool(), ...(skills.length ? [skillTool(skills)] : [])]
    // A session that ran before, or continues one that did, picks its conversation up from the run log.
    const resume = record.engineSessionId
      ? { engineSessionId: record.engineSessionId, history: messagesFromEvents(await this.deps.conversation(record.id)) }
      : undefined
    if (resume) this.traceStart(record, `${resume.history.length} messages of history rebuilt`)
    const offered = allowed(setup, allTools)
    this.traceStart(record, `building the session: ${offered.map((t) => t.name).join(', ')}`)
    this.sessionTools.set(record.id, offered)
    const contextWindow = vscode.workspace.getConfiguration('kiwiAgent').get<Record<string, number>>('contextWindows', {})[profile.model]
    const reasoningEffort = reasoningEffortFor(profile, readModelSettings(this.deps.config).providers)
    return new OpenAiSession({
      id: record.id,
      profile,
      cwd: workspaceRoot,
      client: new OpenAiClient({ baseUrl: profile.baseUrl, apiKey, fetch: this.tracedFetch(record) }),
      tools: offered,
      systemPrompt: (setup.systemPrompt ?? (await buildSystemPrompt(workspaceRoot, profile.systemPromptFile))) + scratchLine,
      ...(resume ? { resume } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      compactAtTokens: this.compactAtTokens(profile),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(setup.hooks ? { hooks: setup.hooks } : {}),
      ...(mcpServers
        ? { mcp: { host: new McpToolHost(connectMcp(workspaceRoot, (server, chunk) => output.append(`[mcp ${server}] ${chunk}`))), servers: mcpServers } }
        : {}),
    })
  }

  private async setupFor(record: SessionRecord, onProgress: StartProgress): Promise<ModeSetup> {
    const { workspaceRoot, output } = this.deps
    const setup = await modeSetup(record, this.modeContext(onProgress))
    const runDir = RunLog.forSession(workspaceRoot, record.id).dir
    // What the session started from, so a run can be judged against it later (which docs map it had, for one).
    if (setup.systemPrompt !== undefined) {
      await mkdir(runDir, { recursive: true })
        .then(() => writeFile(join(runDir, 'system-prompt.md'), setup.systemPrompt!, 'utf8'))
        .catch((error: unknown) => output.appendLine(`could not record the system prompt: ${errorMessage(error)}`))
    }
    // Last in line, so a call another hook denies is never captured: nothing changed.
    const recorder = new FileEditRecorder({ cwd: workspaceRoot, runDir })
    this.editRecorders.set(record.id, recorder)
    // After the mode's scope, so a doc the session may not read is never outlined. The docs map
    // describes every section, so it reads docs whole; plan files are the work and are read whole too.
    const gate: SessionHooks[] = record.mode === 'docs-map' ? [] : [new OutlineGate(workspaceRoot, [`${SPECS_DIR}/**`]), new CodeOutlineGate(workspaceRoot)]
    if (!setup.toolNames || setup.toolNames.includes('RunScript')) gate.push(new ScriptGate(), new RepeatedEdit())
    // Every session that writes is held to the same check, whatever it writes and whichever engine runs it.
    const staleWrites = new StaleWriteGuard(workspaceRoot, new FileHands(workspaceRoot, record.id, record.mode, record.feature))
    // Told on its next tool result, whichever tool that is, when another hand changed a file this session saw.
    const notice = new NoticeOfAnotherHand(workspaceRoot, new FileHands(workspaceRoot, record.id, record.mode, record.feature))
    // The permission rules apply to every session; a mode's own hooks may still deny. Any session may record an unfiled decision or a memory.
    return {
      ...setup,
      hooks: composeHooks(
        this.deps.policyFor(record.id),
        ...(setup.hooks ? [setup.hooks] : []),
        ...gate,
        staleWrites,
        notice,
        new UnfiledContract(workspaceRoot),
        new MemoryContract(workspaceRoot),
        recorder,
      ),
    }
  }

  private modeContext(onProgress: StartProgress): ModeContext {
    return {
      workspaceRoot: this.deps.workspaceRoot,
      verifyRules: () => this.deps.verifier.rules(),
      planIgnore: this.deps.planIgnore,
      cleanupLimits: () => readCleanupLimits(this.deps.config),
      withMap: (record, systemPrompt) => this.withMap(record, systemPrompt, onProgress),
      withDocs: (record, systemPrompt) => this.withDocs(record, systemPrompt, onProgress),
      withMemories: (record, systemPrompt) => withMemories(record.mode, systemPrompt, this.deps.workspaceRoot),
      withInstructions: (record, systemPrompt) => withInstructionFiles(record.mode, systemPrompt, this.deps.workspaceRoot),
    }
  }

  /**
   * The repo map as the session's system prompt carries it: built first when it
   * is behind, with the progress of the build visible while the start waits.
   * Taken here, at engine creation, so the map a session works from is fixed
   * for the life of that engine.
   */
  private async withMap(record: SessionRecord, systemPrompt: string, onProgress: StartProgress): Promise<string> {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Kiwipow Agent: repo map' }, (progress) =>
      withRepoMap(record.mode, systemPrompt, workspaceRepoMap(this.deps.workspaceRoot), {
        onProgress: (line) => {
          progress.report({ message: line })
          onProgress(line)
        },
      }),
    )
  }

  /**
   * The docs map as a session working in the intent carries it. Describing a
   * doc costs a turn, so only the docs that changed are read, and a build that
   * cannot deliver leaves the session on the map as it last stood.
   */
  private async withDocs(record: SessionRecord, systemPrompt: string, onProgress: StartProgress): Promise<string> {
    const { workspaceRoot } = this.deps
    const ignored = this.deps.planIgnore()
    const style = vscode.workspace.getConfiguration('kiwiAgent').get<DocsMapStyle>('docsMap.style', 'described')
    const source =
      style === 'outline'
        ? outlineDocsMap(() => renderOutlineMap(workspaceRoot, ignored))
        : workspaceDocsMap(workspaceRoot, ignored, (onProgress) => this.deps.buildDocsMap(ignored, onProgress))
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Kiwipow Agent: docs map' }, (progress) =>
      withDocsMap(record.mode, systemPrompt, source, {
        style,
        onProgress: (line) => {
          progress.report({ message: line })
          onProgress(line)
        },
      }),
    )
  }

  /** An engine start-up step in the output channel, timed, so a start that stalls shows the step it stalled on. */
  private traceStart(record: SessionRecord, line: string): void {
    this.deps.output.appendLine(`${new Date().toISOString()} [${record.id.slice(0, 8)} ${record.mode}] ${line}`)
  }

  /** The endpoint's requests in the output channel: sent, answered with a status, or failed, each timed. */
  private tracedFetch(record: SessionRecord): typeof fetch {
    return async (input, init) => {
      const started = Date.now()
      const size = typeof init?.body === 'string' ? `${init.body.length} chars` : 'no body'
      this.traceStart(record, `${init?.method ?? 'GET'} ${String(input)} (${size})`)
      try {
        const response = await fetch(input, init)
        this.traceStart(record, `${response.status} ${response.statusText} after ${Date.now() - started} ms`)
        return response
      } catch (error) {
        this.traceStart(record, `request failed after ${Date.now() - started} ms: ${errorMessage(error)}`)
        throw error
      }
    }
  }

  /** Read from the settings as they stand, not the profile the session was made with, so a limit set since applies. */
  private compactAtTokens(profile: ModelProfile): number {
    const fallback = vscode.workspace.getConfiguration('kiwiAgent').get<number>('compactAtTokens', DEFAULT_COMPACT_AT_TOKENS)
    return compactAtFor(profile, readModelSettings(this.deps.config).providers, fallback)
  }
}

/** What both engines start from, once the mode is set up. */
type EngineStart = {
  record: SessionRecord
  setup: ModeSetup
  ownTools: Tool[]
  mcpServers: Awaited<ReturnType<McpServerSet['current']>> | undefined
  scratchLine: string
  onProgress: StartProgress
}

/** The tools the mode's tool set names, or all of them when it names none. */
function allowed(setup: ModeSetup, tools: Tool[]): Tool[] {
  return setup.toolNames ? tools.filter((t) => setup.toolNames!.includes(t.name)) : tools
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
