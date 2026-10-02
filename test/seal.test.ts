import { describe, expect, it } from 'vitest'
import { seal, sealEvent, unseal, unsealEvent } from '../src/agent/runs/seal'
import type { SessionEvent } from '../src/agent/session/code-session'

describe('seal', () => {
  it('sealed_text_is_unreadable_and_comes_back_whole', () => {
    const text = 'Read the spec and check every rule against the code. ÅÄÖ ✓'
    const sealed = seal(text)
    expect(sealed).not.toContain('spec')
    expect(unseal(sealed)).toBe(text)
  })

  it('text_that_was_never_sealed_passes_as_it_is', () => {
    expect(unseal('written before sealing')).toBe('written before sealing')
  })

  it('a_kickoff_and_a_tool_results_context_are_sealed_and_the_persons_own_text_is_not', () => {
    const kickoff: SessionEvent = { type: 'user_message', text: 'the kickoff prompt', label: 'Started task 1' }
    const own: SessionEvent = { type: 'user_message', text: 'my own words' }
    const result: SessionEvent = { type: 'tool_result', toolUseId: 't', text: 'ok', isError: false, context: 'hook context' }
    for (const event of [kickoff, result]) {
      const stored = sealEvent(event)
      expect(JSON.stringify(stored)).not.toMatch(/kickoff prompt|hook context/)
      expect(unsealEvent(stored)).toEqual(event)
    }
    expect(sealEvent(own)).toEqual(own)
  })
})
