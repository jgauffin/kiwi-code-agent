import { describe, expect, it } from 'vitest'
import { forDisplay } from '../src/chat/display-event'
import type { SessionEvent } from '../src/agent/session/code-session'

describe('forDisplay', () => {
  it('a_kickoff_reaches_the_chat_as_its_label_only', () => {
    expect(forDisplay({ type: 'user_message', text: 'the kickoff prompt', label: 'Started task 1' })).toEqual({
      type: 'user_message',
      text: '',
      label: 'Started task 1',
    })
  })

  it('what_the_person_typed_is_shown_as_it_is', () => {
    const own: SessionEvent = { type: 'user_message', text: 'my own words' }
    expect(forDisplay(own)).toBe(own)
  })

  it('a_tool_result_reaches_the_chat_without_the_context_only_the_model_reads', () => {
    expect(forDisplay({ type: 'tool_result', toolUseId: 't', text: 'ok', isError: false, context: 'hook context' })).toEqual({
      type: 'tool_result',
      toolUseId: 't',
      text: 'ok',
      isError: false,
    })
  })
})
