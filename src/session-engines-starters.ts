import * as vscode from 'vscode'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { actingMode, type SessionRecord } from './agent/session/session-manager'
import { compactionFocus, type CompactionFocus } from './agent/session/compaction-focus'
import type { CodeSession, SessionEvent } from './agent/session/code-session'
import type { ModelProfile } from './agent/session/model-profile'
import { reasoningEffortFor } from './agent/session/effort'
import type { ModeSetup } from './agent/session/mode-setup'
import { SdkSession } from './agent/sdk-session/sdk-session'
import { toolNamingLine } from './agent/sdk-session/tool-server'
import { hostExecutableAsNode, type NodeRuntime } from './agent/sdk-session/node-runtime'
import { OpenAiSession } from './agent/openai-session/openai-session'
import { OpenAiClient } from './agent/openai-session/openai-client'
import { messagesFromEvents } from './agent/openai-session/history'
import { buildSystemPrompt } from './agent/openai-session/system-prompt'
import { readTool } from './agent/openai-session/tools/read'
import { writeTool } from './agent/openai-session/tools/write'
import { EDIT_WRITING, editTool } from './agent/openai-session/tools/edit'
import { multiEditTool } from './agent/openai-session/tools/multi-edit'
import { globTool } from './agent/openai-session/tools/glob'
import { grepTool } from './agent/openai-session/tools/grep'
import { bashTool } from './agent/openai-session/tools/bash'
import { skillTool } from './agent/openai-session/tools/skill'
import { DOC_READING } from './agent/openai-session/tools/markdown/outline-gate'
import type { Tool } from './agent/openai-session/tools/tool'
import { CODE_READING } from './agent/code-outline/code-outline-gate'
import { SCRIPT_WRITING } from './agent/script/script-gate'
import { writeSkillsPlugin, type SkillEntry } from './agent/skills/skill-index'
import { connectMcp } from './agent/mcp/mcp-connect'
import type { McpServerSet } from './agent/mcp/mcp-servers'
import { McpToolHost } from './agent/mcp/mcp-tool-host'
import { projectScriptsInstruction } from './agent/permissions/package-scripts'
import { SPEC_AMENDING, SPEC_READING } from './agent/phases/blind-plan'
import { CHAT_DECISIONS } from './agent/phases/unfiled-decisions'
import { memoryWritingInstructions } from './agent/memory/memories'
import { chatMemorySection } from './agent/memory/session-context'
import { instructionsText, readInstructionFiles } from './agent/instructions/instruction-files'
import { readModelSettings, secretKey, type ConfigPort } from './settings/settings-store'
import type { StartProgress } from './session-engines'

/** What both engines start from, once the mode is set up. */
export type EngineStart = {
  record: SessionRecord
  setup: ModeSetup
  ownTools: Tool[]
  mcpServers: Awaited<ReturnType<McpServerSet['current']>> | undefined
  /** The workspace's, the person's and every bundle's skills, already resolved to one entry per name. */
  skills: SkillEntry[]
  whereLine: string
  scratchLine: string
  onProgress: StartProgress
}

/** What `EngineStarters` needs from `SessionEngines` to build either engine's session. */
export type EngineStarterDeps = {
  context: vscode.ExtensionContext
  output: vscode.OutputChannel
  config: ConfigPort
  workspaceRoot: string
  cliPath: string
  conversation: (sessionId: string) => Promise<SessionEvent[]>
  setSessionTools: (sessionId: string, tools: readonly Tool[]) => void
  traceStart: (record: SessionRecord, line: string) => void
  tracedFetch: (record: SessionRecord) => typeof fetch
  compactAtTokens: (profile: ModelProfile) => number
}

/** What a compaction keeps for the phase the session acts as now: one granted full access compacts as a chat. */
const focusOf = (record: SessionRecord): CompactionFocus => compactionFocus(actingMode(record), record.fixAttempt !== undefined)

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

/** Builds the `CodeSession` each engine starts into, once its mode is set up. */
export class EngineStarters {
  constructor(private readonly deps: EngineStarterDeps) {}

