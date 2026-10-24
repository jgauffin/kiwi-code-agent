import type { SessionEvent, TurnUsage } from '../session/code-session'
import type { ChatCompletionClient, ChatMessage, CompletionRequest, ToolCall, Usage } from './chat-messages'
import { parseArguments } from './tool-arguments'

export type StreamedCompletion = { assistant: Extract<ChatMessage, { role: 'assistant' }>; finishReason: string | undefined }

/**
 * Streams one completion, emitting deltas, and returns the assembled assistant message.
 * `onPromptTokens` hears what the completion said its prompt cost.
 */
export async function streamCompletion(
  client: ChatCompletionClient,
  request: CompletionRequest,
  messageId: string,
  usage: TurnUsage,
  emit: (event: SessionEvent) => void,
  onPromptTokens: (promptTokens: number) => void,
): Promise<StreamedCompletion> {
  let text = ''
  let reasoning = ''
  let finishReason: string | undefined
  const calls = new Map<number, ToolCall>()
  for await (const delta of client.stream(request)) {
    switch (delta.type) {
      case 'text':
        text += delta.text
        emit({ type: 'assistant_text', messageId, delta: delta.text })
        break
      case 'reasoning':
        reasoning += delta.text
        emit({ type: 'assistant_thinking', messageId, delta: delta.text })
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
          onPromptTokens(delta.usage.promptTokens)
          emit({ type: 'reply_usage', messageId, outputTokens: delta.usage.completionTokens })
        }
        finishReason = delta.finishReason
        break
    }
  }
  if (text) emit({ type: 'assistant_message', messageId, text })
  const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)
  for (const call of toolCalls) {
    const input = parseArguments(call.arguments)
    emit({
      type: 'tool_call',
      toolUseId: call.id,
      name: call.name,
      ...(input === undefined ? { input: call.arguments, malformed: true } : { input }),
    })
  }
  return { assistant: { role: 'assistant', content: text, ...(reasoning ? { reasoning } : {}), toolCalls }, finishReason }
}

export function addUsage(total: TurnUsage, usage: Usage): void {
  total.inputTokens += usage.promptTokens - usage.cachedTokens
  total.cacheReadTokens += usage.cachedTokens
  total.outputTokens += usage.completionTokens
}
