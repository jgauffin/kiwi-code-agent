import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReadTracker } from '../src/agent/openai-session/tools/read-tracker'
import { TaskBoardGuard, taskBoardTools } from '../src/agent/openai-session/tools/task-board'
import type { Tool, ToolContext } from '../src/agent/openai-session/tools/tool'
import { PermissionPolicy } from '../src/agent/permissions/permission-policy'
import { readBoard, writeBoard } from '../src/agent/phases/tasks-file'
import { board, task } from './task-board-fixture'

const FEATURE = 'Order cancellation'
let dir: string
let ctx: ToolContext

const tool = (name: string): Tool => taskBoardTools(FEATURE).find((t) => t.name === name)!
const call = (name: string, input: unknown) => tool(name).execute(input as never, ctx)
const boardPath = () => join(dir, '.agent', 'plan', 'order-cancellation.tasks.json')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'task-board-'))
  await mkdir(join(dir, '.agent', 'plan'), { recursive: true })
  await mkdir(join(dir, 'plan'))
  await mkdir(join(dir, 'src'))
  await writeFile(join(dir, 'src', 'order.ts'), '')
  ctx = { cwd: dir, signal: new AbortController().signal, files: new ReadTracker() }
})

afterEach(() => rm(dir, { recursive: true, force: true }))

describe('ReadTasks', () => {
  it('the_overview_is_one_line_per_task_with_the_next_unfinished_task_in_full', async () => {
    await writeBoard(
      boardPath(),
      board(
        task('Contract', { group: 'Foundation', delivers: ['Cancel command'], state: 'tested' }),
        task('Cancel', { group: 'Cancelling', delivers: ['Shipped order'], files: ['src/order.ts'], how: '- follow ship.ts' }),
        task('Report', { group: 'Cancelling', state: 'blocked', blockedReason: 'no db' }),
      ),
    )
    const result = await call('ReadTasks', {})
    expect(result.text).toBe(
      [
        '## Foundation',
        '- Contract [tested] (Cancel command): contract',
        '## Cancelling',
        '- Cancel [open] (Shipped order): cancel',
        '- Report [blocked: no db]: report',
        '',
        'Next:',
        'Cancel [open] (Shipped order): cancel',
        'files: src/order.ts',
        'how:',
        '  - follow ship.ts',
      ].join('\n'),
    )
  })

  it('one_task_is_shown_in_full_and_an_unknown_one_names_the_tasks_there_are', async () => {
    await writeBoard(boardPath(), board(task('A', { note: 'kept small', proves: [{ item: 'R', file: 't.ts', test: 'r_holds' }] }), task('B')))
    expect((await call('ReadTasks', { task: 'a' })).text).toBe('A [open]: a\nproves: R → t.ts r_holds\nnote: kept small')
    expect(await call('ReadTasks', { task: 'Z' })).toEqual({ isError: true, text: 'No task named "Z". The board has: A, B.' })
  })

  it('a_feature_not_yet_checked_has_an_empty_board', async () => {
    expect((await call('ReadTasks', {})).text).toContain('The board is empty')
  })
})

describe('UpdateTask', () => {
  beforeEach(() => writeBoard(boardPath(), board(task('Cancel', { delivers: ['Cancel command', 'Shipped order'], files: ['src/order.ts'] }), task('Report'))))

  it('a_state_change_is_written_to_the_board_and_answered_in_a_line', async () => {
    expect((await call('UpdateTask', { task: 'cancel', state: 'in_progress' })).text).toBe('Cancel: in progress.')
    expect((await readBoard(boardPath()))?.tasks.map((t) => t.state)).toEqual(['in_progress', 'open'])
  })

  it('a_task_marked_tested_without_a_test_per_delivered_rule_is_told_which_rule_lacks_one', async () => {
    const result = await call('UpdateTask', { task: 'Cancel', state: 'tested', proves: [{ rule: 'Cancel command', file: 'test/c.test.ts', test: 'cancels' }] })
    expect(result.isError).toBe(false)
    expect(result.text).toContain('No test named for Shipped order')
  })

  it('a_task_marked_tested_without_saying_what_it_built_is_told_so_and_one_that_says_it_is_not', async () => {
    const proves = [
      { rule: 'Cancel command', file: 'test/c.test.ts', test: 'cancels' },
      { rule: 'Shipped order', file: 'test/c.test.ts', test: 'refuses_shipped' },
    ]
    expect((await call('UpdateTask', { task: 'Cancel', state: 'tested', proves })).text).toContain('Nothing said about what it built')
    const told = await call('UpdateTask', { task: 'Cancel', state: 'tested', proves, built: '`CancelOrder` in src/cancel.ts' })
    expect(told.text).toBe('Cancel: tested.')
    expect((await call('ReadTasks', { task: 'Cancel' })).text).toContain('built: `CancelOrder` in src/cancel.ts')
  })

  it('a_blocked_task_without_a_reason_and_an_unknown_task_are_refused', async () => {
    expect(await call('UpdateTask', { task: 'Cancel', state: 'blocked' })).toMatchObject({ isError: true, text: expect.stringContaining('needs a reason') })
    expect(await call('UpdateTask', { task: 'Nope', state: 'done' })).toMatchObject({ isError: true, text: expect.stringContaining('The board has: Cancel, Report') })
  })

  it('paths_are_kept_workspace_relative_whatever_form_they_were_given_in', async () => {
    await call('UpdateTask', { task: 'Cancel', files: [join(dir, 'src', 'order.ts'), 'src\\cancel.ts'] })
    expect((await readBoard(boardPath()))?.tasks[0]!.files).toEqual(['src/order.ts', 'src/cancel.ts'])
  })
})

describe('the board tools run without a prompt and the file itself is off limits to the implementer', () => {
  it('no_board_tool_is_put_to_a_permission_prompt', async () => {
    const policy = new PermissionPolicy(dir, () => ({ allow: [], deny: [] }))
    for (const name of ['ReadTasks', 'UpdateTask']) {
      expect(await policy.preToolUse({ toolName: name, input: {}, toolUseId: 't' })).toEqual({ allow: true })
    }
  })

  it('an_edit_of_the_board_file_is_denied_and_points_at_the_tool', async () => {
    const guard = new TaskBoardGuard(dir, FEATURE)
    expect(await guard.preToolUse({ toolName: 'Edit', input: { file_path: '.agent/plan/order-cancellation.tasks.json' }, toolUseId: 't' })).toMatchObject({
      deny: expect.stringContaining('UpdateTask'),
    })
    expect(await guard.preToolUse({ toolName: 'Write', input: { file_path: join(dir, '.agent', 'plan', 'order-cancellation.tasks.json') }, toolUseId: 't' })).toMatchObject({
      deny: expect.any(String),
    })
    expect(await guard.preToolUse({ toolName: 'Edit', input: { file_path: 'src/order.ts' }, toolUseId: 't' })).toBeUndefined()
  })
})
