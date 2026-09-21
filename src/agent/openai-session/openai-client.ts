import type { ChatCompletionClient, ChatMessage, CompletionDelta, CompletionRequest, Usage } from './chat-messages'

export type OpenAiClientOptions = {
  baseUrl: string
  apiKey: string
  fetch?: typeof fetch
}

/**
 * Streaming chat completions against an OpenAI-compatible endpoint with
 * plain fetch and SSE parsing. Reasoning arrives as `reasoning_content`
 * on the delta, which is what GLM and Kimi emit.
 */
export class OpenAiClient implements ChatCompletionClient {
  private readonly fetchFn: typeof fetch

  constructor(private readonly options: OpenAiClientOptions) {
    this.fetchFn = options.fetch ?? fetch
  }

  async *stream(request: CompletionRequest): AsyncIterable<CompletionDelta> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`
    let response: Response
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map(toWire),
          tools: request.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: request.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new NetworkError(url, error)
    }
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      throw new ApiError(response.status, text)
    }
    let finishReason: string | undefined
    let usage: Usage | undefined
    for await (const data of sseData(response.body)) {
      if (data === '[DONE]') break
      const chunk = JSON.parse(data) as Chunk
      if (chunk.error) throw new ApiError(0, JSON.stringify(chunk.error))
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
        }
      }
      const choice = chunk.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta
      if (!delta) continue
      if (delta.reasoning_content) yield { type: 'reasoning', text: delta.reasoning_content }
      if (delta.content) yield { type: 'text', text: delta.content }
      for (const call of delta.tool_calls ?? []) {
        if (call.id) yield { type: 'tool_call_start', index: call.index, id: call.id, name: call.function?.name ?? '' }
        if (call.function?.arguments) yield { type: 'tool_call_arguments', index: call.index, text: call.function.arguments }
      }
    }
    yield { type: 'done', finishReason, usage }
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(status ? `API error ${status}: ${body.slice(0, 500)}` : `API error: ${body.slice(0, 500)}`)
  }
}

/**
 * The request never got an HTTP response. Node's fetch says only "fetch
 * failed" and hides the reason (refused connection, unknown host, bad
 * certificate) in `cause`, so this surfaces it along with the URL tried.
 */
export class NetworkError extends Error {
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    super(`Could not reach ${url}: ${describe(cause)}`, { cause })
  }
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const inner = error.cause
  if (inner !== undefined && inner !== null && error.message === 'fetch failed') return describe(inner)
  const parts = [error.message]
  if (error instanceof AggregateError) {
    // Happy Eyeballs: one attempt per address family, each with its own reason.
    parts.push(...error.errors.map(describe))
  }
  return parts.filter(Boolean).join('; ') || error.name
}

type Chunk = {
  error?: unknown
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
  choices?: {
    finish_reason?: string | null
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
    }
  }[]
}

function toWire(message: ChatMessage): Record<string, unknown> {
  switch (message.role) {
    case 'system':
    case 'user':
      return { role: message.role, content: message.content }
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls.length
          ? {
              tool_calls: message.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: c.arguments },
              })),
            }
          : {}),
      }
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
}

/** Yields the `data:` payload of each SSE event. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let boundary: number
    while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '')
      const data = raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data) yield data
    }
  }
}
