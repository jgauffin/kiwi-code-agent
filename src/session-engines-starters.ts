import * as vscode from 'vscode'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { actingMode, type SessionRecord } from './agent/session/session-manager'
import { compactionFocus, type CompactionFocus } from './agent/session/compaction-focus'
import type { CodeSession, SessionEvent } from './agent/session/code-session'
import { isClaudeEngine, type ModelProfile } from './agent/session/model-profile'
import { reasoningEffortFor } from './agent/session/effort'
import type { ModeSetup } from './agent/session/mode-setup'
import { SdkSession } from './agent/sdk-session/sdk-session'
import { toolNamingLine } from './agent/sdk-session/tool-server'
import { hostExecutableAsNode, spawnWithRuntime, type NodeRuntime } from './agent/sdk-session/node-runtime'
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
import { delegateTool } from './agent/openai-session/tools/delegate'
import { webFetchTool } from './agent/openai-session/tools/web-fetch'
import { webSearchTool } from './agent/openai-session/tools/web-search'
import { SEARCH_PROVIDER_SECRET_NAME } from './settings/protocol'
import { runSubAgent, subAgentTools } from './agent/sub-agents/run-sub-agent'
import { RESEARCH_SUB_AGENT, subAgentProfile, type SubAgentCatalogEntry } from './agent/sub-agents/sub-agent-index'
import { DOC_READING } from './agent/openai-session/tools/markdown/outline-gate'
import type { Tool } from './agent/openai-session/tools/tool'
import { CODE_READING } from './agent/code-outline/code-outline-gate'
import { SCRIPT_WRITING } from './agent/script/script-gate'
import { writeSkillsPlugin, type SkillEntry } from './agent/skills/skill-index'
import { skillsMirrorDir } from './extension-paths'
import { connectMcp } from './agent/mcp/mcp-connect'
import type { McpServerSet } from './agent/mcp/mcp-servers'
import { McpToolHost } from './agent/mcp/mcp-tool-host'
import { projectScriptsInstruction } from './agent/permissions/package-scripts'
import { PIPE_WRITING } from './agent/permissions/read-only-commands'
import { SPEC_AMENDING, SPEC_CHECKING_AFTER_BUILD, SPEC_READING } from './agent/phases/blind-plan'
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
  /** The sub agents this session offers its own delegating tool, empty where none is: the Claude engine's own delegation is untouched by this. */
  subAgents: SubAgentCatalogEntry[]
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
  /** The Claude Code installed on this machine, as it stands now, or nothing when it has none. */
  installedClaude: () => string | undefined
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

/** Which Claude Code a session runs on, and what runs it: a JavaScript engine needs a Node, a native one runs itself. */
type ClaudeEngine = { enginePath: string; runtime?: NodeRuntime }

/** Builds the `CodeSession` each engine starts into, once its mode is set up. */
export class EngineStarters {
  constructor(private readonly deps: EngineStarterDeps) {}

  /**
   * One prompt on the profile's model, answered as text, with no session and no
   * tools: for the small asks that are not work on the code and have nothing to
   * keep, such as naming a feature from its description.
   */
  async ask(profile: ModelProfile, prompt: string): Promise<string> {
    return isClaudeEngine(profile.engine) ? await this.askClaude(profile, prompt) : await this.askOpenAi(profile, prompt)
  }

  /**
   * Which Claude Code the profile's engine runs on. One SDK wrapper drives
   * both: which models are on offer comes from the engine it is pointed at,
   * not from the wrapper, so the installed Claude Code reaches models the
   * bundled one was built too early to know. A native engine starts itself
   * and so takes no Node runtime.
   */
  private claudeEngine(profile: ModelProfile): ClaudeEngine {
    if (profile.engine !== 'claude-installed') return { enginePath: this.deps.cliPath, runtime: nodeRuntime() }
    const installed = this.deps.installedClaude()
    if (!installed)
      throw new Error(
        `Profile "${profile.name}" runs on the Claude Code installed on this machine, and none was found. Install Claude Code, or name the path to it in kiwiAgent.claudeCodePath.`,
      )
    return { enginePath: installed }
  }

  private async askClaude(profile: ModelProfile, prompt: string): Promise<string> {
    const { context, workspaceRoot } = this.deps
    const engine = this.claudeEngine(profile)
    const apiKey = profile.apiKeySecret ? await context.secrets.get(secretKey(profile.apiKeySecret)) : undefined
    const run = query({
      prompt,
      options: {
        cwd: workspaceRoot,
        model: profile.model,
        maxTurns: 1,
        // Nothing to read and nothing to settle: the answer is in the prompt, so the
        // project's own settings and instruction files are left out of it too.
        allowedTools: [],
        settingSources: [],
        permissionMode: 'default',
        ...(engine.runtime ? { executable: 'node' as const } : {}),
        pathToClaudeCodeExecutable: engine.enginePath,
        spawnClaudeCodeProcess: spawnWithRuntime(engine.runtime, () => {}),
        ...(apiKey ? { env: { ANTHROPIC_API_KEY: apiKey } } : {}),
      },
    })
    const parts: string[] = []
    for await (const message of run) {
      if (message.type !== 'assistant') continue
      for (const block of message.message.content) if (block.type === 'text') parts.push(block.text)
    }
    return parts.join('')
  }

