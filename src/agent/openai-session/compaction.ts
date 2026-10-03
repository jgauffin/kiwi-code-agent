import type { ChatMessage } from './chat-messages'

/** What a model whose context window nobody configured is assumed to hold. */
export const DEFAULT_CONTEXT_WINDOW = 128_000

/** The share of the window that, once the prompt fills it, makes the next request compact first. */
export const COMPACT_AT = 0.9

/** The share of the window the turns kept verbatim may fill. */
export const KEEP_SHARE = 0.3

/** Room for the summary itself; it replaces turns worth many times this. */
export const SUMMARY_MAX_TOKENS = 4096

export const SUMMARY_PROMPT = [
  'You are summarising a coding session so it can continue with less context.',
  'Write a dense summary under four headings: what was asked, what was done, what is still open, files touched.',
  'Keep every fact a person would need to carry the work on: decisions made, names of files and symbols, and anything the user insisted on.',
  'Do not speculate and do not offer to help. Write only the summary.',
].join(' ')

/** The summariser's instruction, with what this session's phase must not lose. */
export const summaryPrompt = (keep: string): string => (keep ? `${SUMMARY_PROMPT} ${keep}` : SUMMARY_PROMPT)

/** A first message larger than this is folded like any other: past it, it is a pasted log rather than an assignment. */
export const PINNED_FIRST_MAX_TOKENS = 4000

/** What an earlier compaction left where the first message was; it is summarised again, never kept as the assignment. */
const SUMMARY_LEAD = 'Summary of the conversation so far:'

/**
 * Tokens a message is worth, near enough to decide what to keep. Providers
 * report only the whole prompt's size, so the split has to be made on an
 * estimate; four characters per token is the usual rule for English and code.
 */
export function estimateTokens(message: ChatMessage): number {
  const calls = message.role === 'assistant' ? message.toolCalls.map((c) => c.name + c.arguments).join('') : ''
  const reasoning = message.role === 'assistant' ? (message.reasoning ?? '') : ''
  return Math.ceil((message.content.length + calls.length + reasoning.length) / 4) + 4
}

/**
 * Where the kept tail starts: the earliest user message whose turn and
 * everything after it still fit the budget. The last turn is kept whatever it
 * costs — a conversation compacted down to nothing cannot go on.
 */
export function keepFrom(messages: ChatMessage[], budget: number): number {
  let total = 0
  let keep = messages.length
  for (let i = messages.length - 1; i >= 1; i--) {
    const message = messages[i]!
    total += estimateTokens(message)
    if (message.role !== 'user') continue
    if (keep !== messages.length && total > budget) break
    keep = i
  }
  return keep
}

/**
 * The older half of the conversation as text for the summariser, with tool
 * results left out: they are the bulk of the tokens, and what the calls were
 * for is what the summary needs to carry, not what they returned.
 */
export function transcriptFor(messages: ChatMessage[]): string {
  const lines: string[] = []
  for (const message of messages) {
    switch (message.role) {
      case 'system':
      case 'tool':
        break
      case 'user':
        lines.push(`## User\n${message.content}`)
        break
      case 'assistant': {
        const calls = message.toolCalls.map((c) => `- called ${c.name} ${c.arguments.slice(0, 200)}`)
        lines.push(['## Assistant', message.content, ...calls].filter(Boolean).join('\n'))
        break
      }
    }
  }
  return lines.join('\n\n')
}

/**
 * The first user message, when it is kept verbatim through every compaction:
 * a run's assignment (its task, the exact text of its rules) or the request a
 * session was started on, which a summary would paraphrase. Not a summary an
 * earlier compaction left there, and not one too large to be an assignment.
 */
function pinnedFirst(messages: ChatMessage[], keep: number): ChatMessage | undefined {
  const first = messages[1]
  if (!first || first.role !== 'user' || keep <= 2) return undefined
  if (first.content.startsWith(SUMMARY_LEAD) || estimateTokens(first) > PINNED_FIRST_MAX_TOKENS) return undefined
  return first
}

/**
 * The conversation with its older turns folded into a summary, the first user
 * message kept as it was when it is the session's assignment. Undefined when
 * there is nothing old enough to fold, so a single turn that overflows the
 * window on its own fails loudly instead of being summarised into silence.
 */
export async function compact(
  messages: ChatMessage[],
  summarise: (transcript: string) => Promise<string>,
  budget: number,
  ledger = '',
): Promise<{ messages: ChatMessage[]; summary: string; kept: ChatMessage[] } | undefined> {
  const keep = keepFrom(messages, budget)
  if (keep <= 1) return undefined
  const pinned = pinnedFirst(messages, keep)
  const summary = await summarise(transcriptFor(messages.slice(pinned ? 2 : 1, keep)))
  if (!summary.trim()) return undefined
  const head: ChatMessage[] = [messages[0]!, ...(pinned ? [pinned] : []), { role: 'user', content: `${SUMMARY_LEAD}\n\n${summary}` }]
  if (ledger) head.push({ role: 'user', content: ledger })
  const kept = messages.slice(keep)
  return { messages: [...head, ...kept], summary, kept }
}

/** Tools whose call names a file the model has then seen the contents of. */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit'])

/**
 * The files these messages show being read, as the model wrote the paths. What
 * is still in the conversation is still seen; everything else the session
 * remembers reading has to be read again.
 */
export function pathsReadIn(messages: ChatMessage[]): string[] {
  const paths: string[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const call of message.toolCalls) {
      if (!FILE_TOOLS.has(call.name)) continue
      try {
        const path = (JSON.parse(call.arguments) as { file_path?: unknown }).file_path
        if (typeof path === 'string') paths.push(path)
      } catch {
        // Arguments the model never finished writing name no file worth keeping.
      }
    }
  }
  return paths
}

/** Whether the provider refused the request because the conversation no longer fits. */
export function isContextTooLong(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message}` : String(error)
  return /context (length|window)|too many tokens|prompt is too long|maximum context/i.test(text)
}
