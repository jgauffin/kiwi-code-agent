import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decisions } from '../src/agent/phases/decisions'
import { parseSpec, specFingerprint } from '../src/agent/phases/spec-model'
import {
  TESTS_ONLY_HOW,
  acceptTask,
  deliveredBy,
  deriveBoard,
  nextTask,
  blockedTask,
  blockedToReassess,
  markReassessed,
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
    expect(tasksFile('Order cancellation')).toBe('.kiwi/specs/order-cancellation.tasks.json')
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

  it('a_blocked_task_is_the_first_live_one_that_is_blocked', () => {
    const b = board(task('A', { state: 'blocked', blockedReason: 'gone', removed: true }), task('B', { state: 'tested' }), task('C', { state: 'blocked', blockedReason: 'no db' }))
    expect(blockedTask(b)?.name).toBe('C')
    expect(blockedTask(board(task('A', { state: 'tested' })))).toBeUndefined()
  })

  it('a_board_written_before_the_hand_off_existed_reads_with_none', () => {
    const old = JSON.parse(renderBoard(board(task('A')))) as { tasks: Record<string, unknown>[] }
    delete old.tasks[0]!['built']
    expect(parseBoard(JSON.stringify(old)).tasks[0]!.built).toBe('')
  })

  it('another_look_at_the_end_only_a_blocked_task_not_yet_looked_at_again_is_handed_back_by_the_build', () => {
    const b = board(task('A', { state: 'blocked', blockedReason: 'no db', reassessed: true }), task('B', { state: 'blocked', blockedReason: 'no e2e' }))
    expect(blockedToReassess(b)?.name).toBe('B')
    expect(blockedToReassess(markReassessed(b, 'B'))).toBeUndefined()
    expect(blockedTask(b, 'b')?.name).toBe('B')
  })

  it('a_second_look_holds_through_the_look_and_drops_once_the_task_is_finished', () => {
    const looked = markReassessed(board(task('A', { state: 'blocked', blockedReason: 'no db', files: ['src/a.ts'] })), 'A')
    const looking = updateTask(looked, 'A', { state: 'in_progress' })
    expect(looking.tasks[0]!.reassessed).toBe(true)
    expect(updateTask(looking, 'A', { state: 'blocked', blockedReason: 'still no db' }).tasks[0]!.reassessed).toBe(true)
    expect(updateTask(looking, 'A', { state: 'tested' }).tasks[0]!.reassessed).toBeUndefined()
  })
})

