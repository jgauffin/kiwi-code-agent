import type { SessionEvent } from '../session/code-session'
import type { ChatMessage, ToolCall } from './chat-messages'

/** What a tool call the log never answered is answered with; the API rejects an assistant message whose calls have no result. */
export const UNANSWERED_TOOL_RESULT = '[interrupted before this tool ran]'

type Assistant = Extract<ChatMessage, { role: 'assistant' }>

/**
 * The conversation an own-loop session had, rebuilt from the events it
 * logged, without the system prompt: that is the new session's own. Events
 * from inside a subagent are not part of the conversation.
 */
export function messagesFromEvents(events: SessionEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  /** The assistant message being assembled, and the id its deltas carry; a tool-call-only message carries none. */
  let current: { id: string | undefined; message: Assistant } | undefined
  const unanswered = new Set<string>()

  const settle = (): void => {
    for (const id of unanswered) messages.push({ role: 'tool', toolCallId: id, content: UNANSWERED_TOOL_RESULT })
    unanswered.clear()
    current = undefined
  }
  const assistant = (id: string | undefined): Assistant => {
    if (current && (id === undefined || current.id === id)) return current.message
    settle()
    current = { id, message: { role: 'assistant', content: '', toolCalls: [] } }
    messages.push(current.message)
    return current.message
  }

  for (const event of events) {
    if ('parentToolUseId' in event && event.parentToolUseId) continue
    switch (event.type) {
      case 'user_message':
        settle()
        messages.push({ role: 'user', content: event.text })
        break
      case 'assistant_text':
        assistant(event.messageId).content += event.delta
        break
      case 'assistant_thinking': {
        const message = assistant(event.messageId)
        message.reasoning = (message.reasoning ?? '') + event.delta
        break
      }
      case 'assistant_message':
        assistant(event.messageId).content = event.text
        break
      case 'tool_call': {
        const message = assistant(undefined)
        message.toolCalls.push(toolCallOf(event))
        unanswered.add(event.toolUseId)
        break
      }
      case 'tool_result':
        if (unanswered.delete(event.toolUseId)) messages.push({ role: 'tool', toolCallId: event.toolUseId, content: event.text })
        if (unanswered.size === 0) current = undefined
        break
      case 'turn_done':
      case 'ended':
        settle()
        break
    }
  }
  settle()
  return messages
}

function toolCallOf(event: Extract<SessionEvent, { type: 'tool_call' }>): ToolCall {
  return { id: event.toolUseId, name: event.name, arguments: event.malformed ? (event.input as string) : JSON.stringify(event.input) }
}
