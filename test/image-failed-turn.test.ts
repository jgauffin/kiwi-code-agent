import { describe, expect, it } from 'vitest'
import { OpenAiSession } from '../src/agent/openai-session/openai-session'
import type { ChatCompletionClient, CompletionDelta, CompletionRequest } from '../src/agent/openai-session/chat-messages'
import type { SessionEvent } from '../src/agent/session/code-session'

const image = { mediaType: 'image/png', data: 'QUJD' }

describe('when a turn with images fails', () => {
  it('a_failed_turn_with_images_names_the_image_count_keeps_the_prompt_and_drops_the_images_on_the_own_loop', async () => {
    const seen: CompletionRequest[] = []
    let calls = 0
    const model: ChatCompletionClient = {
      async *stream(request): AsyncIterable<CompletionDelta> {
        seen.push({ ...request, messages: structuredClone(request.messages) })
        if (++calls === 1) throw new Error('model cannot read images')
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
    const untilTurnDone = async () => {
      for await (const e of session.events()) {
        events.push(e)
        if (e.type === 'turn_done') return
      }
    }
    session.send('see', [image, image])
    await untilTurnDone()
    const error = events.find((e) => e.type === 'error')
    expect(error).toMatchObject({ message: expect.stringContaining('2 images') })

    session.send('again')
    await untilTurnDone()
    const next = seen[1]!.messages.filter((m) => m.role === 'user')
    expect(next.map((m) => m.content)).toEqual(['see', 'again'])
    expect(next.some((m) => 'images' in m)).toBe(false)
    await session.dispose()
  })
})
