import { isAbsolute, resolve } from 'node:path'
import type { SessionEvent, TurnUsage } from '../session/code-session'
import type { CompactionFocus } from '../session/compaction-focus'
import { compactionPoint } from '../session/compaction-point'
import type { ChatCompletionClient, ChatMessage } from './chat-messages'
import { addUsage } from './completion-stream'
import { COMPACT_AT, compact, DEFAULT_CONTEXT_WINDOW, estimateTokens, KEEP_SHARE, pathsReadIn, SUMMARY_MAX_TOKENS, summaryPrompt } from './compaction'
import type { FileLedger } from './file-ledger'
import type { ReadTracker } from './tools/read-tracker'

export type SessionCompactorOptions = {
  client: ChatCompletionClient
  model: string
  cwd: string
  /** Tokens this model's context holds; a model nobody configured is treated as 128k. */
  contextWindow: number | undefined
  compactAtTokens: number | undefined
  compactionFocus: CompactionFocus | undefined
}

/** Keeps the conversation within the model's window: measures how full it is and folds the older turns into a summary. */
export class SessionCompactor {
  /** What the last completion said its prompt cost: how full the window is now. */
  private promptTokens = 0

  constructor(
    private readonly options: SessionCompactorOptions,
    private readonly messages: ChatMessage[],
    private readonly files: ReadTracker,
    private readonly ledger: FileLedger,
    private readonly emit: (event: SessionEvent) => void,
  ) {}

  /** Whether the prompt has grown to where a compaction is due. */
  get due(): boolean {
    return this.promptTokens >= this.compactAt
  }

  measured(promptTokens: number): void {
    this.promptTokens = promptTokens
    this.reportUsage(promptTokens)
  }

  private get contextWindow(): number {
    return this.options.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  }

  private get compactAt(): number {
    return compactionPoint(this.contextWindow, COMPACT_AT, this.options.compactAtTokens)
  }

  /**
   * Folds the older turns into a summary. False when there was nothing old
   * enough to fold: the caller is then out of room and has to say so.
   */
  async compactNow(signal: AbortSignal, usage: TurnUsage): Promise<boolean> {
    this.emit({ type: 'status', status: 'compacting' })
    const before = this.promptTokens
    const ledger = this.ledger.render(this.options.cwd)
    // The kept tail scales with where compaction happens, so a ceiling well below the window still has something to fold.
    const keepBudget = this.compactAt * (KEEP_SHARE / COMPACT_AT)
    const result = await compact(this.messages, (t) => this.summarise(t, signal, usage), keepBudget, ledger)
    if (!result) return false
    this.messages.splice(0, this.messages.length, ...result.messages)
    // A file whose read was folded away is one the model can no longer see, whatever the ledger says it once knew.
    this.files.forgetExcept(pathsReadIn(result.kept).map((p) => (isAbsolute(p) ? p : resolve(this.options.cwd, p))))
    this.promptTokens = 0
    this.emit({ type: 'compacted', summary: result.summary, preTokens: before })
    // No request has measured the folded conversation yet; the estimate stands in until one does.
    this.reportUsage(this.messages.reduce((sum, m) => sum + estimateTokens(m), 0))
    return true
  }

  private reportUsage(usedTokens: number): void {
    this.emit({ type: 'context_usage', usedTokens, windowTokens: this.contextWindow, compactAtTokens: this.compactAt })
  }

  /** The summary that stands in for the folded turns, written by the session's own model without tools. */
  private async summarise(transcript: string, signal: AbortSignal, usage: TurnUsage): Promise<string> {
    let summary = ''
    for await (const delta of this.options.client.stream({
      model: this.options.model,
      messages: [
        { role: 'system', content: summaryPrompt(this.options.compactionFocus?.keep ?? '') },
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
}