  private async askOpenAi(profile: ModelProfile, prompt: string): Promise<string> {
    if (!profile.baseUrl) throw new Error(`Profile "${profile.name}" has no baseUrl`)
    if (!profile.apiKeySecret) throw new Error(`Profile "${profile.name}" has no apiKeySecret`)
    const apiKey = await this.deps.context.secrets.get(secretKey(profile.apiKeySecret))
    if (!apiKey) throw new Error(`No API key stored for "${profile.apiKeySecret}". Set it on the provider in Kiwipow Agent settings.`)
    const client = new OpenAiClient({ baseUrl: profile.baseUrl, apiKey })
    const parts: string[] = []
    const abort = new AbortController()
    for await (const delta of client.stream({ model: profile.model, messages: [{ role: 'user', content: prompt }], tools: [], maxTokens: 256, signal: abort.signal })) {
      if (delta.type === 'text') parts.push(delta.text)
    }
    return parts.join('')
  }

  async startClaude({ record, setup, ownTools, mcpServers, skills, whereLine, scratchLine, onProgress }: EngineStart): Promise<CodeSession> {
    const { profile } = record
    const { context, output, workspaceRoot } = this.deps
    // Until the engine reports in, the wait is on its own start-up.
    onProgress('Starting Claude Code')
    const engine = this.claudeEngine(profile)
    // The engine only discovers skills from its own plugin folders and the project's `.claude/skills`,
    // never `.kiwi/skills`; mirroring the already-resolved list into one throwaway plugin folder is
    // what makes a workspace, profile or bundled skill offered here exactly as the other engine sees it.
    const skillsPluginPath = skillsMirrorDir(context, record.id)
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
    const session = new SdkSession({
      ownTools: offered,
      scriptTools,
      ...(mcpServers ? { mcpServers } : {}),
      id: record.id,
      profile,
      cwd: workspaceRoot,
      enginePath: engine.enginePath,
      pluginPath: skillsPluginPath,
      ...(engine.runtime ? { runtime: engine.runtime } : {}),
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
            appendSystemPrompt: `${DOC_READING}\n${CODE_READING}\n${SCRIPT_WRITING}\n${EDIT_WRITING}\n${projectScriptsInstruction(workspaceRoot)}\n${PIPE_WRITING}\n${SPEC_READING}\n${SPEC_AMENDING}\n${SPEC_CHECKING_AFTER_BUILD}\n${CHAT_DECISIONS}\n${memoryWritingInstructions(workspaceRoot)}${chatMemories ? `\n\n${chatMemories}` : ''}${chatInstructionFiles?.length ? `\n\n${instructionsText(chatInstructionFiles)}` : ''}${whereLine}${scratchLine}${toolNaming}`,
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
    // The engine starts every workspace server before it reports in, so a slow one is most of the wait.
    if (mcpServers && Object.keys(mcpServers).length > 0) onProgress('Connecting the MCP servers')
    return session
  }

  async startOpenAi({ record, setup, ownTools, mcpServers, skills, subAgents, whereLine, scratchLine, onProgress }: EngineStart): Promise<CodeSession> {
    const { profile } = record
    const { context, output, workspaceRoot } = this.deps
    if (!profile.baseUrl) throw new Error(`Profile "${profile.name}" has no baseUrl`)
    if (!profile.apiKeySecret) throw new Error(`Profile "${profile.name}" has no apiKeySecret`)
    this.deps.traceStart(record, `reading the API key "${profile.apiKeySecret}"`)
    const apiKey = await context.secrets.get(secretKey(profile.apiKeySecret))
    if (!apiKey) throw new Error(`No API key stored for "${profile.apiKeySecret}". Set it on the provider in Kiwipow Agent settings.`)
    onProgress(`Connecting to ${profile.name}`)
    const client = new OpenAiClient({ baseUrl: profile.baseUrl, apiKey, fetch: this.deps.tracedFetch(record) })
    const baseTools = [readTool, writeTool, editTool, multiEditTool, globTool, grepTool, ...ownTools, bashTool()]
    let delegationCount = 0
    const modelSettings = readModelSettings(this.deps.config)
    // What this session is itself offered, once its phase has narrowed the full set below: a sub agent never
    // reaches past it. Assigned after that set is built; a delegation only ever runs once the session is up.
    let offered: Tool[] = []
    // Never offered to any session's own tool set: they reach the open internet, which only the research
    // sub agent may, so they join a delegation's own pool rather than this session's.
    const networkTools = [webFetchTool(), webSearchTool({ apiKey: () => Promise.resolve(context.secrets.get(secretKey(SEARCH_PROVIDER_SECRET_NAME))) })]
    const delegate = delegateTool(subAgents, (agent, prompt, names, task, opts) =>
      runSubAgent({
        id: `${record.id}:delegate:${++delegationCount}`,
        client,
        profile: subAgentProfile(profile, agent, modelSettings.profiles),
        cwd: workspaceRoot,
        tools: subAgentTools(offered, names, agent?.name === RESEARCH_SUB_AGENT.name ? networkTools : []),
        prompt,
        task,
        // The caller's own rules reach it: a deny blocks it and a write it leaves open is claimed for this session.
        hooks: setup.hooks,
        mode: record.mode,
        ...opts,
      }),
    )
    const allTools = [...baseTools, ...(skills.length ? [skillTool(skills)] : []), delegate]
    // A session that ran before, or continues one that did, picks its conversation up from the run log.
    const resume = record.engineSessionId
      ? { engineSessionId: record.engineSessionId, history: messagesFromEvents(await this.deps.conversation(record.id)) }
      : undefined
    if (resume) this.deps.traceStart(record, `${resume.history.length} messages of history rebuilt`)
    offered = allowed(setup, allTools)
    this.deps.traceStart(record, `building the session: ${offered.map((t) => t.name).join(', ')}`)
    this.deps.setSessionTools(record.id, offered)
    const contextWindow = vscode.workspace.getConfiguration('kiwiAgent').get<Record<string, number>>('contextWindows', {})[profile.model]
    const reasoningEffort = reasoningEffortFor(profile, modelSettings.providers)
    return new OpenAiSession({
      id: record.id,
      profile,
      cwd: workspaceRoot,
      client,
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
