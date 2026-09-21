import { describe, expect, it } from 'vitest'
import { messagesFromEvents, UNANSWERED_TOOL_RESULT } from '../src/agent/openai-session/history'
import type { SessionEvent } from '../src/agent/session/code-session'

const turnDone: SessionEvent = { type: 'turn_done', isError: false, errors: [] }

describe('messagesFromEvents', () => {
  it('a_logged_turn_folds_back_into_the_messages_the_model_saw', () => {
    const events: SessionEvent[] = [
      { type: 'session_started', engineSessionId: 's1', model: 'glm' },
      { type: 'user_message', text: 'go' },
      { type: 'status', status: 'requesting' },
      { type: 'assistant_thinking', messageId: '1.1', delta: 'hm' },
      { type: 'assistant_thinking', messageId: '1.1', delta: 'm' },
      { type: 'assistant_text', messageId: '1.1', delta: 'Look' },
      { type: 'assistant_text', messageId: '1.1', delta: 'ing' },
      { type: 'assistant_message', messageId: '1.1', text: 'Looking' },
      { type: 'tool_call', toolUseId: 'c1', name: 'Read', input: { path: 'a.ts' } },
      { type: 'permission_request', requestId: 'c1', toolName: 'Read', input: { path: 'a.ts' } },
      { type: 'permission_resolved', requestId: 'c1', decision: 'allow' },
      { type: 'tool_result', toolUseId: 'c1', text: 'const a = 1', isError: false },
      { type: 'status', status: 'requesting' },
      { type: 'tool_call', toolUseId: 'c2', name: 'Read', input: { path: 'b.ts' } },
      { type: 'tool_result', toolUseId: 'c2', text: 'const b = 2', isError: false },
      { type: 'status', status: 'requesting' },
      { type: 'assistant_text', messageId: '1.3', delta: 'done' },
      { type: 'assistant_message', messageId: '1.3', text: 'done' },
      { type: 'status', status: 'idle' },
      turnDone,
    ]
    expect(messagesFromEvents(events)).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'Looking', reasoning: 'hmm', toolCalls: [{ id: 'c1', name: 'Read', arguments: '{"path":"a.ts"}' }] },
      { role: 'tool', toolCallId: 'c1', content: 'const a = 1' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'Read', arguments: '{"path":"b.ts"}' }] },
      { role: 'tool', toolCallId: 'c2', content: 'const b = 2' },
      { role: 'assistant', content: 'done', toolCalls: [] },
    ])
  })

  it('malformed_arguments_are_replayed_as_the_model_wrote_them', () => {
    const events: SessionEvent[] = [
      { type: 'user_message', text: 'go' },
      { type: 'tool_call', toolUseId: 'c1', name: 'Read', input: '{"path":', malformed: true },
      { type: 'tool_result', toolUseId: 'c1', text: 'Tool arguments are not valid JSON', isError: true },
      { type: 'tool_call', toolUseId: 'c2', name: 'Read', input: 'a string' },
      { type: 'tool_result', toolUseId: 'c2', text: 'Invalid arguments', isError: true },
      turnDone,
    ]
    const calls = messagesFromEvents(events).flatMap((m) => (m.role === 'assistant' ? m.toolCalls : []))
    expect(calls.map((c) => c.arguments)).toEqual(['{"path":', '"a string"'])
  })

  it('a_tool_call_the_log_never_answered_gets_a_result_so_the_history_is_accepted', () => {
    const events: SessionEvent[] = [
      { type: 'user_message', text: 'go' },
      { type: 'assistant_text', messageId: '1.1', delta: 'ok' },
      { type: 'tool_call', toolUseId: 'c1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_call', toolUseId: 'c2', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_result', toolUseId: 'c1', text: 'a.ts', isError: false },
      { type: 'user_message', text: 'again' },
      { type: 'tool_call', toolUseId: 'c3', name: 'Bash', input: { command: 'ls' } },
    ]
    expect(messagesFromEvents(events).map((m) => (m.role === 'tool' ? [m.toolCallId, m.content] : m.role))).toEqual([
      'user',
      'assistant',
      ['c1', 'a.ts'],
      ['c2', UNANSWERED_TOOL_RESULT],
      'user',
      'assistant',
      ['c3', UNANSWERED_TOOL_RESULT],
    ])
  })

  it('what_happened_inside_a_subagent_is_not_part_of_the_conversation', () => {
    const events: SessionEvent[] = [
      { type: 'user_message', text: 'go' },
      { type: 'tool_call', toolUseId: 'c1', name: 'Agent', input: {} },
      { type: 'assistant_text', messageId: 'sub', delta: 'inner', parentToolUseId: 'c1' },
      { type: 'tool_call', toolUseId: 'c1-1', name: 'Read', input: {}, parentToolUseId: 'c1' },
      { type: 'tool_result', toolUseId: 'c1-1', text: 'x', isError: false, parentToolUseId: 'c1' },
      { type: 'tool_result', toolUseId: 'c1', text: 'summary', isError: false },
      turnDone,
    ]
    expect(messagesFromEvents(events)).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'Agent', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', content: 'summary' },
    ])
  })
})
