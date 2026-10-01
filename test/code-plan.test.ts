import { describe, expect, it } from 'vitest'
import { CODE_PLAN_TOOLS, codePlanPrompt } from '../src/agent/phases/code-plan'
import { SPEC_READING } from '../src/agent/phases/blind-plan'

describe('code plan', () => {
  it('a_code_plan_cannot_change_the_workspace_since_the_build_happens_in_the_chat_it_continues_into', () => {
    for (const tool of ['Write', 'Edit', 'Move', 'Copy', 'Bash', 'RunScript']) expect(CODE_PLAN_TOOLS, tool).not.toContain(tool)
    expect(CODE_PLAN_TOOLS).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob']))
  })

  it('the_intent_is_settled_before_the_code_is_read', () => {
    const prompt = codePlanPrompt('/ws')
    expect(prompt.indexOf('before reading any code')).toBeGreaterThan(-1)
    expect(prompt.indexOf('before reading any code')).toBeLessThan(prompt.indexOf('Continue in chat'))
  })

  it('a_code_plan_keeps_to_the_approved_specs_and_asks_before_breaking_a_rule', () => {
    expect(codePlanPrompt('/ws')).toContain(SPEC_READING)
  })
})
