import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  NOTHING_RAN,
  commandsFor,
  countsAgainstBudget,
  findUpward,
  plannedCommands,
  runVerification,
  runsTests,
  verificationDue,
  verificationHandoffPrompt,
  type Attribute,
  type VerifyRule,
} from '../src/agent/phases/verification'
import { nothingRan, readBoard, readTasks, stateOfBoard, writeBoard, type Task } from '../src/agent/phases/tasks-file'
import { board as boardOf, task } from './task-board-fixture'

let dir: string
const runs: { command: string; cwd: string }[] = []
let outcome: { ok: boolean; output: string } = { ok: true, output: '' }

const rules: VerifyRule[] = [
  { match: '**/*.cs', project: '*.csproj', command: 'dotnet test "{project}"' },
  { match: 'src/**/*.ts', project: 'package.json', command: 'npm test' },
]

const run = async (command: string, cwd: string) => {
  runs.push({ command, cwd })
  return outcome
}

const boardPath = () => join(dir, '.kiwi', 'specs', 'order-cancellation.tasks.json')
const board = (...tasks: Task[]) => writeBoard(boardPath(), boardOf(...tasks))
const tested = (name: string, ...files: string[]) => task(name, { state: 'tested', files })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'verify-'))
  await mkdir(join(dir, 'src', 'Api', 'Orders'), { recursive: true })
  await mkdir(join(dir, 'specs'))
  await mkdir(join(dir, '.kiwi', 'specs'), { recursive: true })
  await writeFile(join(dir, 'src', 'Api', 'Api.csproj'), '<Project/>')
  await writeFile(join(dir, 'src', 'Api', 'Orders', 'Order.cs'), 'class Order {}')
  await writeFile(join(dir, 'package.json'), '{}')
  runs.length = 0
  outcome = { ok: true, output: '' }
})

afterEach(() => rm(dir, { recursive: true, force: true }))

describe('commandsFor', () => {
  it('a_touched_file_runs_the_command_of_its_nearest_project_in_that_directory', () => {
    expect(commandsFor(['src/Api/Orders/Order.cs'], rules, dir)).toEqual([
      { command: `dotnet test "${join(dir, 'src', 'Api', 'Api.csproj')}"`, cwd: join(dir, 'src', 'Api') },
    ])
  })

  it('a_backend_and_a_frontend_file_run_each_suite_once', () => {
    const files = ['src/Api/Orders/Order.cs', 'src/Api/Other.cs', 'src/app/orders.ts', 'src/app/orders.test.ts']
    expect(commandsFor(files, rules, dir)).toEqual([
      { command: `dotnet test "${join(dir, 'src', 'Api', 'Api.csproj')}"`, cwd: join(dir, 'src', 'Api') },
      { command: 'npm test', cwd: dir },
    ])
  })

  it('a_file_no_rule_matches_runs_nothing', () => {
    expect(commandsFor(['docs/intent/orders.md'], rules, dir)).toEqual([])
  })

  it('rules_without_a_project_run_in_the_workspace_root', () => {
    expect(commandsFor(['src/thing.ts'], [{ match: '**/*.ts', command: 'npm run typecheck' }], dir)).toEqual([
      { command: 'npm run typecheck', cwd: dir },
    ])
  })
})

describe('runsTests', () => {
  it('verify_only_when_tests_run_a_rule_has_to_apply_to_a_file_the_tasks_name', () => {
    expect(runsTests([tested('T1', 'src/app/orders.ts')], rules, dir)).toBe(true)
    expect(runsTests([tested('T1', 'docs/intent/orders.md')], rules, dir)).toBe(false)
  })

  it('before_any_file_is_named_any_configured_rule_counts', () => {
    expect(runsTests([task('T1')], rules, dir)).toBe(true)
    expect(runsTests([task('T1')], [], dir)).toBe(false)
  })

  it('before_the_first_run_the_commands_that_will_run_are_described', () => {
    expect(plannedCommands([tested('T1', 'src/app/orders.ts')], rules, dir)).toEqual(['`npm test` in .'])
  })
})

describe('findUpward', () => {
  it('finds_the_nearest_matching_file_and_stops_at_the_root', () => {
    expect(findUpward(join(dir, 'src', 'Api', 'Orders'), '*.csproj', dir)).toBe(join(dir, 'src', 'Api', 'Api.csproj'))
    expect(findUpward(join(dir, 'src'), '*.csproj', dir)).toBeUndefined()
  })
})

