import { permissionResolved, type CodeSession, type FileEditChange, type McpControl, type PermissionDecision, type SessionEvent, type TurnUsage } from '../session/code-session'
import type { QuestionOutcome, UserQuestionRequest } from '../session/user-question'
import type { SessionHooks, ToolUse } from '../session/hooks'
import { confirmReason, denyReason, gateCall } from '../permissions/gate'
import type { ModelProfile } from '../session/model-profile'
import { AsyncQueue } from '../session/async-queue'
import type { McpServers } from '../mcp/mcp-config'
import type { McpToolHost } from '../mcp/mcp-tool-host'
import type { ChatCompletionClient, ChatMessage, ToolCall, ToolDefinition, Usage } from './chat-messages'
import { ReadTracker } from './tools/read-tracker'
import { toDefinition, type Tool, type ToolContext, type ToolOutput } from './tools/tool'
import { UNANSWERED_TOOL_RESULT } from './history'
import { isAbsolute, resolve } from 'node:path'
import { COMPACT_AT, compact, DEFAULT_CONTEXT_WINDOW, isContextTooLong, KEEP_SHARE, pathsReadIn, SUMMARY_MAX_TOKENS, SUMMARY_PROMPT } from './compaction'
import { FileLedger } from './file-ledger'

/**
 * Room for a reasoning model to think through a task and then write a whole
 * file. Provider defaults are lower, and GLM can spend them on reasoning
 * alone and stop without acting.
 */
const MAX_OUTPUT_TOKENS = 32768

export type OpenAiSessionOptions = {
  id: string
  profile: ModelProfile
  cwd: string
  client: ChatCompletionClient
  tools: Tool[]
  systemPrompt: string
  /** The conversation this session carries on: the id it reports as its engine session, and the messages so far. */
  resume?: { engineSessionId: string; history: ChatMessage[] }
  hooks?: SessionHooks
  /** Tool rounds per user turn before the engine gives up; a runaway loop costs money. */
  maxRoundsPerTurn?: number
  /** Tokens this model's context holds; a model nobody configured is treated as 128k. */
  contextWindow?: number
  /** The workspace's MCP servers and the host that connects to them; absent on a session that takes none. */
  mcp?: { host: McpToolHost; servers: McpServers }
}

/**
 * Our own agent loop over an OpenAI-compatible model: stream a completion,
 * run the tool calls it asked for, feed results back, repeat until it
 * answers without tools. Same events as the Claude engine.
 */
export class OpenAiSession implements CodeSession {
  readonly id: string
  readonly profile: ModelProfile
  private readonly output = new AsyncQueue<SessionEvent>()
  private readonly messages: ChatMessage[]
  private readonly queue: string[] = []
  private readonly files = new ReadTracker()
  /** Where the session has been in the workspace; outlives the messages that say so. */
  private readonly ledger = new FileLedger()
  private readonly pending = new Map<string, (d: PermissionDecision) => void>()
  /** Questions the model put to the user, by the id of the tool call that asked. */
  private readonly questions = new Map<string, (outcome: QuestionOutcome) => void>()
  /** The built-in tools plus what the MCP servers offer now; swapped as one when the servers change. */
  private tools: Tool[]
  private definitions: ToolDefinition[]
  /** MCP changes run one after another; a turn waits for the one in flight before it starts. */
  private mcpChain: Promise<void> = Promise.resolve()
  readonly mcp: McpControl | undefined
  private turnAbort = new AbortController()
  private running = false
  private disposed = false
  private turnCounter = 0
  /** What the last completion said its prompt cost: how full the window is now. */
  private promptTokens = 0

  constructor(private readonly options: OpenAiSessionOptions) {
    this.id = options.id
    this.profile = options.profile
    this.messages = [{ role: 'system', content: options.systemPrompt }, ...(options.resume?.history ?? [])]
    this.tools = options.tools
    this.definitions = options.tools.map(toDefinition)
    this.emit({ type: 'session_started', engineSessionId: options.resume?.engineSessionId ?? options.id, model: options.profile.model })
    const { mcp } = options
    if (mcp) {
      this.mcp = {
        reload: (servers) => this.applyMcp(() => mcp.host.load(servers)),
        reconnect: (name) => this.applyMcp(() => mcp.host.reconnect(name)),
      }
      void this.applyMcp(() => mcp.host.load(mcp.servers))
    }
  }

  send(text: string): void {
    if (this.disposed) return
    this.queue.push(text)
    if (!this.running) void this.drain()
  }

