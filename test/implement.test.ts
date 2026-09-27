import { describe, expect, it } from 'vitest'
import { IMPLEMENT_TOOLS, assertImplementable, implementKickoff, implementPrompt, implementationStarts } from '../src/agent/phases/implement'
import type { SpecState } from '../src/agent/phases/spec-file'
import { parseTasks, type TasksState } from '../src/agent/phases/tasks-file'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'

const approved: SpecState = { exists: true, status: 'approved', body: '# Order cancellation\n\n## Behaviour\n- B1: a\n' }
const board = (...lines: string[]): TasksState => ({ exists: true, ...parseTasks(lines.join('\n')) })

describe('implement phase', () => {
  it('refuses_to_start_on_a_missing_or_draft_spec', () => {
    expect(() => assertImplementable({ exists: false }, board('- **T1**: a'))).toThrow(/no spec/i)
    expect(() => assertImplementable({ ...approved, status: 'draft' }, board('- **T1**: a'))).toThrow(/approved/i)
    expect(() => assertImplementable(approved, board('- **T1**: a'))).not.toThrow()
  })

  it('refuses_to_start_before_the_spec_is_mapped_against_the_code', () => {
    expect(() => assertImplementable(approved, { exists: false })).toThrow(/map the spec/i)
  })

  it('refuses_to_start_again_on_a_board_whose_every_task_is_tested', () => {
    expect(() => assertImplementable(approved, board('- **T1**: a [tested]', '- **T2**: b [tested]'))).toThrow(/every task/i)
    // Done is not tested, and blocked is work left: a fresh session is allowed to pick either up.
    expect(() => assertImplementable(approved, board('- **T1**: a [tested]', '- **T2**: b [done]'))).not.toThrow()
    expect(() => assertImplementable(approved, board('- **T1**: a [tested]', '- **T2**: b [blocked: needs a decision]'))).not.toThrow()
    // Adding a task to a finished board makes it unfinished again, with nothing to reset.
    expect(() => assertImplementable(approved, board('- **T1**: a [tested]', '- **T2**: b'))).not.toThrow()
  })

  it('the_approved_plan_starts_the_implementation_by_itself_unless_one_is_running_or_the_board_is_finished', () => {
    expect(implementationStarts(approved, board('- **T1**: a'), false)).toBe(true)
    // The approval is what consents to the writes: a draft starts nothing.
    expect(implementationStarts({ ...approved, status: 'draft' }, board('- **T1**: a'), false)).toBe(false)
    expect(implementationStarts({ exists: false }, board('- **T1**: a'), false)).toBe(false)
    expect(implementationStarts(approved, { exists: false }, false)).toBe(false)
    expect(implementationStarts(approved, board('- **T1**: a [tested]'), false)).toBe(false)
    // An implementer already at work needs no second one, and no button to start it.
    expect(implementationStarts(approved, board('- **T1**: a'), true)).toBe(false)
  })

  it('prompt_names_the_spec_the_tasks_file_and_the_markers_that_carry_progress', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('plan/order-cancellation.tasks.md')
    for (const marker of ['[in progress]', '[done]', '[tested]', '[blocked:']) expect(prompt).toContain(marker)
    expect(prompt).toContain('files:')
    // Tested is backed by evidence the user reads on the spec: a test named per delivered rule.
    expect(prompt).toContain('proves:')
    expect(prompt).toContain('<rule name> → <test file> <test name>')
    // The mapping's reading is the starting point, not a search of the code.
    expect(prompt).toContain('context:')
    expect(prompt).toContain('search the code only for what they do not answer')
    expect(prompt).toContain('docs/')
    expect(IMPLEMENT_TOOLS).toEqual(['Read', 'Write', 'Edit', 'Move', 'Copy', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'Bash', 'Skill', 'AskUser'])
  })

  it('the_how_block_is_the_instruction_to_follow_and_not_the_implementers_to_edit', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain('`how:`')
    expect(prompt).toContain('Follow the `how:` block')
    expect(prompt).toContain('only the markers, the `files:` line, the `proves:` line and the `note:` line under a task are yours')
  })

  it('a_departure_from_the_how_block_is_recorded_on_the_tasks_note_line', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain("say so on the task's `note:` line")
    expect(prompt).toContain('  - note: ')
  })

  it('a_finished_task_is_not_read_again', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain('A task marked tested is finished')
    expect(prompt).toContain('not read again')
  })

  it('the_prompt_names_the_configured_test_commands_so_the_implementer_narrows_those', () => {
    const prompt = implementPrompt('Order cancellation', cwd, [
      { match: '**/*.cs', project: '*.csproj', command: 'dotnet test "{project}" --nologo' },
      { match: 'src/**/*.ts', command: 'npm test' },
    ])
    expect(prompt).toContain('`**/*.cs`')
    expect(prompt).toContain('project `*.csproj`')
    expect(prompt).toContain('dotnet test "{project}" --nologo')
    expect(prompt).toContain('`npm test`')
    expect(prompt).toContain('Narrow those same commands')
  })

  it('a_project_with_no_configured_test_command_is_told_to_find_its_own', () => {
    expect(implementPrompt('Order cancellation', cwd)).toContain('No test command is configured')
  })

  it('a_task_is_done_only_once_the_project_holding_its_code_builds', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain('the code is written and the project holding it builds')
    // The project is the unit that builds; there is no sound per-file typecheck to ask for.
    expect(prompt).toContain('not the repository')
  })

  it('a_task_is_tested_only_once_its_named_tests_pass_in_a_run_the_implementer_narrowed', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain('passing in a run you narrowed to it')
    expect(prompt).toContain('Never the whole suite while you work')
    // The sweep is the regression check that follows; promising it invites the implementer to test nothing.
    expect(prompt).not.toContain('the whole test suite is run for you')
  })

  it('a_session_continuing_the_mapping_is_told_the_board_it_wrote_is_the_work', () => {
    const fresh = implementKickoff(undefined)
    expect(fresh).toContain('Implement the spec')
    const mapped = implementKickoff('mapping')
    expect(mapped).toContain('you mapped')
    expect(mapped).toContain('approved')
    expect(mapped).toContain('unless a tool result says')
    expect(mapped).not.toBe(fresh)
    expect(implementKickoff('implement')).toContain('Carry on')
  })
})
