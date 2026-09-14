import { describe, expect, it } from 'vitest'
import { IMPLEMENT_KICKOFF, IMPLEMENT_TOOLS, assertImplementable, implementPrompt } from '../src/agent/phases/implement'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'

describe('implement phase', () => {
  it('refuses_to_start_on_a_missing_or_draft_spec', () => {
    expect(() => assertImplementable({ exists: false })).toThrow(/no spec/i)
    expect(() => assertImplementable({ exists: true, status: 'draft', body: '' })).toThrow(/approved/i)
    expect(() => assertImplementable({ exists: true, status: 'approved', body: '' })).not.toThrow()
  })

  it('prompt_names_the_spec_and_the_task_markers_that_carry_progress', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('[done]')
    expect(prompt).toContain('[blocked:')
    expect(prompt).toContain('docs/')
    expect(IMPLEMENT_TOOLS).toEqual(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Skill'])
    expect(IMPLEMENT_KICKOFF.length).toBeGreaterThan(0)
  })
})