  events(): AsyncIterable<SessionEvent> {
    return this.output
  }

  respondToPermission(requestId: string, decision: PermissionDecision): void {
    const resolve = this.pending.get(requestId)
    if (!resolve) return
    this.pending.delete(requestId)
    this.emit(permissionResolved(requestId, decision))
    resolve(decision)
  }

  respondToQuestion(requestId: string, outcome: QuestionOutcome): boolean {
    const resolve = this.questions.get(requestId)
    if (!resolve) return false
    this.questions.delete(requestId)
    this.emit({ type: 'question_resolved', requestId, outcome })
    resolve(outcome)
    return true
  }

  async interrupt(): Promise<void> {
    this.turnAbort.abort()
    for (const [id, resolve] of this.pending) {
      this.pending.delete(id)
      resolve({ kind: 'deny', message: 'Interrupted' })
    }
    this.cancelQuestions('Interrupted')
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.interrupt()
    await this.options.mcp?.host.close()
    this.emit({ type: 'ended' })
    this.output.end()
  }

  /**
   * One MCP change at a time. A round in flight keeps the definitions it was
   * sent; the next round sees the new set, and a call to a tool that went
   * away fails like any unknown tool.
   */
  private applyMcp(change: () => Promise<void>): Promise<void> {
    const host = this.options.mcp!.host
    this.mcpChain = this.mcpChain
      .then(change)
      .catch((error: unknown) => this.emitError(`MCP servers: ${error instanceof Error ? error.message : String(error)}`))
      .then(() => {
        this.tools = [...this.options.tools, ...host.tools()]
        this.definitions = this.tools.map(toDefinition)
        this.emit({ type: 'mcp_servers', servers: host.statuses() })
      })
    return this.mcpChain
  }

  private async drain(): Promise<void> {
    this.running = true
    try {
      await this.mcpChain
      while (this.queue.length > 0 && !this.disposed) {
        const text = this.queue.shift()!
        this.messages.push({ role: 'user', content: text })
        await this.runTurn()
      }
    } finally {
      this.running = false
    }
  }

  private async runTurn(): Promise<void> {
    this.turnAbort = new AbortController()
    const signal = this.turnAbort.signal
    const turn = ++this.turnCounter
    const usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    const started = Date.now()
    const maxRounds = this.options.maxRoundsPerTurn ?? 50
    /** The turn gets one compaction to rescue it from a provider that says the conversation is too long. */
    let rescued = false
    try {
      for (let round = 1; ; round++) {
        if (round > maxRounds) {
          this.emit({ type: 'error', message: `Stopped after ${maxRounds} tool rounds in one turn`, fatal: false, resumable: true })
          return this.finishTurn(usage, started, true, ['max tool rounds'])
        }
        if (this.promptTokens >= this.contextWindow * COMPACT_AT) await this.compactNow(signal, usage)
        this.emit({ type: 'status', status: 'requesting' })
        let completion: Awaited<ReturnType<OpenAiSession['complete']>>
        try {
          completion = await this.complete(`${turn}.${round}`, signal, usage)
        } catch (error) {
          if (rescued || signal.aborted || !isContextTooLong(error) || !(await this.compactNow(signal, usage))) throw error
          rescued = true
          continue
        }
        const { assistant, finishReason } = completion
        this.messages.push(assistant)
        // A reply cut mid-thought has not decided anything, and a tool call cut mid-arguments is not the call the model meant.
        if (finishReason === 'length') {
          throw new Error(`The model hit its output limit of ${MAX_OUTPUT_TOKENS} tokens before it finished its reply`)
        }
        if (assistant.toolCalls.length === 0) return this.finishTurn(usage, started, false, [])
        for (const call of assistant.toolCalls) {
          if (signal.aborted) throw new InterruptedError()
          const result = await this.runTool(call, signal)
          this.emit({ type: 'tool_result', toolUseId: call.id, text: result.text, isError: result.isError })
          this.messages.push({ role: 'tool', toolCallId: call.id, content: result.text })
        }
        if (signal.aborted) throw new InterruptedError()
      }
    } catch (error) {
      this.repairAfterAbort()
      if (error instanceof InterruptedError || signal.aborted) {
        return this.finishTurn(usage, started, true, ['interrupted'])
      }
      const message = error instanceof Error ? error.message : String(error)
      this.emitError(message)
      return this.finishTurn(usage, started, true, [message])
    }
  }

