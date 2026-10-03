import { describe, expect, it } from 'vitest'
import { compactionFocus, NO_FOCUS } from '../src/agent/session/compaction-focus'
import { SUMMARY_PROMPT, summaryPrompt } from '../src/agent/openai-session/compaction'
import { COMPACT_COMMAND, compactCommand } from '../src/agent/sdk-session/compaction'

describe('compaction per phase', () => {
  it('a_task_run_keeps_its_rules_word_for_word_and_carries_on_from_the_board', () => {
    const focus = compactionFocus('implement')
    expect(focus.keep).toContain('word for word, the task as first given with the text of the rules it delivers')
    expect(focus.carryOn).toContain('ReadTasks')
  })

  it('a_fix_run_keeps_the_failing_output_rather_than_a_task', () => {
    const focus = compactionFocus('implement', true)
    expect(focus.keep).toContain('the failing output as first given')
    expect(focus.keep).not.toContain('the rules it delivers')
  })

  it('each_phase_keeps_what_it_cannot_rebuild_cheaply', () => {
    expect(compactionFocus('reconcile').keep).toContain('every disagreement found so far')
    expect(compactionFocus('cleanup').keep).toContain('the units still over their limits')
    expect(compactionFocus('plan').keep).toContain('every answer the user gave')
    expect(compactionFocus('code-plan').keep).toContain('the plan as last agreed, in full')
    expect(compactionFocus('doc-migration').keep).toContain('which stage it is in')
    expect(compactionFocus('file-decisions').keep).toContain('what the user picked')
  })

  it('a_chat_compacts_with_the_general_summary_and_a_carry_on_that_rereads_only_what_it_will_touch', () => {
    expect(compactionFocus('chat')).toEqual(NO_FOCUS)
    expect(NO_FOCUS.carryOn).toContain('read again only the files you will change or check next')
    expect(NO_FOCUS.carryOn).not.toContain('any file whose contents you need')
  })

  it('both_engines_add_the_phases_focus_to_their_own_summary_instruction', () => {
    const keep = compactionFocus('reconcile').keep
    expect(summaryPrompt(keep)).toBe(`${SUMMARY_PROMPT} ${keep}`)
    expect(summaryPrompt('')).toBe(SUMMARY_PROMPT)
    expect(compactCommand(keep)).toBe(`${COMPACT_COMMAND} ${keep}`)
    expect(compactCommand('')).toBe(COMPACT_COMMAND)
  })
})
