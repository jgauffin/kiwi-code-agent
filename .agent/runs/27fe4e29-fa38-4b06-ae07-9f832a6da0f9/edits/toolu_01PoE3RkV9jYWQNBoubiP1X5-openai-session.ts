import type { CodeSession, PermissionDecision, SessionEvent, TurnUsage } from '../session/code-session'
import type { SessionHooks } from '../session/hooks'
import type { ModelProfile } from '../session/model-profile'
import { AsyncQueue } from '../session/async-queue'
import type { ChatCompletionClient, ChatMessage, ToolCall, Usage } from './chat-messages'
import { ReadTracker } from './tools/read-tracker'
import { toDefinition, type Tool, type ToolOutput } from './tools/tool'

export type OpenAiSessionOptions = {
  id: string
  profile: ModelProfile
  cwd: string
  client: ChatCompletionClient
  tools: Tool[]
  systemPrompt: string
  hooks?: SessionHooks
  /** Tool rounds per user turn before the engine gives up; a runaway loop costs money. */
  maxRoundsPerTurn?: number
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
  private readonly pending = new Map<string, (d: PermissionDecision) => void>()
  private readonly definitions
  private turnAbort = new AbortController()
  private running = false
  private disposed = false
  private turnCounter = 0

  constructor(private readonly options: OpenAiSessionOptions) {
    this.id = options.id
    this.profile = options.profile
    this.messages = [{ role: 'system', content: options.systemPrompt }]
    this.definitions = options.tools.map(toDefinition)
    this.output.push({ type: 'session_started', engineSessionId: options.id, model: options.profile.model })
  }

  send(text: string): void {
    if (this.disposed) return
    this.output.push({ type: 'user_message', text })
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
    this.output.push({ type: 'permission_resolved', requestId, decision: decision.kind })
    resolve(decision)
  }

  async interrupt(): Promise<void> {
    this.turnAbort.abort()
    for (const [id, resolve] of this.pending) {
      this.pending.delete(id)
      resolve({ kind: 'deny', message: 'Interrupted' })
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.interrupt()
    this.output.push({ type: 'ended' })
    this.output.end()
  }

  private async drain(): Promise<void> {
    this.running = true
    try {
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
    try {
      for (let round = 1; ; round++) {
        if (round > maxRounds) {
          this.emitError(`Stopped after ${maxRounds} tool rounds in one turn`)
          return this.finishTurn(usage, started, true, ['max tool rounds'])
        }
        this.output.push({ type: 'status', status: 'requesting' })
        const assistant = await this.complete(`${turn}.${round}`, signal, usage)
        this.messages.push(assistant)
        if (assistant.toolCalls.length === 0) return this.finishTurn(usage, started, false, [])
        for (const call of assistant.toolCalls) {
          if (signal.aborted) throw new InterruptedError()
          const result = await this.runTool(call, signal)
          this.output.push({ type: 'tool_result', toolUseId: call.id, text: result.text, isError: result.isError })
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
  ): Promise<Extract<ChatMessage, { role: 'assistant' }>> {
    let text = ''
    let reasoning = ''
    const calls = new Map<number, ToolCall>()
    for await (const delta of this.options.client.stream({
      model: this.options.profile.model,
      messages: this.messages,
      tools: this.definitions,
      signal,
    })) {
      switch (delta.type) {
        case 'text':
          text += delta.text
          this.output.push({ type: 'assistant_text', messageId, delta: delta.text })
          break
        case 'reasoning':
          reasoning += delta.text
          this.output.push({ type: 'assistant_thinking', messageId, delta: delta.text })
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
          if (delta.usage) addUsage(usage, delta.usage)
          break
      }
    }
    if (text) this.output.push({ type: 'assistant_message', messageId, text })
    const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)
    for (const call of toolCalls) {
      this.output.push({
        type: 'tool_call',
        toolUseId: call.id,
        name: call.name,
        input: parseArguments(call.arguments) ?? call.arguments,
      })
    }
    return { role: 'assistant', content: text, ...(reasoning ? { reasoning } : {}), toolCalls }
  }

  private async runTool(call: ToolCall, signal: AbortSignal): Promise<ToolOutput> {
    const tool = this.options.tools.find((t) => t.name === call.name)
    if (!tool) return { text: `Unknown tool: ${call.name}`, isError: true }
    const raw = parseArguments(call.arguments)
    if (raw === undefined) return { text: `Tool arguments are not valid JSON: ${call.arguments.slice(0, 200)}`, isError: true }
    const parsed = tool.schema.safeParse(raw)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      return { text: `Invalid arguments for ${tool.name}: ${issues}`, isError: true }
    }
    const use = { toolName: tool.name, input: parsed.data, toolUseId: call.id }
    const pre = await this.options.hooks?.preToolUse?.(use)
    if (pre && 'deny' in pre) return { text: `Blocked: ${pre.deny}`, isError: true }
    if (!tool.readOnly && !pre?.allow) {
      const decision = await this.askPermission(call.id, tool.name, parsed.data, signal)
      if (decision.kind === 'deny') return { text: `Denied by user${decision.message ? `: ${decision.message}` : ''}`, isError: true }
    }
    let output: ToolOutput
    try {
      output = await tool.execute(parsed.data, { cwd: this.options.cwd, signal, files: this.files })
    } catch (error) {
      output = { text: `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true }
    }
    const post = await this.options.hooks?.postToolUse?.({ ...use, output: output.text, isError: output.isError })
    const context = [pre?.additionalContext, post?.additionalContext].filter((c): c is string => !!c)
    return context.length ? { ...output, text: `${output.text}\n\n${context.join('\n\n')}` } : output
  }

  private askPermission(requestId: string, toolName: string, input: unknown, signal: AbortSignal): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve)
      signal.addEventListener('abort', () => {
        if (this.pending.delete(requestId)) resolve({ kind: 'deny', message: 'Interrupted' })
      })
      this.output.push({ type: 'permission_request', requestId, toolName, input })
    })
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
      if (!answered.has(call.id)) this.messages.push({ role: 'tool', toolCallId: call.id, content: '[interrupted before this tool ran]' })
    }
  }

  private finishTurn(usage: TurnUsage, started: number, isError: boolean, errors: string[]): void {
    this.output.push({ type: 'status', status: 'idle' })
    this.output.push({ type: 'turn_done', usage, durationMs: Date.now() - started, isError, errors })
  }

  private emitError(message: string): void {
    this.output.push({ type: 'error', message, fatal: false })
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
