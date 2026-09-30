import { describe, expect, it } from 'vitest'
import { IMPLEMENT_TOOLS, assertImplementable, fixKickoff, implementPrompt, implementationStarts, taskKickoff, taskSettled } from '../src/agent/phases/implement'
import { decisions } from '../src/agent/phases/decisions'
import type { SpecState } from '../src/agent/phases/spec-file'
import { parseSpecText } from '../src/agent/phases/spec-model'
import { UNFILED_DECISIONS } from '../src/agent/phases/unfiled-decisions'
import { board as boardOf, task, tasksState as board } from './task-board-fixture'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'

const approved: SpecState = { exists: true, status: 'approved', body: '# Order cancellation\n\n## Behaviour\n- B1: a\n' }
const open = task('T1')
const tested = (name: string) => task(name, { state: 'tested' })

describe('implement phase', () => {
  it('refuses_to_start_on_a_missing_or_draft_spec', () => {
    expect(() => assertImplementable({ exists: false }, board(open))).toThrow(/no spec/i)
    expect(() => assertImplementable({ ...approved, status: 'draft' }, board(open))).toThrow(/approved/i)
    expect(() => assertImplementable(approved, board(open))).not.toThrow()
  })

  it('refuses_to_start_before_the_spec_is_checked_against_the_code', () => {
    expect(() => assertImplementable(approved, { exists: false })).toThrow(/checked against the code/i)
  })

  it('refuses_to_start_again_on_a_board_whose_every_task_is_tested', () => {
    expect(() => assertImplementable(approved, board(tested('T1'), tested('T2')))).toThrow(/every task/i)
    // Done is not tested, and blocked is work left: a fresh session is allowed to pick either up.
    expect(() => assertImplementable(approved, board(tested('T1'), task('T2', { state: 'done' })))).not.toThrow()
    expect(() => assertImplementable(approved, board(tested('T1'), task('T2', { state: 'blocked', blockedReason: 'needs a decision' })))).not.toThrow()
    // Adding a task to a finished board makes it unfinished again, with nothing to reset.
    expect(() => assertImplementable(approved, board(tested('T1'), task('T2')))).not.toThrow()
  })

  it('the_approved_plan_starts_the_implementation_by_itself_unless_one_is_running_or_the_board_is_finished', () => {
    expect(implementationStarts(approved, board(open), false)).toBe(true)
    // The approval is what consents to the writes: a draft starts nothing.
    expect(implementationStarts({ ...approved, status: 'draft' }, board(open), false)).toBe(false)
    expect(implementationStarts({ exists: false }, board(open), false)).toBe(false)
    expect(implementationStarts(approved, { exists: false }, false)).toBe(false)
    expect(implementationStarts(approved, board(tested('T1')), false)).toBe(false)
    // An implementer already at work needs no second one, and no button to start it.
    expect(implementationStarts(approved, board(open), true)).toBe(false)
  })

  it('prompt_names_the_spec_and_the_board_tools_that_carry_progress', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('ReadTasks')
    expect(prompt).toContain('UpdateTask')
    // The run starts with its task in progress; what it records is the finish.
    for (const state of ['tested', 'blocked']) expect(prompt).toContain(`- ${state}`)
    expect(prompt).toContain('already in_progress')
    // Tested is backed by evidence the user reads on the spec: a test named per delivered rule.
    expect(prompt).toContain('one entry per delivered rule')
    // A board carried over from a mapping run hands on its reading, and that is the starting point.
    expect(prompt).toContain('search only for what they do not answer')
    expect(prompt).toContain('docs/')
    expect(IMPLEMENT_TOOLS).toEqual([
      'Read', 'Write', 'Edit', 'Move', 'Copy', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'MarkdownSearch', 'CodeOutline', 'CodeSearch', 'Bash', 'RunScript', 'Skill', 'AskUser',
      'ReadTasks', 'UpdateTask',
    ])
  })

  it('the_board_is_not_a_file_the_implementer_edits', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain('it is not a file you read or edit')
    expect(prompt).not.toContain('.tasks.')
    expect(IMPLEMENT_TOOLS).not.toContain('WriteTasks')
  })

  it('a_departure_from_the_how_is_recorded_in_the_tasks_note', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain('depart from the how only where')
    expect(prompt).toContain("saying so in the task's note")
  })

  it('no_read_before_edit_instruction_since_the_stale_write_guard_enforces_it', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).not.toContain('Read a file before editing')
  })

  it('a_run_does_its_one_task_and_reads_in_batches', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain('one task')
    // One request for several reads instead of one per file: each request re-sends the whole context.
    expect(prompt).toContain('several Reads in one message')
    expect(prompt).toContain('what earlier tasks left')
  })

  it('every_file_touched_is_named_since_the_sweep_runs_over_them', () => {
    expect(implementPrompt('Order cancellation', cwd)).toContain('the sweep runs over them')
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

  it('the_implementer_is_not_sent_to_the_decisions_file_since_its_kickoff_carries_the_rulings_it_needs', () => {
    expect(implementPrompt('Order cancellation', cwd)).not.toContain('.decisions.md')
    expect(taskKickoff(onBoard, 'Cancel', spec)).not.toContain('decisions')
  })

  it('an_answer_on_the_tasks_own_rules_amends_the_spec_and_one_reaching_further_is_left_unfiled_for_the_planner', () => {
    const prompt = implementPrompt('Order cancellation', cwd)
    expect(prompt).toContain(UNFILED_DECISIONS)
    expect(prompt).toContain('a rule the task delivers')
    expect(prompt).not.toContain('The spec and the decisions file are not yours to change')
  })
})

