import { describe, expect, it } from 'vitest'
import { IMPLEMENT_KICKOFF, IMPLEMENT_TOOLS, assertImplementable, implementPrompt } from '../src/agent/phases/implement'
import type { SpecState } from '../src/agent/phases/spec-file'
import { parseTasks, type TasksState } from '../src/agent/phases/tasks-file'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'

const approved: SpecState = { exists: true, status: 'approved', body: '# Order cancellation\n\n## Behaviour\n- B1: a\n' }
const board = (...lines: string[]): TasksState => ({ exists: true, ...parseTasks(lines.join('\n')) })

describe('implement phase', () => {
  it('refuses_to_start_on_a_missing_or_draft_spec', () => {
    expect(() => assertImplementable({ exists: false }, board('- T1: a'))).toThrow(/no spec/i)
    expect(() => assertImplementable({ ...approved, status: 'draft' }, board('- T1: a'))).toThrow(/approved/i)
    expect(() => assertImplementable(approved, board('- T1: a'))).not.toThrow()
  })

  it('refuses_to_start_before_the_spec_is_mapped_against_the_code', () => {
    expect(() => assertImplementable(approved, { exists: false })).toThrow(/map the spec/i)
  })

  it('refuses_to_start_again_on_a_board_whose_every_task_is_tested', () => {
    expect(() => assertImplementable(approved, board('- T1: a [tested]', '- T2: b [tested]'))).toThrow(/every task/i)
    // Done is not tested, and blocked is work left: a fresh session is allowed to pick either up.
    expect(() => assertImplementable(approved, board('- T1: a [tested]', '- T2: b [done]'))).not.toThrow()
    expect(() => assertImplementable(approved, board('- T1: a [tested]', '- T2: b [blocked: needs a decision]'))).not.toThrow()
    // Adding a task to a finished board makes it unfinished again, with nothing to reset.
    expect(() => assertImplementable(approved, board('- T1: a [tested]', '- T2: b'))).not.toThrow()
  })

  it('prompt_names_the_spec_the_tasks_file_and_the_markers_that_carry_progress', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('plan/order-cancellation.tasks.md')
    for (const marker of ['[in progress]', '[done]', '[tested]', '[blocked:']) expect(prompt).toContain(marker)
    expect(prompt).toContain('files:')
    expect(prompt).toContain('docs/')
    expect(IMPLEMENT_TOOLS).toEqual(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'Bash', 'Skill'])
    expect(IMPLEMENT_KICKOFF.length).toBeGreaterThan(0)
  })
})
