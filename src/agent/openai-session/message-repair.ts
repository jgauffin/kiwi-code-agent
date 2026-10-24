import type { ChatMessage } from './chat-messages'
import { UNANSWERED_TOOL_RESULT } from './history'

/**
 * A failed turn may have failed because of its images; the prompt and the work stay,
 * the pictures go, so the next prompt is not sent with them again. Returns how many went.
 */
export function dropImages(messages: ChatMessage[]): number {
  let dropped = 0
  for (const message of messages) {
    if (message.role !== 'user' || !message.images?.length) continue
    dropped += message.images.length
    delete message.images
  }
  return dropped
}

/**
 * An assistant message with tool calls must be answered before the next
 * user message, or the API rejects the history. After an abort, whatever
 * calls are still unanswered get a synthetic result.
 */
export function repairAfterAbort(messages: ChatMessage[]): void {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return
  const answered = new Set<string>()
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role === 'tool') answered.add(m.toolCallId)
    else break
  }
  for (const call of last.toolCalls) {
    if (!answered.has(call.id)) messages.push({ role: 'tool', toolCallId: call.id, content: UNANSWERED_TOOL_RESULT })
  }
}