describe('runVerification', () => {
  it('runs_the_suites_the_tasks_files_select_and_records_a_pass_on_the_board', async () => {
    await board(tested('T1', 'src/Api/Orders/Order.cs'), tested('T2', 'src/app/orders.ts'))
    const result = await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run, now: '2026-09-14T10:00:00Z' })
    expect(runs).toHaveLength(2)
    expect(result.failures).toEqual([])
    const tasks = await readTasks(boardPath())
    expect(tasks.exists && tasks.verification).toMatchObject({ at: '2026-09-14T10:00:00Z', ok: true })
    expect(tasks.exists && tasks.verification?.text).toContain('`npm test` in .')
  })

  it('a_removed_tasks_files_do_not_select_a_suite', async () => {
    await board(tested('T1', 'src/app/orders.ts'), task('T2', { removed: true, files: ['src/Api/Orders/Order.cs'] }))
    await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run })
    expect(runs).toEqual([{ command: 'npm test', cwd: dir }])
  })

  it('records_a_failure_naming_the_command_and_hands_the_output_tail_to_the_implementer', async () => {
    outcome = { ok: false, output: 'x'.repeat(100) + 'THE ERROR' }
    await board(tested('T1', 'src/app/orders.ts'))
    const result = await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run, maxOutputChars: 20 })
    expect(result.record.ok).toBe(false)
    expect(result.record.text).toBe('`npm test` in .')
    expect(result.failures[0]?.output).toBe('[...]\n' + 'x'.repeat(11) + 'THE ERROR')
    const prompt = verificationHandoffPrompt('Order cancellation', result.failures, dir)
    expect(prompt).toContain('UpdateTask')
    expect(prompt).toContain('`npm test` in .')
    expect(prompt).toContain('THE ERROR')
    expect(prompt).toContain('runs again as soon as you stop')
  })

  it('a_failure_handoff_asks_for_a_narrowed_reproduction_before_the_sweep_is_paid_for_again', async () => {
    await board(tested('T1', 'src/a.ts'))
    outcome = { ok: false, output: 'THE ERROR' }
    const result = await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run })
    const prompt = verificationHandoffPrompt('Order cancellation', result.failures, dir)
    expect(prompt).toContain('Reproduce the failure with a run narrowed to the test')
    expect(prompt).toContain('build its project')
    expect(prompt).toContain('stopping on a fix you have not run costs another one')
  })

  it('nothing_run_is_no_pass_the_record_moves_the_board_on_and_says_no_tests_ran', async () => {
    await board(tested('T1', 'docs/intent/orders.md'))
    const result = await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run })
    expect(runs).toEqual([])
    expect(result.record).toMatchObject({ ok: true, text: NOTHING_RAN, runs: [] })
    expect(nothingRan(result.record)).toBe(true)
  })

  it('the_run_on_view_each_command_is_recorded_with_how_it_ended_and_a_failure_keeps_its_output', async () => {
    await board(tested('T1', 'src/Api/Orders/Order.cs'), tested('T2', 'src/app/orders.ts'))
    const failing = async (command: string, cwd: string) => {
      runs.push({ command, cwd })
      return command === 'npm test' ? { ok: false, output: 'THE ERROR' } : { ok: true, output: 'all good' }
    }
    const result = await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run: failing })
    expect(result.record.runs).toEqual([
      { command: expect.stringContaining('dotnet test'), ok: true },
      { command: '`npm test` in .', ok: false, output: 'THE ERROR' },
    ])
    expect(nothingRan(result.record)).toBe(false)
  })

  it('only_the_newest_record_keeps_its_failures_output', async () => {
    await board(tested('T1', 'src/app/orders.ts'))
    outcome = { ok: false, output: 'FIRST' }
    await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run })
    outcome = { ok: false, output: 'SECOND' }
    await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run })
    const saved = (await readBoard(boardPath()))!.verification
    expect(saved[0]!.runs).toEqual([{ command: '`npm test` in .', ok: false, output: 'SECOND' }])
    expect(saved[1]!.runs).toEqual([{ command: '`npm test` in .', ok: false }])
  })

  it('refuses_without_a_tasks_file', async () => {
    await expect(runVerification({ cwd: dir, feature: 'Order cancellation', rules, run })).rejects.toThrow(/no tasks file/i)
  })

  const foreign: Attribute = async () => ({ foreign: true, files: ['src/app/orders.ts'], hand: 'It was changed by a Kiwipow Agent plan session on "Other feature".' })
  const ours: Attribute = async () => ({ foreign: false, files: ['src/app/orders.ts'] })

  it('held_rather_than_verified_an_all_foreign_run_without_a_retry_is_held_and_recorded_on_the_board_naming_the_files_and_the_hand', async () => {
    await board(tested('T1', 'src/app/orders.ts'))
    outcome = { ok: false, output: 'boom' }
    const result = await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run, attribute: foreign })
    expect(result.failures).toEqual([])
    expect(result.held).toMatchObject([{ files: ['src/app/orders.ts'], hand: expect.stringContaining('Other feature') }])
    expect(result.record.ok).toBe(false)
    const tasks = await readTasks(boardPath())
    expect(tasks.exists && tasks.verification).toMatchObject({ ok: false, foreign: [{ files: ['src/app/orders.ts'], hand: expect.stringContaining('Other feature') }] })
    expect(verificationDue(tasks)).toBe(true)
  })

  it('no_other_hand_no_excuse_a_run_whose_failures_are_all_the_features_own_is_handed_to_the_implementer_as_before', async () => {
    await board(tested('T1', 'src/app/orders.ts'))
    outcome = { ok: false, output: 'boom' }
    const result = await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run, attribute: ours })
    expect(result.failures).toHaveLength(1)
    expect(result.held).toEqual([])
  })

  it('retry_before_asking_an_all_foreign_run_waits_and_runs_the_same_suites_again_before_being_reported', async () => {
    await board(tested('T1', 'src/app/orders.ts'))
    outcome = { ok: false, output: 'boom' }
    const waited: number[] = []
    const result = await runVerification({
      cwd: dir,
      feature: 'Order cancellation',
      rules,
      run,
      attribute: foreign,
      retry: { seconds: 5, wait: async (ms) => void waited.push(ms) },
    })
    expect(runs).toHaveLength(2)
    expect(waited).toEqual([5000])
    expect(result.held).toHaveLength(1)
  })

  it('ours_on_the_second_run_a_failure_thats_foreign_first_but_the_features_own_on_the_retry_is_handed_to_the_implementer', async () => {
    await board(tested('T1', 'src/app/orders.ts'))
    outcome = { ok: false, output: 'boom' }
    let call = 0
    const attribute: Attribute = async (failure) => (++call === 1 ? foreign(failure) : ours(failure))
    const result = await runVerification({
      cwd: dir,
      feature: 'Order cancellation',
      rules,
      run,
      attribute,
      retry: { seconds: 1, wait: async () => {} },
    })
    expect(runs).toHaveLength(2)
    expect(result.failures).toHaveLength(1)
    expect(result.held).toEqual([])
  })
})

