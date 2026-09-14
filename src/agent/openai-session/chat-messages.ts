/** The subset of the OpenAI chat-completions wire format this engine uses. */

export type ToolCall = { id: string; name: string; arguments: string }

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; reasoning?: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export type ToolDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type Usage = { promptTokens: number; completionTokens: number; cachedTokens: number }

/** What streams back from one completion request. */
export type CompletionDelta =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call_start'; index: number; id: string; name: string }
  | { type: 'tool_call_arguments'; index: number; text: string }
  | { type: 'done'; finishReason: string | undefined; usage: Usage | undefined }

export type CompletionRequest = {
  model: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
  signal: AbortSignal
}

export interface ChatCompletionClient {
  stream(request: CompletionRequest): AsyncIterable<CompletionDelta>
}