describe('a finding the user ruled to keep', () => {
  const ruled = decisions(
    [
      '### Order.cancel refuses shipped orders [applied]',
      '- on: Shipped order',
      '- finding: `Order.cancel` in src/order.ts refuses outright.',
      '- ruling: keep',
      '',
      '### Refunds are batched [applied]',
      '- on: Refund',
      '- finding: `RefundJob` refunds nightly.',
      '- ruling: keep',
      '',
      '### Cancel is admin only [applied]',
      '- on: Cancel command',
      '- finding: `CancelEndpoint` requires the admin role.',
      '- proposed: only admins cancel',
      '- ruling: only admins cancel',
      '',
      '### Old finding [withdrawn]',
      '- on: Cancel command',
      '- finding: gone.',
      '- ruling: keep',
    ].join('\n'),
  )

  it('reaches_the_task_that_delivers_its_rule_and_no_other', () => {
    const kickoff = taskKickoff(onBoard, 'Cancel', spec, ruled)
    expect(kickoff).toContain('`Order.cancel` in src/order.ts refuses outright.')
    expect(kickoff).toContain('the spec stands and the code changes')
    expect(kickoff).not.toContain('RefundJob')
    // A ruling that changed the spec is in the rules already; a withdrawn finding no longer holds.
    expect(kickoff).not.toContain('CancelEndpoint')
    expect(kickoff).not.toContain('gone.')
  })
})

const spec = parseSpecText(
  [
    '# Order cancellation',
    '',
    '## Goal',
    'Customers cancel what has not shipped.',
    '',
    '## Cancelling',
    '- **Cancel command**: an open order can be cancelled',
    '  - **Shipped order**: a shipped order is refused',
    '- **Refund**: a cancelled order is refunded',
  ].join('\n'),
)

const onBoard = boardOf(
  task('Contract', { state: 'tested', files: ['src/order.ts'], built: '`Order.cancel()` in src/order.ts' }),
  task('Stuck', { state: 'blocked', blockedReason: 'no db', built: '' }),
  task('Cancel', { delivers: ['Cancel command', 'Shipped order'], files: ['src/cancel.ts'], context: ['src/ship.ts'], how: '- follow ship.ts' }),
  task('Refund', { delivers: ['Refund'], built: 'never shown: a later task' }),
)

describe('the hand-off a task run starts from', () => {
  it('carries_the_task_in_full_and_the_text_of_exactly_the_rules_it_delivers', () => {
    const kickoff = taskKickoff(onBoard, 'Cancel', spec)
    expect(kickoff).toContain('files: src/cancel.ts')
    expect(kickoff).toContain('context: src/ship.ts')
    expect(kickoff).toContain('- follow ship.ts')
    expect(kickoff).toContain('- **Cancel command**: an open order can be cancelled')
    expect(kickoff).toContain('- **Shipped order**: a shipped order is refused')
    expect(kickoff).not.toContain('a cancelled order is refunded')
  })

  it('carries_what_earlier_tasks_built_and_nothing_of_the_tasks_after_it', () => {
    const kickoff = taskKickoff(onBoard, 'Cancel', spec)
    expect(kickoff).toContain('- Contract [tested]: `Order.cancel()` in src/order.ts (files: src/order.ts)')
    expect(kickoff).toContain('- Stuck [blocked: no db]')
    expect(kickoff).not.toContain('never shown')
  })

  it('the_fix_run_gets_the_tasks_whose_files_the_failure_names_in_full', () => {
    const failed = boardOf(
      task('Contract', { state: 'tested', files: ['src/order.ts'], built: 'the Order type' }),
      task('Cancel', { state: 'tested', files: ['src/cancel.ts'], proves: [{ item: 'Cancel command', file: 'test/cancel.test.ts', test: 'cancels' }], how: '- follow ship.ts' }),
    )
    const failures = [{ command: 'npm test', cwd, output: 'FAIL test/cancel.test.ts > cancels' }]
    const kickoff = fixKickoff('Order cancellation', failed, failures, cwd)
    expect(kickoff).toContain('FAIL test/cancel.test.ts')
    expect(kickoff).toContain('- follow ship.ts')
    expect(kickoff).toContain('- Contract [tested]: the Order type')
  })

  it('a_task_is_settled_once_tested_blocked_or_removed', () => {
    expect(taskSettled(onBoard, 'Contract')).toBe(true)
    expect(taskSettled(onBoard, 'Stuck')).toBe(true)
    expect(taskSettled(onBoard, 'Cancel')).toBe(false)
    expect(taskSettled(boardOf(task('Gone', { removed: true })), 'Gone')).toBe(true)
  })
})
