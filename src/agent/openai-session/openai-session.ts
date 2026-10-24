import type { CodeSession, McpControl, PermissionDecision, PromptImage, SessionEvent, TurnUsage } from '../session/code-session'
import type { QuestionOutcome } from '../session/user-question'
import type { SessionHooks } from '../session/hooks'
import type { PermissionAsker } from '../permissions/gate'
import type { ModelProfile } from '../session/model-profile'
import { AsyncQueue } from '../session/async-queue'
import type { McpServers } from '../mcp/mcp-config'
import type { McpToolHost } from '../mcp/mcp-tool-host'
import type { ChatCompletionClient, ChatMessage, CompletionRequest, ToolCall } from './chat-messages'
import { ReadTracker } from './tools/read-tracker'
import { modelText, type Tool } from './tools/tool'
import { isContextTooLong } from './compaction'
import type { CompactionFocus } from '../session/compaction-focus'
import { FileLedger } from './file-ledger'
import { errorMessage } from '../../error-message'
import { type StreamedCompletion, streamCompletion } from './completion-stream'
import { dropImages, repairAfterAbort } from './message-repair'
import { PromptBroker } from './prompt-broker'
import { SessionCompactor } from './session-compactor'
import { SessionMcp } from './session-mcp'
import { ToolRunner } from './tool-runner'

/**
 * Room for a reasoning model to think through a task and then write a whole
 * file. Provider defaults are lower, and GLM can spend them on reasoning
 * alone and stop without acting.
 */
const MAX_OUTPUT_TOKENS = 32768

/** A compaction waiting its place in the queue among the user's turns. */
const COMPACT = Symbol('compact')

/** The words beside the images a round of tool calls returned. */
export const TOOL_IMAGES_NOTE = 'The images returned by the tool calls above.'

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
  /** Asks the user as this session's own prompt would; a delegated run takes the caller's own instead of a prompt nobody could answer. */
  ask?: PermissionAsker
  /** Tool rounds per user turn before the engine gives up; a runaway loop costs money. */
  maxRoundsPerTurn?: number
  /** Tokens this model's context holds; a model nobody configured is treated as 128k. */
  contextWindow?: number
  /** Compacts once the prompt is this large, when that comes before the window's share; absent or 0 means the share alone. */
  compactAtTokens?: number
  /** What a compaction must keep for this session's phase; absent for the general summary. */
  compactionFocus?: CompactionFocus
  /** The profile's effort as this endpoint takes it; absent where it takes none. */
  reasoningEffort?: CompletionRequest['reasoningEffort']
  /** The workspace's MCP servers and the host that connects to them; absent on a session that takes none. */
  mcp?: { host: McpToolHost; servers: McpServers }
}

