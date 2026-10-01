import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSpec, specFingerprint } from '../src/agent/phases/spec-model'
import {
  deliveredBy,
  deriveBoard,
  nextTask,
  parseBoard,
  provenBy,
  readBoard,
  recordVerification,
  renderBoard,
  started,
  stateOfBoard,
  taskFiles,
  tasksDone,
  tasksFile,
  tasksFresh,
  unprovenItems,
  updateTask,
  withCleanupDecision,
  withRecord,
  withSpecFingerprint,
  writeBoard,
} from '../src/agent/phases/tasks-file'
import { board, task } from './task-board-fixture'

describe('tasks board', () => {
  it('a_board_reads_back_as_it_was_written', () => {
    const written = withRecord(
      withSpecFingerprint(
        board(
          task('Cancel command', {
            group: 'Cancelling',
            delivers: ['Cancel command'],
            files: ['src/orders/cancel.ts'],
            newFiles: ['src/orders/cancel.ts'],
            how: '- follow ship.ts\n- leave `OrderStatus` alone',
            proves: [{ item: 'Cancel command', file: 'test/cancel.test.ts', test: 'an_open_order_can_be_cancelled' }],
            note: 'the guard sits on Order',
            state: 'blocked',
            blockedReason: 'the API moved',
          }),
        ),
        'abc12345',
      ),
      { at: 't', ok: true, text: '' },
    )
    expect(parseBoard(renderBoard(written))).toEqual(written)
  })

  it('a_malformed_board_is_refused_naming_the_field_that_broke_it', () => {
    const broken = JSON.parse(renderBoard(board(task('A')))) as { tasks: { state: string }[] }
    broken.tasks[0]!.state = 'finished'
    expect(() => parseBoard(JSON.stringify(broken), 'x.tasks.json')).toThrow(/x\.tasks\.json is malformed at tasks\.0\.state/)
  })

  it('coverage_reads_both_ways_which_task_delivers_an_item_and_which_test_proves_it', () => {
    const tasks = [
      task('One', { delivers: ['Cancel command', 'Shipped order'], state: 'tested', proves: [{ item: 'Cancel command', file: 'test/a.test.ts', test: 'cancel_holds' }] }),
      task('Two', { delivers: ['Refund'] }),
      task('Three', { delivers: ['Release'], removed: true }),
    ]
    expect(deliveredBy(tasks, 'shipped order')?.name).toBe('One')
    expect(deliveredBy(tasks, 'Release')).toBeUndefined()
    expect(provenBy(tasks, 'Cancel command')).toEqual({ item: 'Cancel command', file: 'test/a.test.ts', test: 'cancel_holds' })
    expect(provenBy(tasks, 'Shipped order')).toBeUndefined()
    // One is marked tested but Shipped order has no test named: a finish the evidence does not back.
    expect(unprovenItems(tasks)).toEqual(['Shipped order'])
  })

  it('the_board_remembers_the_spec_it_was_derived_from', () => {
    const unstamped = stateOfBoard(board(task('A')))
    const stamped = stateOfBoard(withSpecFingerprint(board(task('A')), 'abc12345'))
    if (!stamped.exists || !unstamped.exists) throw new Error('a board exists')
    expect(stamped.spec).toBe('abc12345')
    expect(tasksFresh(stamped, 'abc12345')).toBe(true)
    expect(tasksFresh(stamped, 'ffff0000')).toBe(false)
    // A board from before the stamp is not stale on account of the stamp alone.
    expect(tasksFresh(unstamped, 'ffff0000')).toBe(true)
  })

  it('the_board_remembers_what_the_user_said_about_the_cleanup', () => {
    const postponed = withCleanupDecision(withSpecFingerprint(board(task('A', { state: 'tested' })), 'abc12345'), 'postponed')
    expect(postponed.cleanup).toBe('postponed')
    // The stamp it stands beside survives, and a later word replaces the earlier one.
    expect(postponed.spec).toBe('abc12345')
    expect(withCleanupDecision(postponed, 'done').cleanup).toBe('done')
  })

  it('is_done_only_when_every_live_task_is_tested', () => {
    const tested = task('A', { state: 'tested' })
    expect(tasksDone([tested, task('B', { state: 'tested' }), task('C', { removed: true })])).toBe(true)
    // Done is code written, not proven: the tests for it have to pass first.
    expect(tasksDone([tested, task('B', { state: 'done' })])).toBe(false)
    expect(tasksDone([tested, task('B', { state: 'blocked', blockedReason: 'needs a decision' })])).toBe(false)
    // A board with no tasks at all is not vacuously finished.
    expect(tasksDone([])).toBe(false)
  })

  it('work_has_started_once_any_task_has_moved_from_open', () => {
    expect(started([task('A'), task('B')])).toBe(false)
    expect(started([task('A', { state: 'in_progress' }), task('B')])).toBe(true)
  })

  it('collects_the_files_of_live_tasks_once_each', () => {
    const tasks = [
      task('A', { files: ['src/a.ts', 'src/b.ts'] }),
      task('B', { files: ['src/b.ts', 'src/c.ts'] }),
      task('C', { files: ['src/gone.ts'], removed: true }),
    ]
    expect(taskFiles(tasks)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  it('the_newest_verification_record_is_the_one_that_counts', () => {
    const failed = withRecord(board(task('A', { state: 'tested' })), { at: '2026-09-14T09:40:00Z', ok: false, text: '`npm test` in .' })
    const passed = withRecord(failed, { at: '2026-09-14T10:00:00Z', ok: true, text: '' })
    expect(stateOfBoard(passed)).toMatchObject({ verification: { at: '2026-09-14T10:00:00Z', ok: true } })
    expect(passed.verification.map((r) => r.ok)).toEqual([true, false])
  })

  it('names_the_file_by_the_feature_slug', () => {
    expect(tasksFile('Order cancellation')).toBe('.agent/plan/order-cancellation.tasks.json')
  })
})

describe('the implementer moves a task along', () => {
  const start = board(task('A', { how: 'the mappers how', files: ['src/a.ts', 'src/new.ts'], newFiles: ['src/new.ts'] }), task('B'))

  it('only_the_named_task_changes_and_only_in_the_implementers_fields', () => {
    const next = updateTask(start, 'a', { state: 'tested', proves: [{ item: 'R', file: 'test/a.test.ts', test: 'r_holds' }], note: 'kept it small' })
    expect(next.tasks[0]).toMatchObject({ state: 'tested', note: 'kept it small', how: 'the mappers how', proves: [{ item: 'R' }] })
    expect(next.tasks[1]).toEqual(start.tasks[1])
  })

  it('a_file_the_mapping_planned_to_create_stays_marked_new_while_the_task_names_it', () => {
    expect(updateTask(start, 'A', { files: ['src/new.ts', 'src/extra.ts'] }).tasks[0]!.newFiles).toEqual(['src/new.ts'])
    expect(updateTask(start, 'A', { files: ['src/a.ts'] }).tasks[0]!.newFiles).toEqual([])
  })

  it('a_blocked_task_needs_a_reason_and_leaving_blocked_drops_it', () => {
    expect(() => updateTask(start, 'A', { state: 'blocked' })).toThrow(/needs a reason/)
    const blocked = updateTask(start, 'A', { state: 'blocked', blockedReason: 'no db' })
    expect(blocked.tasks[0]).toMatchObject({ state: 'blocked', blockedReason: 'no db' })
    // A note on a blocked task keeps it blocked, with its reason.
    expect(updateTask(blocked, 'A', { note: 'asked ops' }).tasks[0]).toMatchObject({ state: 'blocked', blockedReason: 'no db' })
    expect(updateTask(blocked, 'A', { state: 'in_progress' }).tasks[0]!.blockedReason).toBeUndefined()
  })

  it('a_task_is_not_tested_until_it_names_the_files_the_sweep_runs_over', () => {
    expect(() => updateTask(start, 'B', { state: 'tested' })).toThrow(/names no file/)
    expect(updateTask(start, 'B', { state: 'tested', files: ['src/b.ts'] }).tasks[1]!.state).toBe('tested')
  })

  it('an_unknown_task_is_refused_with_the_names_on_the_board', () => {
    expect(() => updateTask(start, 'C', { state: 'done' })).toThrow('No task named "C". The board has: A, B.')
  })

  it('what_a_task_built_is_kept_for_the_tasks_after_it', () => {
    const next = updateTask(start, 'A', { state: 'tested', built: '`OrderRepository.CancelAsync` in src/orders/repo.ts' })
    expect(next.tasks[0]!.built).toBe('`OrderRepository.CancelAsync` in src/orders/repo.ts')
    // A later change that does not name it leaves it as written.
    expect(updateTask(next, 'A', { note: 'kept it small' }).tasks[0]!.built).toBe('`OrderRepository.CancelAsync` in src/orders/repo.ts')
  })
})

describe('the next task to build', () => {
  it('is_the_first_live_task_that_is_neither_tested_nor_blocked', () => {
    const b = board(
      task('A', { state: 'tested' }),
      task('B', { state: 'blocked', blockedReason: 'no db' }),
      task('C', { removed: true }),
      task('D', { state: 'in_progress' }),
      task('E'),
    )
    expect(nextTask(b)?.name).toBe('D')
    expect(nextTask(board(task('A', { state: 'tested' })))).toBeUndefined()
  })

  it('a_board_written_before_the_hand_off_existed_reads_with_none', () => {
    const old = JSON.parse(renderBoard(board(task('A')))) as { tasks: Record<string, unknown>[] }
    delete old.tasks[0]!['built']
    expect(parseBoard(JSON.stringify(old)).tasks[0]!.built).toBe('')
  })
})

describe('the board derived from the spec', () => {
  const spec = (text: string) => parseSpec(`# Orders\n\n## Goal\nOrders.\n\n${text}`)
  const two = spec(
    [
      '## Cancelling an order',
      'The customer changes their mind.',
      '- **Cancel command**: an open order can be cancelled',
      '  - **Shipped order**: a shipped order cannot',
      '- **Old rule**: gone [removed]',
      '',
      '## Refunding',
      '- **Refund on cancel**: a cancelled order is refunded',
      '',
      '## Dropped',
      '- **Dropped rule**: struck [removed]',
    ].join('\n'),
  )

  it('is_one_task_per_scenario_delivering_its_live_rules_and_edges', () => {
    const derived = deriveBoard(two)
    expect(derived.tasks.map((t) => [t.name, t.group, t.delivers, t.text, t.state])).toEqual([
      ['Cancelling an order', 'Cancelling an order', ['Cancel command', 'Shipped order'], 'The customer changes their mind.', 'open'],
      ['Refunding', 'Refunding', ['Refund on cancel'], 'Refunding', 'open'],
    ])
    expect(derived.spec).toBe(specFingerprint(two))
  })

  it('deriving_again_keeps_the_implementers_progress_and_files', () => {
    const worked = updateTask(deriveBoard(two), 'Refunding', { state: 'tested', files: ['src/refund.ts'], built: 'Refund type', note: 'n' })
    const revised = spec('## Refunding\n- **Refund on cancel**: refunded\n- **Partial refund**: partly refunded')
    const again = deriveBoard(revised, worked)
    expect(again.tasks.find((t) => t.name === 'Refunding')).toMatchObject({
      delivers: ['Refund on cancel', 'Partial refund'],
      state: 'tested',
      files: ['src/refund.ts'],
      built: 'Refund type',
      removed: false,
    })
  })

  it('each_task_starts_from_the_files_the_check_found_its_scenario_builds_on', () => {
    const found = new Map([['cancelling an order', ['src/orders/order.ts', 'src/orders/cancel.ts']]])
    const derived = deriveBoard(two, undefined, found)
    expect(derived.tasks.map((t) => [t.name, t.context])).toEqual([
      ['Cancelling an order', ['src/orders/order.ts', 'src/orders/cancel.ts']],
      ['Refunding', []],
    ])
  })

  it('a_later_check_replaces_a_scenarios_files_and_one_it_leaves_out_keeps_them', () => {
    const first = deriveBoard(two, undefined, new Map([['Cancelling an order', ['src/orders/order.ts']], ['Refunding', ['src/refund.ts']]]))
    const again = deriveBoard(two, first, new Map([['Cancelling an order', ['src/orders/cancel.ts']]]))
    expect(again.tasks.map((t) => [t.name, t.context])).toEqual([
      ['Cancelling an order', ['src/orders/cancel.ts']],
      ['Refunding', ['src/refund.ts']],
    ])
  })

  it('a_scenario_gone_from_the_spec_leaves_its_task_on_the_board_marked_removed', () => {
    const again = deriveBoard(spec('## Refunding\n- **Refund on cancel**: refunded'), deriveBoard(two))
    expect(again.tasks.find((t) => t.name === 'Cancelling an order')?.removed).toBe(true)
  })

  it('a_mapped_task_already_worked_on_keeps_its_rules_and_an_untouched_one_gives_way', () => {
    const mappedBoard = board(
      task('Cancel command', { group: 'Cancelling an order', delivers: ['Cancel command'], state: 'tested' }),
      task('Shipped guard', { group: 'Cancelling an order', delivers: ['Shipped order'] }),
    )
    const derived = deriveBoard(two, mappedBoard)
    expect(derived.tasks.map((t) => [t.name, t.delivers, t.removed])).toEqual([
      ['Cancel command', ['Cancel command'], false],
      ['Shipped guard', ['Shipped order'], true],
      ['Cancelling an order', ['Shipped order'], false],
      ['Refunding', ['Refund on cancel'], false],
    ])
  })
})

describe('the board on disk under parallel sessions', () => {
  const withDir = async (use: (path: string) => Promise<void>) => {
    const dir = await mkdtemp(join(tmpdir(), 'tasks-file-'))
    try {
      await use(join(dir, 'orders.tasks.json'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('changes_made_at_the_same_time_are_all_kept', () =>
    withDir(async (path) => {
      await writeBoard(path, board(task('A')))
      await Promise.all(Array.from({ length: 20 }, (_, i) => recordVerification(path, { at: `run ${i}`, ok: false, text: '`npm test` in .' })))
      expect((await readBoard(path))!.verification).toHaveLength(20)
    }))

  it('a_shorter_board_written_over_a_longer_one_leaves_no_tail_of_it', () =>
    withDir(async (path) => {
      const long = board(task('A', { note: 'x'.repeat(4000) }))
      const short = board(task('A'))
      await Promise.all(Array.from({ length: 20 }, (_, i) => writeBoard(path, i % 2 === 0 ? long : short)))
      const text = await readFile(path, 'utf8')
      expect(() => parseBoard(text)).not.toThrow()
    }))
})
