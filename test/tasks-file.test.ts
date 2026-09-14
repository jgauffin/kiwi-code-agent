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
  it('reads_each_tasks_state_delivered_items_and_files', () => {
    const { tasks } = parseTasks(
      board(
        '- T1 (B1, E2): add the cancel command [tested]',
        '  - files: src/orders/cancel.ts, src/orders/cancel.test.ts (new)',
        '  - proves: B1 src/orders/cancel.test.ts an_open_order_can_be_cancelled, E2 src/orders/cancel.test.ts a_shipped_order_cannot',
        '  - context: src/orders/order.ts, src/orders/ship.test.ts',
        '- T2 (B3): release the reservation [done]',
        '  - files: src/orders/reservation.ts',
        '- T3: report on cancellations [in progress]',
        '- T4: drop the old flag [blocked: the flag is read by billing]',
        '- T5: something planned',
        '- T6: gone [removed]',
      ),
    )
    expect(tasks.map((t) => [t.id, t.state, t.delivers, t.files, t.removed])).toEqual([
      ['T1', 'tested', ['B1', 'E2'], ['src/orders/cancel.ts', 'src/orders/cancel.test.ts'], false],
      ['T2', 'done', ['B3'], ['src/orders/reservation.ts'], false],
      ['T3', 'in_progress', [], [], false],
      ['T4', 'blocked', [], [], false],
      ['T5', 'open', [], [], false],
      ['T6', 'open', [], [], true],
    ])
    expect(tasks[0]!.text).toBe('add the cancel command [tested]')
    expect(tasks[0]!.proves).toEqual([
      { item: 'B1', file: 'src/orders/cancel.test.ts', test: 'an_open_order_can_be_cancelled' },
      { item: 'E2', file: 'src/orders/cancel.test.ts', test: 'a_shipped_order_cannot' },
    ])
    expect(tasks[1]!.proves).toEqual([])
    // What the mapping read is carried to the implementer apart from what it touches.
    expect(tasks[0]!.context).toEqual(['src/orders/order.ts', 'src/orders/ship.test.ts'])
    expect(tasks[1]!.context).toEqual([])
  })

  it('coverage_reads_both_ways_which_task_delivers_an_item_and_which_test_proves_it', () => {
    const { tasks } = parseTasks(
      board(
        '- T1 (B1, E1): a [tested]',
        '  - proves: B1 test/a.test.ts b1_holds',
        '- T2 (B2): b',
        '- T3 (B3): gone [removed]',
      ),
    )
    expect(deliveredBy(tasks, 'E1')?.id).toBe('T1')
    expect(deliveredBy(tasks, 'B3')).toBeUndefined()
    expect(provenBy(tasks, 'B1')).toEqual({ item: 'B1', file: 'test/a.test.ts', test: 'b1_holds' })
    expect(provenBy(tasks, 'E1')).toBeUndefined()
    // T1 is marked tested but E1 has no test named: a finish the evidence does not back.
    expect(unprovenItems(tasks)).toEqual(['E1'])
    expect(undeliveredItems(tasks, ['B1', 'B2', 'B3', 'E1', 'E9'])).toEqual(['B3', 'E9'])
  })

  it('the_board_remembers_the_spec_it_was_mapped_from', () => {
    const text = board('- T1: a')
    expect(parseTasks(text).spec).toBeUndefined()
    const stamped = withSpecFingerprint(text, 'abc12345')
    expect(stamped.startsWith('---\nspec: abc12345\n---\n')).toBe(true)
    const parsed = parseTasks(stamped)
    expect(parsed.spec).toBe('abc12345')
    expect(parsed.tasks.map((t) => t.id)).toEqual(['T1'])
    expect(tasksFresh({ exists: true, ...parsed }, 'abc12345')).toBe(true)
    expect(tasksFresh({ exists: true, ...parsed }, 'ffff0000')).toBe(false)
    // A board from before the stamp is not stale on account of the stamp alone.
    expect(tasksFresh({ exists: true, ...parseTasks(text) }, 'ffff0000')).toBe(true)
    // Restamping replaces, and the record section still lands at the end.
    expect(parseTasks(withSpecFingerprint(stamped, 'def00000')).spec).toBe('def00000')
    expect(parseTasks(withRecord(stamped, { at: 't', ok: true, text: '' })).verification?.ok).toBe(true)
  })

  it('blocked_wins_over_a_finish_marker_left_from_an_earlier_run', () => {
    const { tasks } = parseTasks(board('- T1: a [tested] [blocked: the API moved]'))
    expect(tasks[0]!.state).toBe('blocked')
  })

  it('is_done_only_when_every_live_task_is_tested', () => {
    expect(tasksDone(parseTasks(board('- T1: a [tested]', '- T2: b [tested]', '- T3: c [removed]')).tasks)).toBe(true)
    // Done is code written, not proven: the tests for it have to pass first.
    expect(tasksDone(parseTasks(board('- T1: a [tested]', '- T2: b [done]')).tasks)).toBe(false)
    expect(tasksDone(parseTasks(board('- T1: a [tested]', '- T2: b [blocked: needs a decision]')).tasks)).toBe(false)
    // A board with no tasks at all is not vacuously finished.
    expect(tasksDone(parseTasks(board()).tasks)).toBe(false)
  })

  it('work_has_started_once_any_task_carries_a_marker', () => {
    expect(started(parseTasks(board('- T1: a', '- T2: b')).tasks)).toBe(false)
    expect(started(parseTasks(board('- T1: a [in progress]', '- T2: b')).tasks)).toBe(true)
  })

  it('collects_the_files_of_live_tasks_once_each', () => {
    const { tasks } = parseTasks(
      board(
        '- T1: a',
        '  - files: src/a.ts, src/b.ts',
        '- T2: b',
        '  - files: src/b.ts, src/c.ts',
        '- T3: c [removed]',
        '  - files: src/gone.ts',
      ),
    )
    expect(taskFiles(tasks)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  it('reads_the_newest_verification_record_and_writes_a_new_one_on_top', () => {
    const text = board('- T1: a [tested]')
    expect(parseTasks(text).verification).toBeUndefined()
    const failed = withRecord(text, { at: '2026-09-14T09:40:00Z', ok: false, text: '`npm test` in .' })
    expect(parseTasks(failed).verification).toEqual({ at: '2026-09-14T09:40:00Z', ok: false, text: '`npm test` in .' })
    const passed = withRecord(failed, { at: '2026-09-14T10:00:00Z', ok: true, text: '' })
    expect(parseTasks(passed).verification).toEqual({ at: '2026-09-14T10:00:00Z', ok: true, text: '' })
    expect(passed).toContain('## Verification\n- 2026-09-14T10:00:00Z: passed\n- 2026-09-14T09:40:00Z: failed, `npm test` in .')
    // A record line is not a task, and a task after the section is not a record.
    expect(parseTasks(passed).tasks.map((t) => t.id)).toEqual(['T1'])
  })

  it('names_the_file_by_the_feature_slug', () => {
    expect(tasksFile('Order cancellation')).toBe('plan/order-cancellation.tasks.md')
  })
})
