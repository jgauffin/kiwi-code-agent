import type { SessionEvent } from '../session/code-session'
import type { ChatMessage, ToolCall } from './chat-messages'
import { withImagesNote } from './image-note'
import { modelText } from './tools/tool'

/** What a tool call the log never answered is answered with; the API rejects an assistant message whose calls have no result. */
export const UNANSWERED_TOOL_RESULT = '[interrupted before this tool ran]'

type Assistant = Extract<ChatMessage, { role: 'assistant' }>

/**
 * The conversation an own-loop session had, rebuilt from the events it
 * logged, without the system prompt: that is the new session's own. Events
 * from inside a subagent are not part of the conversation.
 */
export function messagesFromEvents(events: SessionEvent[]): ChatMessage[] {
  const conversation = new Conversation()
  for (const event of events) {
    if ('parentToolUseId' in event && event.parentToolUseId) continue
    conversation.apply(event)
  }
  conversation.settle()
  return conversation.messages
}

class Conversation {
  readonly messages: ChatMessage[] = []
  /** The assistant message being assembled, and the id its deltas carry; a tool-call-only message carries none. */
  private current: { id: string | undefined; message: Assistant } | undefined
  private readonly unanswered = new Set<string>()

  settle(): void {
    for (const id of this.unanswered) this.messages.push({ role: 'tool', toolCallId: id, content: UNANSWERED_TOOL_RESULT })
    this.unanswered.clear()
    this.current = undefined
  }

  apply(event: SessionEvent): void {
    switch (event.type) {
      case 'user_message':
        this.settle()
        this.messages.push({ role: 'user', content: withImagesNote(event.text, event.imageCount ?? 0) })
        break
      case 'assistant_text':
        this.assistant(event.messageId).content += event.delta
        break
      case 'assistant_thinking': {
        const message = this.assistant(event.messageId)
        message.reasoning = (message.reasoning ?? '') + event.delta
        break
      }
      case 'assistant_message':
        this.assistant(event.messageId).content = event.text
        break
      case 'tool_call': {
        const message = this.assistant(undefined)
        message.toolCalls.push(toolCallOf(event))
        this.unanswered.add(event.toolUseId)
        break
      }
      case 'tool_result':
        if (this.unanswered.delete(event.toolUseId)) this.messages.push({ role: 'tool', toolCallId: event.toolUseId, content: modelText(event) })
        if (this.unanswered.size === 0) this.current = undefined
        break
      case 'turn_done':
      case 'ended':
        this.settle()
        break
    }
  }

  private assistant(id: string | undefined): Assistant {
    if (this.current && (id === undefined || this.current.id === id)) return this.current.message
    this.settle()
    this.current = { id, message: { role: 'assistant', content: '', toolCalls: [] } }
    this.messages.push(this.current.message)
    return this.current.message
  }
}

function toolCallOf(event: Extract<SessionEvent, { type: 'tool_call' }>): ToolCall {
  return { id: event.toolUseId, name: event.name, arguments: event.malformed ? (event.input as string) : JSON.stringify(event.input) }
}
