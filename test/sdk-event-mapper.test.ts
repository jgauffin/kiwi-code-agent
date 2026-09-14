import { describe, expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { SdkEventMapper } from '../src/agent/sdk-session/sdk-event-mapper'
import { initMessage, resultMessage } from './fake-query'

const streamEvent = (event: unknown, parent: string | null = null): SDKMessage =>
  ({ type: 'stream_event', event, parent_tool_use_id: parent, uuid: 'u', session_id: 's' }) as unknown as SDKMessage

describe('SdkEventMapper', () => {
  it('init_announces_engine_session_model_and_version', () => {
    const events = new SdkEventMapper().map(initMessage('abc'))
    expect(events).toEqual([
      { type: 'session_started', engineSessionId: 'abc', model: 'claude-opus-4-7', engineVersion: '2.1.112' },
    ])
  })

  it('text_deltas_carry_the_id_from_the_preceding_message_start', () => {
    const mapper = new SdkEventMapper()
    expect(mapper.map(streamEvent({ type: 'message_start', message: { id: 'msg_1' } }))).toEqual([])
    const events = mapper.map(streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }))
    expect(events).toEqual([{ type: 'assistant_text', messageId: 'msg_1', delta: 'Hel' }])
  })

  it('thinking_deltas_are_separate_from_text', () => {
    const mapper = new SdkEventMapper()
    mapper.map(streamEvent({ type: 'message_start', message: { id: 'msg_1' } }))
    const events = mapper.map(
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }),
    )
    expect(events).toEqual([{ type: 'assistant_thinking', messageId: 'msg_1', delta: 'hmm' }])
  })

  it('assistant_message_yields_tool_calls_and_final_text', () => {
    const msg = {
      type: 'assistant',
      parent_tool_use_id: null,
      uuid: 'u',
      session_id: 's',
      message: {
        id: 'msg_1',
        content: [
          { type: 'text', text: 'Reading ' },
          { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.ts' } },
          { type: 'text', text: 'now.' },
        ],
      },
    } as unknown as SDKMessage
    expect(new SdkEventMapper().map(msg)).toEqual([
      { type: 'tool_call', toolUseId: 'tu_1', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'assistant_message', messageId: 'msg_1', text: 'Reading now.' },
    ])
  })

  it('subagent_output_is_tagged_with_its_parent_tool_use', () => {
    const msg = {
      type: 'assistant',
      parent_tool_use_id: 'tu_agent',
      uuid: 'u',
      session_id: 's',
      message: { id: 'msg_2', content: [{ type: 'text', text: 'inner' }] },
    } as unknown as SDKMessage
    expect(new SdkEventMapper().map(msg)).toEqual([
      { type: 'assistant_message', messageId: 'msg_2', text: 'inner', parentToolUseId: 'tu_agent' },
    ])
  })

  it('tool_results_come_from_user_messages_and_flatten_text_blocks', () => {
    const msg = {
      type: 'user',
      parent_tool_use_id: null,
      uuid: 'u',
      session_id: 's',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: 'line 1' }, { type: 'image' }] },
          { type: 'tool_result', tool_use_id: 'tu_2', content: 'boom', is_error: true },
        ],
      },
    } as unknown as SDKMessage
    expect(new SdkEventMapper().map(msg)).toEqual([
      { type: 'tool_result', toolUseId: 'tu_1', text: 'line 1\n[image]', isError: false },
      { type: 'tool_result', toolUseId: 'tu_2', text: 'boom', isError: true },
    ])
  })

  it('replayed_user_prompts_are_not_mapped_because_the_run_log_has_them', () => {
    const replay = {
      type: 'user',
      isReplay: true,
      parent_tool_use_id: null,
      uuid: 'u',
      session_id: 's',
      message: { role: 'user', content: 'hello again' },
    } as unknown as SDKMessage
    expect(new SdkEventMapper().map(replay)).toEqual([])
  })

  it('result_reports_usage_cost_and_duration', () => {
    expect(new SdkEventMapper().map(resultMessage())).toEqual([
      {
        type: 'turn_done',
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0, costUsd: 0.01 },
        durationMs: 1200,
        isError: false,
        errors: [],
      },
    ])
  })

  it('error_result_without_messages_names_its_subtype', () => {
    const msg = { ...resultMessage(), subtype: 'error_max_turns', is_error: true, errors: [] } as unknown as SDKMessage
    const [event] = new SdkEventMapper().map(msg)
    expect(event).toMatchObject({ type: 'turn_done', isError: true, errors: ['error_max_turns'] })
  })
})
