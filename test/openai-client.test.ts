import { describe, expect, it } from 'vitest'
import { ApiError, OpenAiClient } from '../src/agent/openai-session/openai-client'
import type { CompletionDelta } from '../src/agent/openai-session/chat-messages'

function sseResponse(events: unknown[], status = 200): Response {
  const encoder = new TextEncoder()
  const lines = events.map((e) => (typeof e === 'string' ? `data: ${e}\n\n` : `data: ${JSON.stringify(e)}\n\n`))
  // Split at odd byte offsets so the parser has to buffer across chunks.
  const text = lines.join('')
  const chunks = [text.slice(0, 7), text.slice(7, 40), text.slice(40)]
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

async function collect(client: OpenAiClient): Promise<{ deltas: CompletionDelta[]; request: RequestInit | undefined }> {
  const deltas: CompletionDelta[] = []
  for await (const d of client.stream({
    model: 'm',
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'Read', arguments: '{"file_path":"a"}' }] },
      { role: 'tool', toolCallId: 'c1', content: 'file content' },
    ],
    tools: [{ name: 'Read', description: 'reads', parameters: { type: 'object' } }],
    signal: new AbortController().signal,
  })) {
    deltas.push(d)
  }
  return { deltas, request: lastRequest }
}

let lastRequest: RequestInit | undefined

function clientWith(response: Response): OpenAiClient {
  return new OpenAiClient({
    baseUrl: 'https://api.example/v1/',
    apiKey: 'k',
    fetch: async (_url, init) => {
      lastRequest = init
      return response
    },
  })
}

describe('OpenAiClient', () => {
  it('streams_text_reasoning_tool_calls_and_usage_from_sse_split_across_chunks', async () => {
    const client = clientWith(
      sseResponse([
        { choices: [{ delta: { reasoning_content: 'think' } }] },
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Read', arguments: '{"fi' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'le_path":"x"}' } }] }, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 120, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 100 } } },
        '[DONE]',
      ]),
    )
    const { deltas } = await collect(client)
    expect(deltas).toEqual([
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'tool_call_start', index: 0, id: 'call_1', name: 'Read' },
      { type: 'tool_call_arguments', index: 0, text: '{"fi' },
      { type: 'tool_call_arguments', index: 0, text: 'le_path":"x"}' },
      { type: 'done', finishReason: 'tool_calls', usage: { promptTokens: 120, completionTokens: 9, cachedTokens: 100 } },
    ])
  })

  it('sends_the_openai_wire_format_with_tool_calls_and_tool_results', async () => {
    const client = clientWith(sseResponse(['[DONE]']))
    const { request } = await collect(client)
    const body = JSON.parse(request!.body as string)
    expect(body.stream).toBe(true)
    expect(body.messages[2]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a"}' } }],
    })
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'file content' })
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'Read', description: 'reads', parameters: { type: 'object' } } })
    expect((request!.headers as Record<string, string>).authorization).toBe('Bearer k')
  })

  it('non_2xx_response_is_an_api_error_with_status_and_body', async () => {
    const client = clientWith(new Response('{"error":"bad key"}', { status: 401 }))
    await expect(collect(client)).rejects.toMatchObject({ status: 401, body: '{"error":"bad key"}' })
    await expect(collect(client)).rejects.toBeInstanceOf(ApiError)
  })

  it('network_failure_names_the_endpoint_and_the_underlying_cause_instead_of_fetch_failed', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), { code: 'ECONNREFUSED' })
    const client = new OpenAiClient({
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'k',
      fetch: async () => {
        throw new TypeError('fetch failed', { cause })
      },
    })
    await expect(collect(client)).rejects.toThrow(
      'Could not reach http://127.0.0.1:8080/v1/chat/completions: connect ECONNREFUSED 127.0.0.1:8080',
    )
  })

  it('network_failure_lists_every_address_tried_when_node_reports_an_aggregate', async () => {
    const cause = new AggregateError(
      [new Error('connect ECONNREFUSED ::1:8080'), new Error('connect ECONNREFUSED 127.0.0.1:8080')],
      '',
    )
    const client = new OpenAiClient({
      baseUrl: 'http://localhost:8080/v1',
      apiKey: 'k',
      fetch: async () => {
        throw new TypeError('fetch failed', { cause })
      },
    })
    await expect(collect(client)).rejects.toThrow(
      'Could not reach http://localhost:8080/v1/chat/completions: connect ECONNREFUSED ::1:8080; connect ECONNREFUSED 127.0.0.1:8080',
    )
  })

  it('aborting_the_request_is_not_reported_as_a_network_failure', async () => {
    const client = new OpenAiClient({
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'k',
      fetch: async () => {
        throw new DOMException('This operation was aborted', 'AbortError')
      },
    })
    await expect(collect(client)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
