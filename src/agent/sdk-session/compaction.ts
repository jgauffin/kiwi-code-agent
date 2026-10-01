import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { SessionEvent } from '../session/code-session'
import { compactionPoint } from '../session/compaction-point'
import { errorMessage } from '../../error-message'

/**
 * The share of the engine's window at which a turn is stopped to compact.
 * Compacting sends the whole conversation and writes a summary on top, and
 * the engine refuses a request close to its window, so room is made early.
 */
export const COMPACT_AT = 0.75

/** The engine throws away a summary longer than its output cap and fails the compaction, so the summary is bounded up front. */
export const COMPACT_COMMAND =
  '/compact Keep the summary under 5,000 words: the task, the decisions made, the files touched and what remains. Leave out file contents and tool output; they can be read again.'

export const CARRY_ON =
  'The conversation was compacted to make room. Carry on with the task where you stopped; read again any file whose contents you need.'

type Engine = {
  query: Pick<Query, 'interrupt' | 'getContextUsage'>
  send(text: string): void
  emit(event: SessionEvent): void
}

/**
 * Compaction run by this extension instead of the engine's own: it tracks how
 * full the window is, stops a turn that fills it, has the engine compact, and
 * carries the turn on. The host sees one turn throughout; the stop and the
 * compaction in between never reach it as turns of their own.
 */
export class SdkCompaction {
  private window: number | undefined
  /** Prompts the engine has taken and not yet answered with a result. */
  private busy = 0
  private stage: 'none' | 'stopping' | 'compacting' = 'none'
  /** A turn the host waits on was stopped for this compaction; its end is still owed. */
  private owesTurn = false
  /** The user stopped the session while this compaction ran: the turn ends here. */
  private stopped = false
  private failure: string | undefined
  /** The last prompt the engine was given, the one it answers now. */
  private lastPrompt = ''
  /** The engine refused the prompt as too long; once the turn ends, it is compacted and sent again. */
  private refused = false
  /** What the turn carries on with after this compaction: the refused prompt, or the default nudge. */
  private carryOn = CARRY_ON
  /** The host's prompt was already sent again once; a second refusal ends the turn. */
  private resent = false

  /** `ceilingTokens` compacts sooner than the window's share when it comes first; 0 means none. */
  constructor(
    private readonly engine: Engine,
    private readonly ceilingTokens = 0,
  ) {}

  /** The host sent a prompt to the engine. */
  sent(text: string): void {
    this.busy++
    this.lastPrompt = text
    this.resent = false
  }

  request(): void {
    if (this.stage !== 'none') return
    if (this.busy === 0) return this.startCompacting()
    this.stage = 'stopping'
    this.owesTurn = true
    this.engine.query.interrupt().catch((error: unknown) => this.engine.emit({ type: 'error', message: `Stopping the turn to compact: ${errorMessage(error)}`, fatal: false }))
  }

  /** The user pressed Stop: whatever compaction is under way finishes, but the turn does not carry on. */
  cancel(): void {
    if (this.stage !== 'none') this.stopped = true
  }

