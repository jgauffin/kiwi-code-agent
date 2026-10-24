import { describe, expect, it } from 'vitest'
import { OpenAiClient } from '../src/agent/openai-session/openai-client'
import { OpenAiSession } from '../src/agent/openai-session/openai-session'
import type { ChatCompletionClient, CompletionDelta, CompletionRequest } from '../src/agent/openai-session/chat-messages'
import { SdkSession } from '../src/agent/sdk-session/sdk-session'
import type { SessionEvent } from '../src/agent/session/code-session'
import { MAX_EDGE, needsRedraw, sentSize, sentType } from '../src/chat/webview/image-prep'
import { fakeQuery } from './fake-query'

const image = { mediaType: 'image/png', data: 'QUJD' }
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('the model seeing the image', () => {
  it('on_the_claude_engine_each_attached_image_reaches_the_model_as_image_content_beside_the_text', async () => {
    const fake = fakeQuery()
    const session = new SdkSession({
      id: 's',
      profile: { name: 'Claude', engine: 'claude-sdk', model: 'opus' },
      cwd: '/w',
      enginePath: '/ext/cli.js',
      runtime: { command: 'node', args: [], env: {} },
      query: fake.query,
    })
    session.send('what is this', [image, { mediaType: 'image/jpeg', data: 'REVG' }])
    await tick()
    expect(fake.received[0]!.message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'REVG' } },
      { type: 'text', text: 'what is this' },
    ])
    await session.dispose()
  })

  it('on_the_own_loop_each_attached_image_reaches_the_model_as_image_content_beside_the_text', async () => {
    let body: { messages: { content: unknown }[] } | undefined
    const client = new OpenAiClient({
      baseUrl: 'https://api.example/v1/',
      apiKey: 'k',
      fetch: async (_url, init) => {
        body = JSON.parse(init!.body as string)
        return new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
      },
    })
    for await (const _ of client.stream({
      model: 'm',
      messages: [{ role: 'user', content: 'look', images: [image] }],
      tools: [],
      maxTokens: 10,
      signal: new AbortController().signal,
    })) {
      // drained
    }
    expect(body!.messages[0]!.content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      { type: 'text', text: 'look' },
    ])
  })

  it('the_own_loop_session_hands_the_images_to_the_model_and_emits_no_event_carrying_them', async () => {
    const seen: CompletionRequest[] = []
    const model: ChatCompletionClient = {
      async *stream(request): AsyncIterable<CompletionDelta> {
        seen.push({ ...request, messages: structuredClone(request.messages) })
        yield { type: 'text', text: 'ok' }
        yield { type: 'done', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 } }
      },
    }
    const session = new OpenAiSession({
      id: 's1',
      profile: { name: 'GLM', engine: 'openai-compatible', model: 'glm' },
      cwd: process.cwd(),
      client: model,
      tools: [],
      systemPrompt: 'sys',
    })
    const events: SessionEvent[] = []
    session.send('see', [image])
    for await (const e of session.events()) {
      events.push(e)
      if (e.type === 'turn_done') break
    }
    expect(seen[0]!.messages.find((m) => m.role === 'user')).toMatchObject({ images: [image] })
    expect(JSON.stringify(events)).not.toContain(image.data)
    await session.dispose()
  })

  it('an_image_whose_longer_edge_is_over_2000_px_is_scaled_to_2000_keeping_its_proportions', () => {
    expect(MAX_EDGE).toBe(2000)
    expect(sentSize(4000, 1000)).toEqual({ width: 2000, height: 500 })
    expect(sentSize(1500, 3000)).toEqual({ width: 1000, height: 2000 })
    expect(sentSize(2000, 1999)).toEqual({ width: 2000, height: 1999 })
    expect(needsRedraw('image/png', 2001, 10)).toBe(true)
    expect(needsRedraw('image/png', 2000, 10)).toBe(false)
  })

  it('an_image_in_a_format_other_than_png_jpeg_gif_or_webp_is_converted_to_png', () => {
    for (const kept of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(sentType(kept)).toBe(kept)
      expect(needsRedraw(kept, 10, 10)).toBe(false)
    }
    expect(sentType('image/bmp')).toBe('image/png')
    expect(needsRedraw('image/bmp', 10, 10)).toBe(true)
  })
})
