import type { AgentDefinition, McpSdkServerConfigWithInstance, Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { CodeSession, McpControl, PermissionDecision, PromptImage, SessionEvent } from '../session/code-session'
import type { McpServers } from '../mcp/mcp-config'
import type { McpToolHost } from '../mcp/mcp-tool-host'
import type { SessionHooks } from '../session/hooks'
import type { ModelProfile } from '../session/model-profile'
import { AsyncQueue } from '../session/async-queue'
import { SdkEventMapper } from './sdk-event-mapper'
import { SdkCompaction } from './compaction'
import { SdkMcpServers } from './sdk-mcp-servers'
import { SdkPermissions } from './sdk-permissions'
import { sdkHooks } from './sdk-hooks'
import { userMessage } from './sdk-user-message'
import { spawnWithRuntime, type NodeRuntime } from './node-runtime'
import { toolServer } from './tool-server'
import { CLAUDE_OWN_BACKGROUND_OFF_ENV, CLAUDE_OWN_BACKGROUND_TOOLS } from '../background/claude-background'
import { ReadTracker } from '../openai-session/tools/read-tracker'
import { fail, folded, type Tool, type ToolContext } from '../openai-session/tools/tool'
import { confirmReason, denyReason, gateCall, noteCall, reviewEdits, type AskPermission } from '../permissions/gate'
import type { QuestionOutcome } from '../session/user-question'
import { errorMessage } from '../../error-message'
import type { CompactionFocus } from '../session/compaction-focus'

type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => Query

export type SdkSessionOptions = {
  id: string
  profile: ModelProfile
  cwd: string
  /** Absolute path to the Claude Code this session runs on: the bundled engine, or the one installed on the machine. */
  enginePath: string
  /** A plugin folder of skills this extension ships, loaded into the engine. */
  pluginPath?: string
  /** What runs the engine when it is a JavaScript file; absent for a native Claude Code, which runs itself. */
  runtime?: NodeRuntime
  /** Engine session id from an earlier `session_started`, to continue that conversation. */
  resumeEngineSessionId?: string
  /** Extra environment for the engine process, on top of the host's. */
  env?: Record<string, string>
  hooks?: SessionHooks
  /** Replaces Claude Code's own system prompt; phases use this. */
  systemPrompt?: string
  /** Added to Claude Code's own system prompt when `systemPrompt` does not replace it. */
  appendSystemPrompt?: string
  /** Restricts the built-in tools to these names. */
  tools?: string[]
  /** Sub agents registered with the engine, by name, beside its own. */
  agents?: Record<string, AgentDefinition>

  /** Compacts once the conversation is this large, when that comes before the window's share; absent or 0 means the share alone. */
  compactAtTokens?: number
  /** What a compaction must keep for this session's phase, and what the turn carries on with after it. */
  compactionFocus?: CompactionFocus
  /** Tools this extension owns, served to the engine in-process on top of the built-ins. */
  ownTools?: Tool[]
  /** The built-ins a script may call, as our own implementations run in this process; a script reaches the own tools too. */
  scriptTools?: Tool[]
  /** The workspace's MCP servers and what runs them; absent on a session that takes none. */
  mcp?: { host: McpToolHost; servers: McpServers }
  query: QueryFn
  onStderr?: (chunk: string) => void
  /** Receives one line per engine message, for diagnosing what the engine does and does not send. */
  trace?: (line: string) => void
}

/**
 * Claude through the Agent SDK. One `query()` in streaming-input mode per
 * session, so one engine process serves every turn of the conversation.
 */
export class SdkSession implements CodeSession {
  readonly id: string
  readonly profile: ModelProfile
  private readonly input = new AsyncQueue<SDKUserMessage>()
  private readonly output = new AsyncQueue<SessionEvent>()
  private readonly mapper = new SdkEventMapper()
  private readonly abort = new AbortController()
  private readonly permissions = new SdkPermissions(this.output, this.abort.signal)
  private readonly query: Query
  private readonly compaction: SdkCompaction
  private readonly pumping: Promise<void>
  private engineSessionId: string | undefined
  /** What the tools this extension owns run with; a test drives one through it as the engine would. */
  readonly toolContext: ToolContext
  /** The in-process server for the own tools; part of every server set handed to the engine. */
  private readonly ownServer: McpSdkServerConfigWithInstance | undefined
  private readonly mcpServers: SdkMcpServers
  readonly mcp: McpControl | undefined

  constructor(private readonly options: SdkSessionOptions) {
    this.id = options.id
    this.profile = options.profile
    this.engineSessionId = options.resumeEngineSessionId
    this.toolContext = {
      cwd: options.cwd,
      signal: this.abort.signal,
      files: new ReadTracker(),
      ask: (request) => this.permissions.askUser(request),
      ...this.scriptAccess(),
    }
    this.ownServer = options.ownTools?.length ? toolServer(options.ownTools, this.toolContext) : undefined
    this.mcpServers = new SdkMcpServers(this.ownServer, this.output)
    this.mcp = options.mcp
      ? this.mcpServers.control(options.mcp.host, options.mcp.servers, (servers) => this.query.setMcpServers(servers))
      : undefined
    this.query = options.query({ prompt: this.input, options: this.buildOptions() })
    this.compaction = new SdkCompaction({
      query: this.query,
      send: (text) => this.prompt(text),
      emit: (event) => {
        if (!this.output.isEnded) this.output.push(event)
      },
    }, options.compactAtTokens, options.compactionFocus)
    this.pumping = this.pump()
  }

  /** Engine-side id, known after `session_started`. Needed to resume after a reload. */
  get engineSession(): string | undefined {
    return this.engineSessionId
  }

  send(text: string, images: PromptImage[] = []): void {
    this.compaction.sent(text)
    this.prompt(text, images)
  }

  compact(): void {
    this.compaction.request()
  }

  private prompt(text: string, images: PromptImage[] = []): void {
    this.input.push(userMessage(text, images))
  }

  events(): AsyncIterable<SessionEvent> {
    return this.output
  }

  respondToPermission(requestId: string, decision: PermissionDecision): boolean {
    return this.permissions.respondToPermission(requestId, decision)
  }

  respondToQuestion(requestId: string, outcome: QuestionOutcome): boolean {
    return this.permissions.respondToQuestion(requestId, outcome)
  }

  async interrupt(): Promise<void> {
    // The turn is torn down around the card, so the question goes unanswered:
    // stopping a session never answers it, and the model is told so.
    this.permissions.cancelQuestions('Interrupted')
    this.compaction.cancel()
    await this.query.interrupt()
  }

  async dispose(): Promise<void> {
    this.permissions.denyAllPending('Session closed')
    this.permissions.cancelQuestions('Session closed')
    this.input.end()
    this.abort.abort()
    this.query.close()
    // The engine stream normally completes once the process is gone; the
    // timeout covers a process that will not die.
    await Promise.race([this.pumping, new Promise((r) => setTimeout(r, 2000))])
    // The servers run in this process, not the engine's, so they outlive it unless closed here.
    await this.options.mcp?.host.close()
    this.finish()
  }

  private buildOptions(): Options {
    const { profile } = this.options
    const options: Options = {
      abortController: this.abort,
      cwd: this.options.cwd,
      model: profile.model,
      permissionMode: 'default',
      includePartialMessages: true,
      // Project settings so the workspace's .claude/ and CLAUDE.md apply; not
      // the user's global settings, which belong to this machine, not the repo.
      settingSources: ['project', 'local'],
      ...(this.options.pluginPath ? { plugins: [{ type: 'local' as const, path: this.options.pluginPath }] } : {}),
      ...(this.options.runtime ? { executable: 'node' as const } : {}),
      pathToClaudeCodeExecutable: this.options.enginePath,
      spawnClaudeCodeProcess: spawnWithRuntime(this.options.runtime, this.options.onStderr ?? (() => {})),
      canUseTool: (toolName, input, ctx) => this.permissions.request(toolName, input, ctx),
      // Questions go through the own AskUser tool on every engine. The engine's built-in one
      // can only be answered through canUseTool, so left in it lands in the permission prompt.
      disallowedTools: ['AskUserQuestion', ...CLAUDE_OWN_BACKGROUND_TOOLS],
      // Compaction is this session's to run (SdkCompaction): the engine's own
      // can fail without a word and leave the turn to overflow its window.
      env: { ...(this.options.env ?? {}), DISABLE_AUTO_COMPACT: '1', ...CLAUDE_OWN_BACKGROUND_OFF_ENV },
      // Memory is this session's to write, through the ordinary tools and the hook that
      // validates and caps it; the engine's own hidden auto-memory tool would otherwise
      // write the same project folder on its own, unseen by that hook.
      settings: { autoMemoryEnabled: false },
    }
    if (profile.effort) options.effort = profile.effort
    if (this.options.resumeEngineSessionId) options.resume = this.options.resumeEngineSessionId
    if (this.options.hooks) options.hooks = sdkHooks(this.options.hooks)
    if (this.options.systemPrompt !== undefined) options.systemPrompt = this.options.systemPrompt
    else if (this.options.appendSystemPrompt !== undefined)
      options.systemPrompt = { type: 'preset', preset: 'claude_code', append: this.options.appendSystemPrompt }
    if (this.options.tools) options.tools = this.options.tools
    if (this.options.agents) options.agents = this.options.agents
    // The workspace's servers go in as dynamic ones, which the host can
    // replace; the engine's own reading of the file yields to a dynamic
    // server of the same name, so it never spawns them itself.
    const servers = this.mcpServers.all()
    if (Object.keys(servers).length) options.mcpServers = servers
    return options
  }

  /**
   * What a script gets on this engine. Claude's built-in tools run in the
   * engine's process, out of reach, so a script's calls run our own
   * implementations of them here, through the same permission gate.
   */
  private scriptAccess(): Pick<ToolContext, 'call' | 'authorize' | 'confirm' | 'review' | 'observed'> {
    const ask: AskPermission = (id, toolName, input, shown) => this.permissions.askScript(id, toolName, input, shown)
    const use = (toolName: string, input: unknown) => ({ toolName, input, toolUseId: crypto.randomUUID() })
    return {
      call: async (name, input) => {
        const tool = [...(this.options.ownTools ?? []), ...(this.options.scriptTools ?? [])].find((t) => t.name === name)
        if (!tool) return fail(`Unknown tool: ${name}`)
        const parsed = tool.schema.safeParse(input)
        if (!parsed.success) return fail(`Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
        const gate = await gateCall(this.options.hooks, ask, tool, use(name, parsed.data))
        if (gate.refused) return gate.refused
        try {
          return folded(await tool.execute(parsed.data, this.toolContext))
        } catch (error) {
          return fail(`${name} failed: ${errorMessage(error)}`)
        }
      },
      authorize: (name, input) => denyReason(this.options.hooks, use(name, input)),
      confirm: (name, input) => confirmReason(this.options.hooks, ask, use(name, input)),
      review: (title, edits) => reviewEdits(this.options.hooks, ask, use('RunScript', { files: edits.map((e) => e.label) }), { title, edits }),
      observed: (name, input) => noteCall(this.options.hooks, use(name, input)),
    }
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.query) {
        this.options.trace?.(describeMessage(message))
        for (const event of this.compaction.filter(message, this.mapper.map(message))) {
          if (event.type === 'session_started') this.engineSessionId = event.engineSessionId
          this.output.push(event)
          if (event.type === 'session_started' && this.options.mcp) this.mcpServers.report(this.options.mcp.host)
        }
      }
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.output.push({ type: 'error', message: errorMessage(error), fatal: true })
      }
    } finally {
      this.permissions.denyAllPending('Session ended')
      this.permissions.cancelQuestions('Session ended')
      this.finish()
    }
  }

  private finish(): void {
    if (this.output.isEnded) return
    this.output.push({ type: 'ended' })
    this.output.end()
  }
}

/** One line per engine message: kind, and for stream events the raw event and delta kinds. */
export function describeMessage(msg: SDKMessage): string {
  switch (msg.type) {
    case 'stream_event': {
      const event = msg.event as { type: string; delta?: { type?: string }; content_block?: { type?: string } }
      const detail = event.delta?.type ?? event.content_block?.type
      return `stream_event ${event.type}${detail ? ` ${detail}` : ''}`
    }
    case 'system':
      return `system ${msg.subtype}${'status' in msg ? ` ${String(msg.status)}` : ''}`
    case 'assistant':
      return `assistant [${msg.message.content.map((b) => b.type).join(', ')}]`
    case 'user': {
      const content = msg.message.content
      return `user ${typeof content === 'string' ? 'text' : `[${content.map((b) => b.type).join(', ')}]`}`
    }
    case 'result':
      return `result ${msg.subtype} ${msg.duration_ms}ms`
    default:
      return msg.type
  }
}