describe('the developer accepts a blocked task', () => {
  const stuck = board(task('A', { state: 'tested', files: ['src/a.ts'] }), task('B', { delivers: ['Refund'], state: 'blocked', blockedReason: 'no e2e setup', reassessed: true }))

  it('accept_as_is_records_it_as_accepted_with_the_reason_it_was_blocked', () => {
    const accepted = acceptTask(stuck, 'b').tasks[1]!
    expect(accepted).toMatchObject({ state: 'tested', accepted: 'no e2e setup' })
    expect(accepted.blockedReason).toBeUndefined()
    expect(accepted.reassessed).toBeUndefined()
    expect(parseBoard(renderBoard(acceptTask(stuck, 'B')))).toEqual(acceptTask(stuck, 'B'))
  })

  it('accepted_is_finished', () => {
    expect(tasksDone(stuck.tasks)).toBe(false)
    expect(tasksDone(acceptTask(stuck, 'B').tasks)).toBe(true)
  })

  it('still_unproven_a_rule_an_accepted_task_delivers_without_a_test_stays_without_one', () => {
    expect(unprovenItems(acceptTask(stuck, 'B').tasks)).toEqual(['Refund'])
  })

  it('only_a_blocked_task_can_be_accepted', () => {
    expect(() => acceptTask(stuck, 'A')).toThrow(/only a blocked task/)
  })

  it('acceptance_drops_once_a_run_moves_the_task_again', () => {
    const accepted = acceptTask(stuck, 'B')
    expect(updateTask(accepted, 'B', { note: 'n' }).tasks[1]!.accepted).toBe('no e2e setup')
    expect(updateTask(accepted, 'B', { state: 'in_progress' }).tasks[1]!.accepted).toBeUndefined()
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
    const revised = spec('## Refunding\n- **Refund on cancel**: a cancelled order is refunded\n- **Partial refund**: partly refunded')
    const again = deriveBoard(revised, worked)
    expect(again.tasks.find((t) => t.name === 'Refunding')).toMatchObject({
      delivers: ['Refund on cancel', 'Partial refund'],
      // A rule was added to an already-tested scenario: unfinished again, but its files and what it built are kept.
      state: 'open',
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

  it('a_clean_check_on_built_behaviour_derives_tasks_that_only_add_tests', () => {
    const derived = deriveBoard(two, undefined, undefined, true)
    expect(derived.tasks.map((t) => [t.name, t.how])).toEqual([
      ['Cancelling an order', TESTS_ONLY_HOW],
      ['Refunding', TESTS_ONLY_HOW],
    ])
    // Behaviour not marked built is planned and built as usual, whatever the check found.
    expect(deriveBoard(two).tasks.map((t) => t.how)).toEqual(['', ''])
  })

  it('drift_on_built_behaviour_builds_only_the_scenario_the_check_disagreed_with', () => {
    const onCancel = decisions('### Cancel keeps a shipped order\n- on: Cancel command\n- finding: f')
    const derived = deriveBoard(two, undefined, undefined, true, onCancel)
    expect(derived.tasks.map((t) => [t.name, t.how])).toEqual([
      ['Cancelling an order', ''],
      ['Refunding', TESTS_ONLY_HOW],
    ])
    // A decision no longer standing does not hold a scenario to building: it goes back to tests only.
    const withdrawn = decisions('### Cancel keeps a shipped order [withdrawn]\n- on: Cancel command\n- finding: f')
    const settled = deriveBoard(two, undefined, undefined, true, withdrawn)
    expect(settled.tasks.find((t) => t.name === 'Cancelling an order')?.how).toBe(TESTS_ONLY_HOW)
  })

  it('a_scenario_whose_rules_changed_is_unfinished_again_but_keeps_the_proofs_the_change_left_alone', () => {
    const before = spec(
      ['## Cancelling an order', '- **Cancel command**: an open order can be cancelled', '- **Refund timing**: refunded within a day', '- **Old guard**: a legacy rule'].join('\n'),
    )
    const worked = updateTask(deriveBoard(before), 'Cancelling an order', {
      state: 'tested',
      files: ['src/orders/cancel.ts'],
      proves: [
        { item: 'Cancel command', file: 'test/cancel.test.ts', test: 'an_open_order_can_be_cancelled' },
        { item: 'Refund timing', file: 'test/cancel.test.ts', test: 'refunds_within_a_day' },
        { item: 'Old guard', file: 'test/cancel.test.ts', test: 'the_legacy_rule_holds' },
      ],
    })
    const after = spec(
      ['## Cancelling an order', '- **Cancel command**: an open order can be cancelled', '- **Refund timing**: refunded within two days', '- **New guard**: a new rule'].join('\n'),
    )
    const changed = deriveBoard(after, worked).tasks.find((t) => t.name === 'Cancelling an order')!
    // Gained "New guard", lost "Old guard" and amended "Refund timing": unfinished again, files kept.
    expect(changed.state).toBe('open')
    expect(changed.files).toEqual(['src/orders/cancel.ts'])
    // The untouched rule keeps the test that already proves it; the rest drop with it.
    expect(changed.proves).toEqual([{ item: 'Cancel command', file: 'test/cancel.test.ts', test: 'an_open_order_can_be_cancelled' }])
    // Its run is told what is new or amended, to build those rather than the scenario anew.
    expect(changed.how).toContain('Refund timing')
    expect(changed.how).toContain('New guard')
    expect(changed.how).not.toContain('Old guard')
  })

  it('nothing_changed_under_a_scenario_leaves_an_already_tested_task_as_it_was', () => {
    const proof = { item: 'Refund on cancel', file: 'test/refund.test.ts', test: 'a_cancelled_order_is_refunded' }
    const worked = updateTask(deriveBoard(two), 'Refunding', { state: 'tested', files: ['src/refund.ts'], proves: [proof] })
    const again = deriveBoard(two, worked)
    expect(again.tasks.find((t) => t.name === 'Refunding')).toMatchObject({ state: 'tested', files: ['src/refund.ts'], proves: [proof] })
  })

  it('a_task_derived_before_rule_changes_were_tracked_is_read_as_unchanged_the_first_time', () => {
    const legacy = board(task('Refunding', { group: 'Refunding', delivers: ['Refund on cancel'], state: 'tested', files: ['src/refund.ts'] }))
    const again = deriveBoard(two, legacy)
    expect(again.tasks.find((t) => t.name === 'Refunding')).toMatchObject({ state: 'tested', files: ['src/refund.ts'] })
    // From here on the scenario's rule text is tracked, so a later change can be told apart from one already built.
    expect(again.tasks.find((t) => t.name === 'Refunding')?.rulesText).toEqual({ 'Refund on cancel': 'a cancelled order is refunded' })
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