  async startClaude({ record, setup, ownTools, mcpServers, skills, whereLine, scratchLine, onProgress }: EngineStart): Promise<CodeSession> {
    const { profile } = record
    const { context, output, workspaceRoot } = this.deps
    // Until the engine reports in, the wait is on its own start-up.
    onProgress('Starting Claude Code')
    // The engine only discovers skills from its own plugin folders and the project's `.claude/skills`,
    // never `.kiwi/skills`; mirroring the already-resolved list into one throwaway plugin folder is
    // what makes a workspace, profile or bundled skill offered here exactly as the other engine sees it.
    const skillsPluginPath = vscode.Uri.joinPath(context.globalStorageUri, 'skills-plugin', record.id).fsPath
    await writeSkillsPlugin(skillsPluginPath, skills)
    // A key stored on the provider is the user's choice over the editor's Claude login; none leaves that login in charge.
    const anthropicKey = profile.apiKeySecret ? await context.secrets.get(secretKey(profile.apiKeySecret)) : undefined
    this.deps.traceStart(record, anthropicKey ? `using the API key "${profile.apiKeySecret}"` : 'no API key stored, using the editor login')
    // A mode with a prompt of its own already carries its memories and instruction files from
    // `modeSetup`; the chat prompt is built here, so the same pieces are added for it here instead.
    // Claude's own preset already reads the workspace's CLAUDE.md, but not AGENTS.md nor anything
    // of the person's, so the instruction files are read again rather than left to it.
    const chatMemories = setup.systemPrompt === undefined ? await chatMemorySection(workspaceRoot) : undefined
    const chatInstructionFiles = setup.systemPrompt === undefined ? await readInstructionFiles(workspaceRoot) : undefined
    const scriptTools = [globTool, grepTool]
    const offered = allowed(setup, ownTools)
    this.deps.setSessionTools(record.id, [...offered, ...scriptTools])
    const toolNaming = toolNamingLine(offered)
    return new SdkSession({
      ownTools: offered,
      scriptTools,
      ...(mcpServers ? { mcpServers } : {}),
      id: record.id,
      profile,
      cwd: workspaceRoot,
      cliPath: this.deps.cliPath,
      pluginPath: skillsPluginPath,
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
        ? { systemPrompt: setup.systemPrompt + whereLine + scratchLine + toolNaming }
        : {
            appendSystemPrompt: `${DOC_READING}\n${CODE_READING}\n${SCRIPT_WRITING}\n${EDIT_WRITING}\n${projectScriptsInstruction(workspaceRoot)}\n${SPEC_READING}\n${SPEC_AMENDING}\n${CHAT_DECISIONS}\n${memoryWritingInstructions(workspaceRoot)}${chatMemories ? `\n\n${chatMemories}` : ''}${chatInstructionFiles?.length ? `\n\n${instructionsText(chatInstructionFiles)}` : ''}${whereLine}${scratchLine}${toolNaming}`,
          }),
      ...(setup.toolNames ? { tools: setup.toolNames } : {}),
      compactAtTokens: this.deps.compactAtTokens(profile),
      compactionFocus: focusOf(record),
      query,
      onStderr: (chunk) => output.append(chunk),
      ...(vscode.workspace.getConfiguration('kiwiAgent').get<boolean>('traceEngine', false)
        ? { trace: (line: string) => output.appendLine(`[${record.id.slice(0, 8)}] ${line}`) }
        : {}),
    })
  }

  async startOpenAi({ record, setup, ownTools, mcpServers, skills, whereLine, scratchLine, onProgress }: EngineStart): Promise<CodeSession> {
    const { profile } = record
    const { context, output, workspaceRoot } = this.deps
    if (!profile.baseUrl) throw new Error(`Profile "${profile.name}" has no baseUrl`)
    if (!profile.apiKeySecret) throw new Error(`Profile "${profile.name}" has no apiKeySecret`)
    this.deps.traceStart(record, `reading the API key "${profile.apiKeySecret}"`)
    const apiKey = await context.secrets.get(secretKey(profile.apiKeySecret))
    if (!apiKey) throw new Error(`No API key stored for "${profile.apiKeySecret}". Set it on the provider in Kiwipow Agent settings.`)
    onProgress(`Connecting to ${profile.name}`)
    const allTools = [readTool, writeTool, editTool, multiEditTool, globTool, grepTool, ...ownTools, bashTool(), ...(skills.length ? [skillTool(skills)] : [])]
    // A session that ran before, or continues one that did, picks its conversation up from the run log.
    const resume = record.engineSessionId
      ? { engineSessionId: record.engineSessionId, history: messagesFromEvents(await this.deps.conversation(record.id)) }
      : undefined
    if (resume) this.deps.traceStart(record, `${resume.history.length} messages of history rebuilt`)
    const offered = allowed(setup, allTools)
    this.deps.traceStart(record, `building the session: ${offered.map((t) => t.name).join(', ')}`)
    this.deps.setSessionTools(record.id, offered)
    const contextWindow = vscode.workspace.getConfiguration('kiwiAgent').get<Record<string, number>>('contextWindows', {})[profile.model]
    const reasoningEffort = reasoningEffortFor(profile, readModelSettings(this.deps.config).providers)
    return new OpenAiSession({
      id: record.id,
      profile,
      cwd: workspaceRoot,
      client: new OpenAiClient({ baseUrl: profile.baseUrl, apiKey, fetch: this.deps.tracedFetch(record) }),
      tools: offered,
      systemPrompt: (setup.systemPrompt ?? (await buildSystemPrompt(workspaceRoot, profile.systemPromptFile))) + whereLine + scratchLine,
      ...(resume ? { resume } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      compactAtTokens: this.deps.compactAtTokens(profile),
      compactionFocus: focusOf(record),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(setup.hooks ? { hooks: setup.hooks } : {}),
      ...(mcpServers
        ? { mcp: { host: new McpToolHost(connectMcp(workspaceRoot, (server, chunk) => output.append(`[mcp ${server}] ${chunk}`))), servers: mcpServers } }
        : {}),
    })
  }
}