/** What one user turn carries from round to round. */
type TurnState = {
  signal: AbortSignal
  turn: number
  usage: TurnUsage
  started: number
  /** The turn gets one compaction to rescue it from a provider that says the conversation is too long. */
  rescued: boolean
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
  /** User turns waiting, and compactions asked for while no turn ran. */
  private readonly queue: (string | { text: string; images: PromptImage[] } | typeof COMPACT)[] = []
  /** A compaction asked for during a turn; it runs before the turn's next request. */
  private compactRequested = false
  private readonly prompts = new PromptBroker((event) => this.emit(event))
  private readonly mcpTools: SessionMcp
  private readonly compactor: SessionCompactor
  private readonly toolRunner: ToolRunner
  readonly mcp: McpControl | undefined
  private turnAbort = new AbortController()
  private running = false
  private disposed = false
  private turnCounter = 0

  constructor(private readonly options: OpenAiSessionOptions) {
    this.id = options.id
    this.profile = options.profile
    this.messages = [{ role: 'system', content: options.systemPrompt }, ...(options.resume?.history ?? [])]
    const files = new ReadTracker()
    // Where the session has been in the workspace; outlives the messages that say so.
    const ledger = new FileLedger()
    this.mcpTools = new SessionMcp(
      options.tools,
      options.mcp,
      (event) => this.emit(event),
      (message) => this.emitError(message),
    )
    this.mcp = this.mcpTools.control
    this.compactor = new SessionCompactor(
      {
        client: options.client,
        model: options.profile.model,
        cwd: options.cwd,
        contextWindow: options.contextWindow,
        compactAtTokens: options.compactAtTokens,
        compactionFocus: options.compactionFocus,
      },
      this.messages,
      files,
      ledger,
      (event) => this.emit(event),
    )
    this.toolRunner = new ToolRunner(
      { cwd: options.cwd, hooks: options.hooks, ask: options.ask, tools: () => this.mcpTools.tools, files, ledger, prompts: this.prompts },
      (event) => this.emit(event),
    )
    this.emit({ type: 'session_started', engineSessionId: options.resume?.engineSessionId ?? options.id, model: options.profile.model })
    this.mcpTools.start()
  }

  send(text: string, images: PromptImage[] = []): void {
    if (this.disposed) return
    this.queue.push(images.length > 0 ? { text, images } : text)
    if (!this.running) void this.drain()
  }

  compact(): void {
    if (this.disposed) return
    if (this.running) {
      this.compactRequested = true
      return
    }
    this.queue.push(COMPACT)
    void this.drain()
  }

  events(): AsyncIterable<SessionEvent> {
    return this.output
  }

  respondToPermission(requestId: string, decision: PermissionDecision): boolean {
    return this.prompts.respondToPermission(requestId, decision)
  }

  respondToQuestion(requestId: string, outcome: QuestionOutcome): boolean {
    return this.prompts.respondToQuestion(requestId, outcome)
  }

  async interrupt(): Promise<void> {
    this.turnAbort.abort()
    this.prompts.denyPending('Interrupted')
    this.prompts.cancelQuestions('Interrupted')
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.interrupt()
    await this.options.mcp?.host.close()
    this.emit({ type: 'ended' })
    this.output.end()
  }

  private async drain(): Promise<void> {
    this.running = true
    try {
      await this.mcpTools.settled()
      while (this.queue.length > 0 && !this.disposed) {
        const next = this.queue.shift()!
        if (next === COMPACT) {
          await this.compactBetweenTurns()
          continue
        }
        this.messages.push(typeof next === 'string' ? { role: 'user', content: next } : { role: 'user', content: next.text, images: next.images })
        await this.runTurn()
      }
    } finally {
      this.running = false
    }
  }

  private async runTurn(): Promise<void> {
    this.turnAbort = new AbortController()
    const state: TurnState = {
      signal: this.turnAbort.signal,
      turn: ++this.turnCounter,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      started: Date.now(),
      rescued: false,
    }
    try {
      await this.runRounds(state)
    } catch (error) {
      this.failTurn(error, state)
    }
  }

  private async runRounds(state: TurnState): Promise<void> {
    const { signal, usage } = state
    const maxRounds = this.options.maxRoundsPerTurn ?? 50
    for (let round = 1; ; round++) {
      if (round > maxRounds) {
        this.emit({ type: 'error', message: `Stopped after ${maxRounds} tool rounds in one turn`, fatal: false, resumable: true })
        return this.finishTurn(usage, state.started, true, ['max tool rounds'])
      }
      await this.compactIfDue(signal, usage)
      this.emit({ type: 'status', status: 'requesting' })
      const completion = await this.completeOrRescue(state, round)
      if (!completion) continue
      const { assistant, finishReason } = completion
      this.messages.push(assistant)
      // A reply cut mid-thought has not decided anything, and a tool call cut mid-arguments is not the call the model meant.
      if (finishReason === 'length') {
        throw new Error(`The model hit its output limit of ${MAX_OUTPUT_TOKENS} tokens before it finished its reply`)
      }
      if (assistant.toolCalls.length === 0) return this.finishTurn(usage, state.started, false, [])
      await this.runToolCalls(assistant.toolCalls, signal, usage)
      if (signal.aborted) throw new InterruptedError()
    }
  }

  private async compactIfDue(signal: AbortSignal, usage: TurnUsage): Promise<void> {
    if (!this.compactRequested && !this.compactor.due) return
    const asked = this.compactRequested
    this.compactRequested = false
    if (!(await this.compactor.compactNow(signal, usage)) && asked) this.emitError('Nothing old enough to fold into a summary yet')
  }

  /** The completion of a round, or nothing when the provider said the conversation is too long and a compaction made room to try again. */
  private async completeOrRescue(state: TurnState, round: number): Promise<StreamedCompletion | undefined> {
    const { signal, usage } = state
    try {
      return await this.complete(`${state.turn}.${round}`, signal, usage)
    } catch (error) {
      if (state.rescued || signal.aborted || !isContextTooLong(error) || !(await this.compactor.compactNow(signal, usage))) throw error
      state.rescued = true
      return undefined
    }
  }

  private async runToolCalls(calls: ToolCall[], signal: AbortSignal, usage: TurnUsage): Promise<void> {
    const images: PromptImage[] = []
    for (const call of calls) {
      if (signal.aborted) throw new InterruptedError()
      const result = await this.toolRunner.run(call, signal, usage)
      this.emit({
        type: 'tool_result',
        toolUseId: call.id,
        text: result.text,
        isError: result.isError,
        ...(result.context ? { context: result.context } : {}),
        ...(result.subAgent ? { subAgent: result.subAgent } : {}),
      })
      this.messages.push({ role: 'tool', toolCallId: call.id, content: modelText(result) })
      images.push(...(result.images ?? []))
    }
    // A tool message carries only text on this wire, so the pictures follow the round's results as a user message, as pasted ones do.
    if (images.length > 0) this.messages.push({ role: 'user', content: TOOL_IMAGES_NOTE, images })
  }

  private failTurn(error: unknown, state: TurnState): void {
    repairAfterAbort(this.messages)
    if (error instanceof InterruptedError || state.signal.aborted) {
      return this.finishTurn(state.usage, state.started, true, ['interrupted'])
    }
    const dropped = dropImages(this.messages)
    const message = dropped > 0 ? `${errorMessage(error)} (the prompt carried ${dropped} ${dropped === 1 ? 'image' : 'images'}; they are dropped from the conversation)` : errorMessage(error)
    this.emitError(message)
    return this.finishTurn(state.usage, state.started, true, [message])
  }

  private complete(messageId: string, signal: AbortSignal, usage: TurnUsage): Promise<StreamedCompletion> {
    return streamCompletion(
      this.options.client,
      {
        model: this.options.profile.model,
        messages: this.messages,
        tools: this.mcpTools.definitions,
        maxTokens: MAX_OUTPUT_TOKENS,
        ...(this.options.reasoningEffort ? { reasoningEffort: this.options.reasoningEffort } : {}),
        signal,
      },
      messageId,
      usage,
      (event) => this.emit(event),
      (promptTokens) => this.compactor.measured(promptTokens),
    )
  }

  /** A compaction the user asked for while no turn ran; what it costs is not a turn's, so it ends without one. */
  private async compactBetweenTurns(): Promise<void> {
    this.turnAbort = new AbortController()
    const usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    try {
      if (!(await this.compactor.compactNow(this.turnAbort.signal, usage))) this.emitError('Nothing old enough to fold into a summary yet')
    } catch (error) {
      if (!this.turnAbort.signal.aborted) this.emitError(`Compaction failed: ${errorMessage(error)}`)
    }
    this.emit({ type: 'status', status: 'idle' })
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
