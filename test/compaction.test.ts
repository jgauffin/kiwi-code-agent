import { describe, expect, it } from 'vitest'
import { compact, estimateTokens, isContextTooLong, keepFrom, pathsReadIn, transcriptFor } from '../src/agent/openai-session/compaction'
import type { ChatMessage } from '../src/agent/openai-session/chat-messages'

const user = (content: string): ChatMessage => ({ role: 'user', content })
const assistant = (content: string, toolCalls: { id: string; name: string; arguments: string }[] = []): ChatMessage => ({
  role: 'assistant',
  content,
  toolCalls,
})
const toolResult = (toolCallId: string, content: string): ChatMessage => ({ role: 'tool', toolCallId, content })

/** Three turns, each a user message, a tool call, its result and a reply. */
function conversation(size: number): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: 'sys' }]
  for (let i = 1; i <= 3; i++) {
    messages.push(user(`ask ${i}`))
    messages.push(assistant('', [{ id: `c${i}`, name: 'Read', arguments: '{"path":"a.ts"}' }]))
    messages.push(toolResult(`c${i}`, 'x'.repeat(size)))
    messages.push(assistant(`answer ${i}`))
  }
  return messages
}

describe('keepFrom', () => {
  it('keeps_whole_turns_until_the_budget_is_spent', () => {
    const messages = conversation(4000)
    // Each turn costs roughly 1000 tokens of tool result; a 2500 budget buys two.
    expect(keepFrom(messages, 2500)).toBe(5)
    expect(messages[5]).toMatchObject({ role: 'user', content: 'ask 2' })
  })

  it('keeps_more_turns_when_the_budget_is_larger', () => {
    const messages = conversation(4000)
    expect(keepFrom(messages, 10_000)).toBe(1)
  })

  it('keeps_the_last_turn_even_when_it_alone_busts_the_budget', () => {
    const messages = conversation(40_000)
    expect(keepFrom(messages, 100)).toBe(9)
    expect(messages[9]).toMatchObject({ role: 'user', content: 'ask 3' })
  })

  it('never_cuts_into_the_system_message', () => {
    expect(keepFrom([{ role: 'system', content: 'sys' }], 10)).toBe(1)
  })
})

describe('estimateTokens', () => {
  it('counts_a_tool_calls_name_and_arguments', () => {
    const bare = estimateTokens(assistant(''))
    expect(estimateTokens(assistant('', [{ id: 'c', name: 'Read', arguments: 'x'.repeat(400) }]))).toBeGreaterThan(bare + 100)
  })
})

describe('transcriptFor', () => {
  it('drops_tool_results_but_keeps_what_was_called', () => {
    const transcript = transcriptFor(conversation(4000).slice(1, 5))
    expect(transcript).toContain('ask 1')
    expect(transcript).toContain('called Read')
    expect(transcript).not.toContain('xxxx')
  })
})

describe('compact', () => {
  it('replaces_the_older_turns_with_a_summary_and_keeps_the_tail', async () => {
    const messages = conversation(4000)
    const result = await compact(messages, async () => 'what happened', 2500)
    expect(result!.messages[0]).toMatchObject({ role: 'system', content: 'sys' })
    expect(result!.messages[1]!.content).toContain('what happened')
    expect(result!.messages.slice(2)).toEqual(messages.slice(5))
  })

  it('hands_the_summariser_only_the_folded_turns', async () => {
    let seen = ''
    await compact(conversation(4000), async (t) => ((seen = t), 'done'), 2500)
    expect(seen).toContain('ask 1')
    expect(seen).not.toContain('ask 2')
  })

  it('gives_up_when_there_is_nothing_older_to_fold', async () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'sys' }, user('only turn')]
    expect(await compact(messages, async () => 'summary', 10)).toBeUndefined()
  })

  it('gives_up_when_the_summariser_says_nothing', async () => {
    expect(await compact(conversation(4000), async () => '  ', 2500)).toBeUndefined()
  })
})

describe('pathsReadIn', () => {
  it('names_the_files_the_remaining_messages_show_being_read', () => {
    const messages = [
      assistant('', [
        { id: 'c1', name: 'Read', arguments: '{"file_path":"src/a.ts"}' },
        { id: 'c2', name: 'Edit', arguments: '{"file_path":"src/b.ts","old_string":"x","new_string":"y"}' },
        { id: 'c3', name: 'Grep', arguments: '{"pattern":"x"}' },
      ]),
    ]
    expect(pathsReadIn(messages)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('ignores_arguments_the_model_never_finished_writing', () => {
    expect(pathsReadIn([assistant('', [{ id: 'c1', name: 'Read', arguments: '{"file_pa' }])])).toEqual([])
  })
})

describe('compact with a ledger', () => {
  it('carries_the_ledger_as_its_own_message_so_the_summariser_cannot_erode_it', async () => {
    const result = await compact(conversation(4000), async () => 'summary', 2500, '- src/a.ts: read 1-40')
    expect(result!.messages[2]!.content).toBe('- src/a.ts: read 1-40')
    expect(result!.kept).toEqual(conversation(4000).slice(5))
  })

  it('adds_no_ledger_message_when_nothing_has_been_touched', async () => {
    const result = await compact(conversation(4000), async () => 'summary', 2500)
    expect(result!.messages).toHaveLength(2 + result!.kept.length)
  })
})

describe('isContextTooLong', () => {
  it('recognises_what_providers_say_when_the_conversation_no_longer_fits', () => {
    expect(isContextTooLong(new Error("This model's maximum context length is 128000 tokens"))).toBe(true)
    expect(isContextTooLong(new Error('prompt is too long: 200000 tokens'))).toBe(true)
    expect(isContextTooLong(new Error('invalid api key'))).toBe(false)
  })
})
