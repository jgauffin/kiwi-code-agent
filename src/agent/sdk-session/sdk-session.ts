import type {
  HookCallback,
  HookJSONOutput,
  McpSdkServerConfigWithInstance,
  McpServerConfig,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { CodeSession, McpControl, McpServerState, PermissionDecision, SessionEvent } from '../session/code-session'
import type { McpServers } from '../mcp/mcp-config'
import type { SessionHooks } from '../session/hooks'
import type { ModelProfile } from '../session/model-profile'
import { AsyncQueue } from '../session/async-queue'
import { SdkEventMapper } from './sdk-event-mapper'
import { spawnWithRuntime, type NodeRuntime } from './node-runtime'
import { bareToolName, toolServer } from './tool-server'
import { ReadTracker } from '../openai-session/tools/read-tracker'
import type { Tool, ToolContext } from '../openai-session/tools/tool'
import type { QuestionOutcome, UserQuestionRequest } from '../session/user-question'

type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => Query

export type SdkSessionOptions = {
  id: string
  profile: ModelProfile
  cwd: string
  /** Absolute path to the SDK's cli.js. */
  cliPath: string
  runtime: NodeRuntime
  /** Engine session id from an earlier `session_started`, to continue that conversation. */
  resumeEngineSessionId?: string
  /** Extra environment for the engine process, on top of the host's. */
  env?: Record<string, string>
  hooks?: SessionHooks
  /** Replaces Claude Code's own system prompt; phases use this. */
  systemPrompt?: string
  /** Restricts the built-in tools to these names. */
  tools?: string[]
  /** Tools this extension owns, served to the engine in-process on top of the built-ins. */
  ownTools?: Tool[]
  /** The workspace's MCP servers; absent on a session that takes none. */
  mcpServers?: McpServers
  query: QueryFn
  onStderr?: (chunk: string) => void
  /** Receives one line per engine message, for diagnosing what the engine does and does not send. */
  trace?: (line: string) => void
}

/** A pending server is asked about again this often, this many times: about the engine's own connection deadline. */
const MCP_PENDING_INTERVAL_MS = 2000
const MCP_PENDING_CHECKS = 15

type PendingPermission = {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
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
  private readonly pending = new Map<string, PendingPermission>()
  /** Questions this session's tools put to the user, by request id. */
  private readonly questions = new Map<string, (outcome: QuestionOutcome) => void>()
  private readonly mapper = new SdkEventMapper()
  private readonly abort = new AbortController()
  private readonly query: Query
  private readonly pumping: Promise<void>
  private engineSessionId: string | undefined
  /** What the tools this extension owns run with; a test drives one through it as the engine would. */
  readonly toolContext: ToolContext
  /** The in-process server for the own tools; part of every server set handed to the engine. */
  private readonly ownServer: McpSdkServerConfigWithInstance | undefined
  private mcpServers: McpServers | undefined
  readonly mcp: McpControl | undefined

  constructor(private readonly options: SdkSessionOptions) {
    this.id = options.id
    this.profile = options.profile
    this.engineSessionId = options.resumeEngineSessionId
    this.toolContext = {
      cwd: options.cwd,
      signal: this.abort.signal,
      files: new ReadTracker(),
      ask: (request) => this.askUser(request),
    }
    this.ownServer = options.ownTools?.length ? toolServer(options.ownTools, this.toolContext) : undefined
    this.mcpServers = options.mcpServers
    this.mcp = options.mcpServers ? this.mcpControl() : undefined
    this.query = options.query({ prompt: this.input, options: this.buildOptions() })
    this.pumping = this.pump()
  }

  /** Engine-side id, known after `session_started`. Needed to resume after a reload. */
  get engineSession(): string | undefined {
    return this.engineSessionId
  }

  send(text: string): void {
    this.output.push({ type: 'user_message', text })
    this.input.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    })
  }

  events(): AsyncIterable<SessionEvent> {
    return this.output
  }

  respondToPermission(requestId: string, decision: PermissionDecision): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    this.output.push({ type: 'permission_resolved', requestId, decision: decision.kind })
    pending.resolve(toPermissionResult(decision, pending.input))
  }

  respondToQuestion(requestId: string, outcome: QuestionOutcome): boolean {
    const resolve = this.questions.get(requestId)
    if (!resolve) return false
    this.questions.delete(requestId)
    this.output.push({ type: 'question_resolved', requestId, outcome })
    resolve(outcome)
    return true
  }

  async interrupt(): Promise<void> {
    // The turn is torn down around the card, so the question goes unanswered:
    // stopping a session never answers it, and the model is told so.
    this.cancelQuestions('Interrupted')
    await this.query.interrupt()
  }

  async dispose(): Promise<void> {
    this.denyAllPending('Session closed')
    this.cancelQuestions('Session closed')
    this.input.end()
    this.abort.abort()
    this.query.close()
    // The engine stream normally completes once the process is gone; the
    // timeout covers a process that will not die.
    await Promise.race([this.pumping, new Promise((r) => setTimeout(r, 2000))])
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
      executable: 'node',
      pathToClaudeCodeExecutable: this.options.cliPath,
      spawnClaudeCodeProcess: spawnWithRuntime(this.options.runtime, this.options.onStderr ?? (() => {})),
      canUseTool: (toolName, input, ctx) => this.requestPermission(toolName, input, ctx),
      // Questions go through the own AskUser tool on every engine. The engine's built-in one
      // can only be answered through canUseTool, so left in it lands in the permission prompt.
      disallowedTools: ['AskUserQuestion'],
      env: this.options.env ?? {},
    }
    if (profile.effort) options.effort = profile.effort
    if (this.options.resumeEngineSessionId) options.resume = this.options.resumeEngineSessionId
    if (this.options.hooks) options.hooks = this.sdkHooks(this.options.hooks)
    if (this.options.systemPrompt !== undefined) options.systemPrompt = this.options.systemPrompt
    if (this.options.tools) options.tools = this.options.tools
    // The workspace's servers go in as dynamic ones, which the host can
    // replace; the engine's own reading of the file yields to a dynamic
    // server of the same name.
    const servers = this.allServers()
    if (Object.keys(servers).length) options.mcpServers = servers
    return options
  }

  /** Every server the engine runs with: the own one, then the workspace's. */
  private allServers(): Record<string, McpServerConfig> {
    return {
      ...(this.ownServer ? { [this.ownServer.name]: this.ownServer } : {}),
      ...(this.mcpServers ?? {}),
    }
  }

  private mcpControl(): McpControl {
    return {
      reload: async (servers) => {
        this.mcpServers = servers
        await this.query.setMcpServers(this.allServers())
        await this.reportMcp()
      },
      reconnect: async (name) => {
        // A throw here says what the status says next; the status is what is shown.
        await this.query.reconnectMcpServer(name).catch(() => undefined)
        await this.reportMcp()
      },
    }
  }

  /**
   * The workspace's servers as the engine sees them now; the own server is
   * not the user's business, and an entry the engine read from the file
   * itself yields to the one handed over. A server still connecting is
   * looked at again until it settles or the engine's own deadline passes.
   */
  private async reportMcp(checksLeft = MCP_PENDING_CHECKS): Promise<void> {
    if (this.output.isEnded) return
    try {
      const all = await this.query.mcpServerStatus()
      const byName = new Map<string, (typeof all)[number]>()
      for (const s of all) {
        if (!(s.name in (this.mcpServers ?? {}))) continue
        if (!byName.has(s.name) || s.scope === 'dynamic') byName.set(s.name, s)
      }
      const servers: McpServerState[] = [...byName.values()].map((s) => ({ name: s.name, status: s.status, ...(s.error ? { error: s.error } : {}) }))
      this.output.push({ type: 'mcp_servers', servers })
      if (checksLeft > 0 && servers.some((s) => s.status === 'pending')) {
        setTimeout(() => void this.reportMcp(checksLeft - 1), MCP_PENDING_INTERVAL_MS)
      }
    } catch (error) {
      this.output.push({ type: 'error', message: `MCP status: ${errorMessage(error)}`, fatal: false })
    }
  }

  /** Maps the engine-agnostic hooks onto the SDK's hook protocol. */
  private sdkHooks(hooks: SessionHooks): NonNullable<Options['hooks']> {
    const registered: NonNullable<Options['hooks']> = {}
    if (hooks.preToolUse) {
      const pre = hooks.preToolUse.bind(hooks)
      const callback: HookCallback = async (input): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== 'PreToolUse') return {}
        const outcome = await pre({ toolName: bareToolName(input.tool_name), input: input.tool_input, toolUseId: input.tool_use_id })
        if (outcome && 'deny' in outcome) {
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: outcome.deny } }
        }
        if (!outcome?.allow && !outcome?.additionalContext) return {}
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            ...(outcome.allow ? { permissionDecision: 'allow' } : {}),
            ...(outcome.additionalContext ? { additionalContext: outcome.additionalContext } : {}),
          },
        }
      }
      registered.PreToolUse = [{ hooks: [callback] }]
    }
    if (hooks.postToolUse) {
      const post = hooks.postToolUse.bind(hooks)
      const callback: HookCallback = async (input): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== 'PostToolUse') return {}
        const output = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response)
        const outcome = await post({
          toolName: bareToolName(input.tool_name),
          input: input.tool_input,
          toolUseId: input.tool_use_id,
          output,
          isError: false,
        })
        if (outcome?.additionalContext) {
          return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: outcome.additionalContext } }
        }
        return {}
      }
      registered.PostToolUse = [{ hooks: [callback] }]
    }
    return registered
  }

  private requestPermission(
    toolName: string,
    input: Record<string, unknown>,
    ctx: Parameters<NonNullable<Options['canUseTool']>>[2],
  ): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const requestId = ctx.toolUseID
      this.pending.set(requestId, { resolve, input })
      ctx.signal.addEventListener('abort', () => {
        if (this.pending.delete(requestId)) resolve({ behavior: 'deny', message: 'Cancelled' })
      })
      this.output.push({
        type: 'permission_request',
        requestId,
        toolUseId: ctx.toolUseID,
        toolName: bareToolName(toolName),
        input,
        ...(ctx.title ? { title: ctx.title } : {}),
        ...(ctx.description ? { description: ctx.description } : {}),
      })
    })
  }

  /**
   * A question from one of this session's own tools. The wait has no deadline:
   * the card decides when it settles. Should the engine give up on the tool
   * call before then — its request timeout is its own — the card stays
   * answerable, and the answer reaches the session as its next prompt.
   */
  private askUser(request: UserQuestionRequest): Promise<QuestionOutcome> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()
      this.questions.set(requestId, resolve)
      this.output.push({ type: 'question_request', requestId, request })
    })
  }

  /** Nothing is left waiting: every open question ends unanswered, never with a choice the user did not make. */
  private cancelQuestions(reason: string): void {
    for (const [id, resolve] of this.questions) {
      this.questions.delete(id)
      const outcome: QuestionOutcome = { kind: 'unanswered', reason }
      if (!this.output.isEnded) this.output.push({ type: 'question_resolved', requestId: id, outcome })
      resolve(outcome)
    }
  }

  private denyAllPending(message: string): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.resolve({ behavior: 'deny', message })
    }
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.query) {
        this.options.trace?.(describeMessage(message))
        for (const event of this.mapper.map(message)) {
          if (event.type === 'session_started') this.engineSessionId = event.engineSessionId
          this.output.push(event)
          if (event.type === 'session_started' && this.mcpServers) void this.reportMcp()
        }
      }
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.output.push({ type: 'error', message: errorMessage(error), fatal: true })
      }
    } finally {
      this.denyAllPending('Session ended')
      this.cancelQuestions('Session ended')
      this.finish()
    }
  }

  private finish(): void {
    if (this.output.isEnded) return
    this.output.push({ type: 'ended' })
    this.output.end()
  }
}

/**
 * The engine validates an allow as `{ updatedInput: record }`, so the
 * unchanged input is echoed back; the typings mark it optional but the
 * CLI does not.
 */
function toPermissionResult(decision: PermissionDecision, input: Record<string, unknown>): PermissionResult {
  switch (decision.kind) {
    case 'allow':
      return { behavior: 'allow', updatedInput: input, decisionClassification: 'user_temporary' }
    case 'deny':
      return { behavior: 'deny', message: decision.message ?? 'Denied by user', decisionClassification: 'user_reject' }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