  /** The events one engine message maps to, less the turn ends that belong to a compaction. */
  filter(message: SDKMessage, events: SessionEvent[]): SessionEvent[] {
    if (message.type === 'system' && message.subtype === 'init' && this.window === undefined) void this.measure(false)
    if (message.type === 'system' && message.subtype === 'status' && message.compact_result === 'failed') {
      this.failure ??= `Compaction failed: ${message.compact_error ?? 'no reason given'}`
      // The engine tells a failure several times over; finish() reports it once.
      if (this.stage === 'compacting') return events.filter((e) => e.type !== 'error')
    }
    if (isTooLongRefusal(message)) {
      if (this.stage === 'compacting') this.failure = 'Compaction failed: the conversation is too long even to summarise'
      // Answered rather than shown: the turn is compacted and the prompt goes again, once.
      else if (this.stage === 'none' && !this.resent) {
        this.refused = true
        return []
      }
      return events
    }
    // The engine's own failure notice, sent even when it turned /compact down without trying and then reports success.
    const notice = this.stage === 'compacting' ? errorNotice(message) : undefined
    if (notice !== undefined) {
      this.failure ??= `Compaction failed: ${notice}`
      return []
    }
    // A reply the engine made up itself, like its refusal, carries no measure of the window.
    if (message.type === 'assistant' && message.parent_tool_use_id === null && message.message.model !== SYNTHETIC) this.observe(message.message.usage)
    if (message.type !== 'result') return events
    this.busy = Math.max(0, this.busy - 1)
    switch (this.stage) {
      case 'none':
        if (!this.refused) return events
        this.refused = false
        this.resent = true
        this.owesTurn = true
        this.carryOn = this.lastPrompt
        this.startCompacting()
        return []
      case 'stopping':
        if (this.stopped) {
          this.reset()
          return events
        }
        this.startCompacting()
        return events.filter((e) => e.type !== 'turn_done')
      case 'compacting':
        return this.finish(events)
    }
  }

  private startCompacting(): void {
    this.stage = 'compacting'
    this.busy++
    this.engine.send(COMPACT_COMMAND)
  }

  private finish(events: SessionEvent[]): SessionEvent[] {
    const turnDone = events.find((e) => e.type === 'turn_done')
    const rest = events.filter((e) => e !== turnDone)
    const { owesTurn, stopped, failure, carryOn } = this
    this.reset()
    if (!failure) void this.measure(true)
    if (owesTurn && !failure && !stopped) {
      this.busy++
      this.lastPrompt = carryOn
      this.engine.send(carryOn)
      return rest
    }
    if (owesTurn && turnDone) return [...rest, { ...turnDone, isError: true, errors: [failure ?? 'interrupted'] }]
    if (failure) return [...rest, { type: 'error', message: failure, fatal: false }]
    return rest
  }

  private reset(): void {
    this.stage = 'none'
    this.owesTurn = false
    this.stopped = false
    this.failure = undefined
    this.carryOn = CARRY_ON
  }

  /** What the request behind a reply carried is how full the window is now. */
  private observe(usage: { input_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | undefined): void {
    if (!usage || this.window === undefined) return
    const used = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
    this.report(used, this.window)
    if (used >= this.compactAt(this.window) && this.busy > 0) this.request()
  }

  private compactAt(window: number): number {
    return compactionPoint(window, COMPACT_AT, this.ceilingTokens)
  }

  private report(used: number, window: number): void {
    this.engine.emit({ type: 'context_usage', usedTokens: used, windowTokens: window, compactAtTokens: this.compactAt(window) })
  }

  /** The engine's own count, for the window it budgets against and what fills it when no reply has said. */
  private async measure(report: boolean): Promise<void> {
    try {
      const usage = await this.engine.query.getContextUsage()
      this.window = usage.maxTokens
      if (report) this.report(usage.totalTokens, usage.maxTokens)
    } catch (error) {
      this.engine.emit({ type: 'error', message: `Context usage: ${errorMessage(error)}`, fatal: false })
    }
  }
}

/** The model name the engine gives a reply it made up itself rather than got from the API. */
const SYNTHETIC = '<synthetic>'

/** The engine turning a prompt down because the conversation no longer fits, before or instead of asking the API. */
function isTooLongRefusal(message: SDKMessage): boolean {
  if (message.type !== 'assistant' || message.error !== 'invalid_request' || message.parent_tool_use_id !== null) return false
  return message.message.content.some((block) => block.type === 'text' && /prompt is too long/i.test(block.text))
}

/** What a reply the engine made up itself says went wrong, when it is an `Error: …` notice. */
function errorNotice(message: SDKMessage): string | undefined {
  if (message.type !== 'assistant' || message.parent_tool_use_id !== null || message.message.model !== SYNTHETIC) return undefined
  const text = message.message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
  const match = /^Error: (?:Error during compaction: )?([\s\S]*)$/.exec(text)
  return match?.[1]
}