  /** Streams one completion, emitting deltas, and returns the assembled assistant message. */
  private async complete(
    messageId: string,
    signal: AbortSignal,
    usage: TurnUsage,
  ): Promise<{ assistant: Extract<ChatMessage, { role: 'assistant' }>; finishReason: string | undefined }> {
    let text = ''
    let reasoning = ''
    let finishReason: string | undefined
    const calls = new Map<number, ToolCall>()
    for await (const delta of this.options.client.stream({
      model: this.options.profile.model,
      messages: this.messages,
      tools: this.definitions,
      maxTokens: MAX_OUTPUT_TOKENS,
      signal,
    })) {
      switch (delta.type) {
        case 'text':
          text += delta.text
          this.emit({ type: 'assistant_text', messageId, delta: delta.text })
          break
        case 'reasoning':
          reasoning += delta.text
          this.emit({ type: 'assistant_thinking', messageId, delta: delta.text })
          break
        case 'tool_call_start':
          calls.set(delta.index, { id: delta.id, name: delta.name, arguments: '' })
          break
        case 'tool_call_arguments': {
          const call = calls.get(delta.index)
          if (call) call.arguments += delta.text
          break
        }
        case 'done':
          if (delta.usage) {
            addUsage(usage, delta.usage)
            this.promptTokens = delta.usage.promptTokens
          }
          finishReason = delta.finishReason
          break
      }
    }
    if (text) this.emit({ type: 'assistant_message', messageId, text })
    const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)
    for (const call of toolCalls) {
      const input = parseArguments(call.arguments)
      this.emit({
        type: 'tool_call',
        toolUseId: call.id,
        name: call.name,
        ...(input === undefined ? { input: call.arguments, malformed: true } : { input }),
      })
    }
    return { assistant: { role: 'assistant', content: text, ...(reasoning ? { reasoning } : {}), toolCalls }, finishReason }
  }

  private get contextWindow(): number {
    return this.options.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  }

  /**
   * Folds the older turns into a summary. False when there was nothing old
   * enough to fold: the caller is then out of room and has to say so.
   */
  private async compactNow(signal: AbortSignal, usage: TurnUsage): Promise<boolean> {
    this.emit({ type: 'status', status: 'compacting' })
    const before = this.promptTokens
    const ledger = this.ledger.render(this.options.cwd)
    const result = await compact(this.messages, (t) => this.summarise(t, signal, usage), this.contextWindow * KEEP_SHARE, ledger)
    if (!result) return false
    this.messages.splice(0, this.messages.length, ...result.messages)
    // A file whose read was folded away is one the model can no longer see, whatever the ledger says it once knew.
    this.files.forgetExcept(pathsReadIn(result.kept).map((p) => (isAbsolute(p) ? p : resolve(this.options.cwd, p))))
    this.promptTokens = 0
    this.emit({ type: 'compacted', summary: result.summary, preTokens: before })
    return true
  }

  /** The summary that stands in for the folded turns, written by the session's own model without tools. */
  private async summarise(transcript: string, signal: AbortSignal, usage: TurnUsage): Promise<string> {
    let summary = ''
    for await (const delta of this.options.client.stream({
      model: this.options.profile.model,
      messages: [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: transcript },
      ],
      tools: [],
      maxTokens: SUMMARY_MAX_TOKENS,
      signal,
    })) {
      if (delta.type === 'text') summary += delta.text
      if (delta.type === 'done' && delta.usage) addUsage(usage, delta.usage)
    }
    return summary
  }

  private async runTool(call: ToolCall, signal: AbortSignal): Promise<ToolOutput> {
    const tool = this.tools.find((t) => t.name === call.name)
    if (!tool) return { text: `Unknown tool: ${call.name}`, isError: true }
    const raw = parseArguments(call.arguments)
    if (raw === undefined) return { text: `Tool arguments are not valid JSON: ${call.arguments.slice(0, 200)}`, isError: true }
    const parsed = tool.schema.safeParse(raw)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      return { text: `Invalid arguments for ${tool.name}: ${issues}`, isError: true }
    }
    const use = { toolName: tool.name, input: parsed.data, toolUseId: call.id }
    const gate = await this.gate(tool, use, signal)
    if (gate.refused) return gate.refused
    const pre = gate.pre
    let output: ToolOutput
    try {
      output = await tool.execute(parsed.data, this.contextFor(call.id, signal))
    } catch (error) {
      output = { text: `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true }
    }
    const post = await this.options.hooks?.postToolUse?.({ ...use, output: output.text, isError: output.isError })
    const context = [pre?.additionalContext, post?.additionalContext].filter((c): c is string => !!c)
    return context.length ? { ...output, text: `${output.text}\n\n${context.join('\n\n')}` } : output
  }

  /** The permission decision every call passes, whether the model or a running script makes it. */
  private gate(tool: Tool, use: ToolUse, signal: AbortSignal) {
    return gateCall(this.options.hooks, (id, name, input, shown) => this.askPermission(id, name, input, signal, shown), tool, use)
  }

  /** What a tool gets to work with; a script's calls back into other tools take the same gate as the model's own. */
  private contextFor(callId: string, signal: AbortSignal): ToolContext {
    let nested = 0
    const nextId = () => `${callId}/${++nested}`
    return {
      cwd: this.options.cwd,
      signal,
      files: this.files,
      ledger: this.ledger,
      ask: (request) => this.askUser(callId, request),
      call: (name, input) => this.runTool({ id: nextId(), name, arguments: JSON.stringify(input) }, signal),
      authorize: (name, input) => denyReason(this.options.hooks, { toolName: name, input, toolUseId: nextId() }),
      confirm: (name, input) =>
        confirmReason(this.options.hooks, (id, n, v, shown) => this.askPermission(id, n, v, signal, shown), { toolName: name, input, toolUseId: nextId() }),
      review: (title, edits) => this.askPermission(nextId(), 'RunScript', { files: edits.map((e) => e.label) }, signal, { title, edits }),
    }
  }

  private askPermission(
    toolUseId: string,
    toolName: string,
    input: unknown,
    signal: AbortSignal,
    shown: { title?: string; edits?: FileEditChange[] } = {},
  ): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      this.pending.set(toolUseId, resolve)
      signal.addEventListener('abort', () => {
        if (this.pending.delete(toolUseId)) resolve({ kind: 'deny', message: 'Interrupted' })
      })
      this.emit({ type: 'permission_request', requestId: toolUseId, toolUseId, toolName, input, ...shown })
    })
  }

  /**
   * The model's question to the user. The card decides when this settles, so
   * there is no deadline: the loop holds the tool call open, and the session
   * makes no further progress until the request is resolved one way or the
   * other. The tool call's id is the request's, so the answer comes back as
   * that call's own result.
   */
  private askUser(requestId: string, request: UserQuestionRequest): Promise<QuestionOutcome> {
    return new Promise((resolve) => {
      this.questions.set(requestId, resolve)
      this.emit({ type: 'question_request', requestId, request })
    })
  }

  /** Every question still on screen goes unanswered; the model is never handed a choice the user did not make. */
  private cancelQuestions(reason: string): void {
    for (const [id, resolve] of this.questions) {
      this.questions.delete(id)
      const outcome: QuestionOutcome = { kind: 'unanswered', reason }
      this.emit({ type: 'question_resolved', requestId: id, outcome })
      resolve(outcome)
    }
  }

  /**
   * An assistant message with tool calls must be answered before the next
   * user message, or the API rejects the history. After an abort, whatever
   * calls are still unanswered get a synthetic result.
   */
  private repairAfterAbort(): void {
    const last = this.messages[this.messages.length - 1]
    if (!last || last.role !== 'assistant') return
    const answered = new Set<string>()
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!
      if (m.role === 'tool') answered.add(m.toolCallId)
      else break
    }
    for (const call of last.toolCalls) {
      if (!answered.has(call.id)) this.messages.push({ role: 'tool', toolCallId: call.id, content: UNANSWERED_TOOL_RESULT })
    }
  }

  private finishTurn(usage: TurnUsage, started: number, isError: boolean, errors: string[]): void {
    this.emit({ type: 'status', status: 'idle' })
    this.emit({ type: 'turn_done', usage, durationMs: Date.now() - started, isError, errors })
  }

  private emitError(message: string): void {
    this.emit({ type: 'error', message, fatal: false })
  }

  /**
   * The one way out. A disposed session's stream is closed, and the turn it
   * was in the middle of still unwinds — a question released as unanswered,
   * a tool giving up — so what it has left to say is dropped, not thrown.
   */
  private emit(event: SessionEvent): void {
    if (this.output.isEnded) return
    this.output.push(event)
  }
}

class InterruptedError extends Error {
  constructor() {
    super('interrupted')
  }
}

function addUsage(total: TurnUsage, usage: Usage): void {
  total.inputTokens += usage.promptTokens - usage.cachedTokens
  total.cacheReadTokens += usage.cachedTokens
  total.outputTokens += usage.completionTokens
}

function parseArguments(text: string): unknown {
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