describe('countsAgainstBudget', () => {
  const record = { at: '2026-09-14T10:00:00Z', ok: false, text: 'x' }

  it('budget_spared_an_all_foreign_held_outcome_does_not_count_against_the_budget', () => {
    expect(countsAgainstBudget({ record, failures: [], held: [{ command: 'npm test', cwd: dir, output: '', files: [], hand: 'x' }] })).toBe(false)
  })

  it('a_failure_thats_the_features_own_counts_against_the_budget', () => {
    expect(countsAgainstBudget({ record, failures: [{ command: 'npm test', cwd: dir, output: '' }], held: [] })).toBe(true)
  })
})

describe('verificationDue', () => {
  const tasks = (list: Task[], ok?: boolean) =>
    stateOfBoard({ tasks: list, verification: ok === undefined ? [] : [{ at: '2026-09-14T21:19:46Z', ok, text: '`npm test` in .' }] })

  it('an_all_tested_board_whose_last_run_failed_is_verified_again_without_the_implementer_re_marking_a_task', () => {
    expect(verificationDue(tasks([tested('T1')], false))).toBe(true)
  })

  it('an_all_tested_board_never_run_is_due', () => {
    expect(verificationDue(tasks([tested('T1')]))).toBe(true)
  })

  it('a_board_that_already_passed_is_not_run_again', () => {
    expect(verificationDue(tasks([tested('T1')], true))).toBe(false)
  })

  it('a_board_with_open_or_blocked_work_is_not_due', () => {
    expect(verificationDue(tasks([tested('T1'), task('T2', { state: 'blocked', blockedReason: 'no db' })]))).toBe(false)
    expect(verificationDue(tasks([tested('T1'), task('T2', { state: 'done' })]))).toBe(false)
    expect(verificationDue({ exists: false })).toBe(false)
  })
})
