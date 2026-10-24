import { describe, expect, it } from 'vitest'
import { compact } from '../src/agent/openai-session/compaction'
import { messagesFromEvents } from '../src/agent/openai-session/history'
import type { ChatMessage } from '../src/agent/openai-session/chat-messages'
import { SdkSession } from '../src/agent/sdk-session/sdk-session'
import type { SessionEvent } from '../src/agent/session/code-session'
import { fakeQuery } from './fake-query'

const image = { mediaType: 'image/png', data: 'QUJD' }

describe('later in the conversation', () => {
  it('a_resumed_own_loop_thread_carries_a_note_in_place_of_each_image_the_message_had', () => {
    const events: SessionEvent[] = [
      { type: 'user_message', text: 'what is this', imageCount: 2 },
      { type: 'user_message', text: '', imageCount: 1 },
    ]
    const messages = messagesFromEvents(events)
    expect(messages[0]).toEqual({ role: 'user', content: 'what is this\n\n[2 images were attached here]' })
    expect(messages[1]).toEqual({ role: 'user', content: '[1 image was attached here]' })
    expect(messages.some((m) => m.role === 'user' && m.images)).toBe(false)
  })

  it('a_claude_engine_thread_resumes_through_the_engines_own_record_with_nothing_rewritten_by_the_extension', () => {
    const fake = fakeQuery()
    new SdkSession({
      id: 'sess-1',
      profile: { name: 'Claude', engine: 'claude-sdk', model: 'opus' },
      cwd: '/w',
      enginePath: '/ext/dist/cli.js',
      runtime: { command: 'node', args: [], env: {} },
      resumeEngineSessionId: 'engine-old',
      query: fake.query,
    })
    expect(fake.options).toMatchObject({ resume: 'engine-old' })
  })

  it('compaction_keeps_the_note_and_drops_the_images_of_the_first_message_and_the_kept_tail', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'assignment', images: [image] },
      { role: 'assistant', content: 'a'.repeat(400), toolCalls: [] },
      { role: 'user', content: 'x'.repeat(400) },
      { role: 'assistant', content: 'b'.repeat(400), toolCalls: [] },
      { role: 'user', content: 'look', images: [image, image] },
      { role: 'assistant', content: 'seen', toolCalls: [] },
    ]
    const result = await compact(messages, async () => 'summary', 200)
    expect(result).toBeDefined()
    expect(result!.messages[1]).toEqual({ role: 'user', content: 'assignment\n\n[1 image was attached here]' })
    expect(result!.messages).toContainEqual({ role: 'user', content: 'look\n\n[2 images were attached here]' })
    expect(result!.messages.some((m) => m.role === 'user' && m.images)).toBe(false)
  })
})
