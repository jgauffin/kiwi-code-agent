import { describe, expect, it } from 'vitest'
import {
  deliveredBy,
  parseTasks,
  provenBy,
  started,
  taskFiles,
  tasksDone,
  tasksFile,
  tasksFresh,
  undeliveredItems,
  unprovenItems,
  withRecord,
  withSpecFingerprint,
} from '../src/agent/phases/tasks-file'

const board = (...lines: string[]): string => `# Tasks for Order cancellation\n\n${lines.join('\n')}\n`

describe('tasks file', () => {
  it('a_task_is_named_and_delivers_rules_by_name', () => {
    const { tasks } = parseTasks(
      board(
        '- **Cancel command** (Cancel command, Shipped order): add the cancel command [tested]',
        '  - files: src/orders/cancel.ts, src/orders/cancel.test.ts (new)',
        '  - proves: Cancel command → src/orders/cancel.test.ts an_open_order_can_be_cancelled, Shipped order -> src/orders/cancel.test.ts a_shipped_order_cannot',
        '  - context: src/orders/order.ts, src/orders/ship.test.ts',
        '- **Reservation** (Release): release the reservation [done]',
        '  - files: src/orders/reservation.ts',
        '- **Report**: report on cancellations [in progress]',
        '- **Old flag**: drop the old flag [blocked: the flag is read by billing]',
        '- **Planned**: something planned',
        '- **Gone**: gone [removed]',
      ),
    )
    expect(tasks.map((t) => [t.name, t.state, t.delivers, t.files, t.removed])).toEqual([
      ['Cancel command', 'tested', ['Cancel command', 'Shipped order'], ['src/orders/cancel.ts', 'src/orders/cancel.test.ts'], false],
      ['Reservation', 'done', ['Release'], ['src/orders/reservation.ts'], false],
      ['Report', 'in_progress', [], [], false],
      ['Old flag', 'blocked', [], [], false],
      ['Planned', 'open', [], [], false],
      ['Gone', 'open', [], [], true],
    ])
    expect(tasks[0]!.text).toBe('add the cancel command [tested]')
    expect(tasks[0]!.proves).toEqual([
      { item: 'Cancel command', file: 'src/orders/cancel.test.ts', test: 'an_open_order_can_be_cancelled' },
      { item: 'Shipped order', file: 'src/orders/cancel.test.ts', test: 'a_shipped_order_cannot' },
    ])
    expect(tasks[1]!.proves).toEqual([])
    // What the mapping read is carried to the implementer apart from what it touches.
    expect(tasks[0]!.context).toEqual(['src/orders/order.ts', 'src/orders/ship.test.ts'])
    expect(tasks[1]!.context).toEqual([])
  })

  it('tasks_carry_the_heading_they_sit_under_and_verification_is_not_a_group', () => {
    const { tasks, verification } = parseTasks(
      board(
        '- **Alone**: before any heading',
        '## Foundation',
        '- **Contract**: the shared module',
        '## Cancelling',
        '- **Cancel command**: a',
        '- **Refund**: b',
        '',
        '## Verification',
        '- 2026-09-14T10:00:00Z: passed',
      ),
    )
    expect(tasks.map((t) => [t.name, t.group])).toEqual([
      ['Alone', undefined],
      ['Contract', 'Foundation'],
      ['Cancel command', 'Cancelling'],
      ['Refund', 'Cancelling'],
    ])
    expect(verification?.ok).toBe(true)
  })

  it('coverage_reads_both_ways_which_task_delivers_an_item_and_which_test_proves_it', () => {
    const { tasks } = parseTasks(
      board(
        '- **One** (Cancel command, Shipped order): a [tested]',
        '  - proves: Cancel command → test/a.test.ts cancel_holds',
        '- **Two** (Refund): b',
        '- **Three** (Release): gone [removed]',
      ),
    )
    expect(deliveredBy(tasks, 'shipped order')?.name).toBe('One')
    expect(deliveredBy(tasks, 'Release')).toBeUndefined()
    expect(provenBy(tasks, 'Cancel command')).toEqual({ item: 'Cancel command', file: 'test/a.test.ts', test: 'cancel_holds' })
    expect(provenBy(tasks, 'Shipped order')).toBeUndefined()
    // One is marked tested but Shipped order has no test named: a finish the evidence does not back.
    expect(unprovenItems(tasks)).toEqual(['Shipped order'])
    expect(undeliveredItems(tasks, ['Cancel command', 'Refund', 'Release', 'Shipped order', 'Nowhere'])).toEqual(['Release', 'Nowhere'])
  })

  it('the_board_remembers_the_spec_it_was_mapped_from', () => {
    const text = board('- **A**: a')
    expect(parseTasks(text).spec).toBeUndefined()
    const stamped = withSpecFingerprint(text, 'abc12345')
    expect(stamped.startsWith('---\nspec: abc12345\n---\n')).toBe(true)
    const parsed = parseTasks(stamped)
    expect(parsed.spec).toBe('abc12345')
    expect(parsed.tasks.map((t) => t.name)).toEqual(['A'])
    expect(tasksFresh({ exists: true, ...parsed }, 'abc12345')).toBe(true)
    expect(tasksFresh({ exists: true, ...parsed }, 'ffff0000')).toBe(false)
    // A board from before the stamp is not stale on account of the stamp alone.
    expect(tasksFresh({ exists: true, ...parseTasks(text) }, 'ffff0000')).toBe(true)
    // Restamping replaces, and the record section still lands at the end.
    expect(parseTasks(withSpecFingerprint(stamped, 'def00000')).spec).toBe('def00000')
    expect(parseTasks(withRecord(stamped, { at: 't', ok: true, text: '' })).verification?.ok).toBe(true)
  })

  it('blocked_wins_over_a_finish_marker_left_from_an_earlier_run', () => {
    const { tasks } = parseTasks(board('- **A**: a [tested] [blocked: the API moved]'))
    expect(tasks[0]!.state).toBe('blocked')
  })

  it('is_done_only_when_every_live_task_is_tested', () => {
    expect(tasksDone(parseTasks(board('- **A**: a [tested]', '- **B**: b [tested]', '- **C**: c [removed]')).tasks)).toBe(true)
    // Done is code written, not proven: the tests for it have to pass first.
    expect(tasksDone(parseTasks(board('- **A**: a [tested]', '- **B**: b [done]')).tasks)).toBe(false)
    expect(tasksDone(parseTasks(board('- **A**: a [tested]', '- **B**: b [blocked: needs a decision]')).tasks)).toBe(false)
    // A board with no tasks at all is not vacuously finished.
    expect(tasksDone(parseTasks(board()).tasks)).toBe(false)
  })

  it('work_has_started_once_any_task_carries_a_marker', () => {
    expect(started(parseTasks(board('- **A**: a', '- **B**: b')).tasks)).toBe(false)
    expect(started(parseTasks(board('- **A**: a [in progress]', '- **B**: b')).tasks)).toBe(true)
  })

  it('collects_the_files_of_live_tasks_once_each', () => {
    const { tasks } = parseTasks(
      board(
        '- **A**: a',
        '  - files: src/a.ts, src/b.ts',
        '- **B**: b',
        '  - files: src/b.ts, src/c.ts',
        '- **C**: c [removed]',
        '  - files: src/gone.ts',
      ),
    )
    expect(taskFiles(tasks)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  it('reads_the_newest_verification_record_and_writes_a_new_one_on_top', () => {
    const text = board('- **A**: a [tested]')
    expect(parseTasks(text).verification).toBeUndefined()
    const failed = withRecord(text, { at: '2026-09-14T09:40:00Z', ok: false, text: '`npm test` in .' })
    expect(parseTasks(failed).verification).toEqual({ at: '2026-09-14T09:40:00Z', ok: false, text: '`npm test` in .' })
    const passed = withRecord(failed, { at: '2026-09-14T10:00:00Z', ok: true, text: '' })
    expect(parseTasks(passed).verification).toEqual({ at: '2026-09-14T10:00:00Z', ok: true, text: '' })
    expect(passed).toContain('## Verification\n- 2026-09-14T10:00:00Z: passed\n- 2026-09-14T09:40:00Z: failed, `npm test` in .')
    // A record line is not a task, and a task after the section is not a record.
    expect(parseTasks(passed).tasks.map((t) => t.name)).toEqual(['A'])
  })

  it('names_the_file_by_the_feature_slug', () => {
    expect(tasksFile('Order cancellation')).toBe('plan/order-cancellation.tasks.md')
  })
})
