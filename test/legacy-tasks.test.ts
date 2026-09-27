import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boardFromMarkdown, convertLegacyBoard, modernizeTasks } from '../src/agent/phases/legacy-tasks'
import { parseBoard, readBoard, renderBoard } from '../src/agent/phases/tasks-file'
import { board, task } from './task-board-fixture'

const markdown = (...lines: string[]): string => `# Tasks for Order cancellation\n\n${lines.join('\n')}\n`

describe('a markdown board converts with nothing lost', () => {
  it('state_rules_files_proofs_context_and_note_become_fields', () => {
    const { tasks } = boardFromMarkdown(
      markdown(
        '- **Cancel command** (Cancel command, Shipped order): add the cancel command [tested]',
        '  - files: src/orders/cancel.ts, src/orders/cancel.test.ts (new)',
        '  - proves: Cancel command → src/orders/cancel.test.ts an_open_order_can_be_cancelled, Shipped order -> src/orders/cancel.test.ts a_shipped_order_cannot',
        '  - context: src/orders/order.ts, src/orders/ship.test.ts',
        '  - note: the guard sits on Order',
        '- **Report**: report on cancellations [in progress]',
        '- **Old flag**: drop the old flag [blocked: the flag is read by billing]',
        '- **Planned**: something planned',
        '- **Gone**: gone [removed]',
      ),
    )
    expect(tasks[0]).toEqual({
      name: 'Cancel command',
      text: 'add the cancel command',
      delivers: ['Cancel command', 'Shipped order'],
      files: ['src/orders/cancel.ts', 'src/orders/cancel.test.ts'],
      newFiles: ['src/orders/cancel.test.ts'],
      context: ['src/orders/order.ts', 'src/orders/ship.test.ts'],
      how: '',
      proves: [
        { item: 'Cancel command', file: 'src/orders/cancel.test.ts', test: 'an_open_order_can_be_cancelled' },
        { item: 'Shipped order', file: 'src/orders/cancel.test.ts', test: 'a_shipped_order_cannot' },
      ],
      note: 'the guard sits on Order',
      built: '',
      state: 'tested',
      removed: false,
    })
    expect(tasks.slice(1).map((t) => [t.name, t.text, t.state, t.blockedReason, t.removed])).toEqual([
      ['Report', 'report on cancellations', 'in_progress', undefined, false],
      ['Old flag', 'drop the old flag', 'blocked', 'the flag is read by billing', false],
      ['Planned', 'something planned', 'open', undefined, false],
      ['Gone', 'gone', 'open', undefined, true],
    ])
  })

  it('a_how_block_is_read_whole_and_ends_at_the_next_key_task_or_heading', () => {
    const { tasks } = boardFromMarkdown(
      markdown(
        '- **Cancel command** (Cancel command): add the cancel command [tested]',
        '  - how:',
        '    - add `cancel()` on `Order` beside `ship()`',
        '      - files: none of this is a files line',
        '  - files: src/orders/cancel.ts',
        '- **Report**: report',
        '  - how: copy the shape of src/reports/daily.ts',
        '## Next',
        '- **Two**: second',
      ),
    )
    expect(tasks[0]!.how).toBe('- add `cancel()` on `Order` beside `ship()`\n  - files: none of this is a files line')
    expect(tasks[0]!.files).toEqual(['src/orders/cancel.ts'])
    expect(tasks[1]!.how).toBe('copy the shape of src/reports/daily.ts')
    expect(tasks[2]).toMatchObject({ name: 'Two', group: 'Next', how: '' })
  })

  it('blocked_wins_over_a_finish_marker_left_from_an_earlier_run', () => {
    expect(boardFromMarkdown(markdown('- **A**: a [tested] [blocked: the API moved]')).tasks[0]).toMatchObject({ state: 'blocked', blockedReason: 'the API moved', text: 'a' })
  })

  it('front_matter_and_every_verification_record_carry_over', () => {
    const converted = boardFromMarkdown(
      `---\nspec: abc12345\ncleanup: postponed\n---\n${markdown('- **A**: a [tested]', '', '## Verification', '- 2026-09-14T10:00:00Z: passed', '- 2026-09-14T09:40:00Z: failed, `npm test` in .')}`,
    )
    expect(converted).toMatchObject({ spec: 'abc12345', cleanup: 'postponed' })
    expect(converted.verification).toEqual([
      { at: '2026-09-14T10:00:00Z', ok: true, text: '' },
      { at: '2026-09-14T09:40:00Z', ok: false, text: '`npm test` in .' },
    ])
    expect(converted.tasks.map((t) => t.name)).toEqual(['A'])
    // What the extension never wrote is no decision at all.
    expect(boardFromMarkdown(`---\ncleanup: maybe\n---\n${markdown('- **A**: a')}`).cleanup).toBeUndefined()
  })

  it('an_id_based_board_is_named_and_its_proofs_paired_before_it_converts', () => {
    const old = '# Tasks for X\n\n- T1 (B1, E1): a [tested]\n  - files: src/a.ts\n  - proves: B1 test/a.test.ts b1_holds, E1 test/a.test.ts e1_holds\n- T2: b\n'
    const text = modernizeTasks(old)
    expect(text).toBe('# Tasks for X\n\n- **T1** (B1, E1): a [tested]\n  - files: src/a.ts\n  - proves: B1 → test/a.test.ts b1_holds, E1 → test/a.test.ts e1_holds\n- **T2**: b\n')
    expect(modernizeTasks(text)).toBe(text)
    expect(boardFromMarkdown(text).tasks.map((t) => [t.name, t.delivers, t.proves.length])).toEqual([
      ['T1', ['B1', 'E1'], 2],
      ['T2', [], 0],
    ])
  })
})

describe('convertLegacyBoard', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'legacy-tasks-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('writes_the_json_board_removes_the_markdown_and_keeps_its_age', async () => {
    const md = join(dir, 'audit.tasks.md')
    await writeFile(md, markdown('- **A**: a [done]'))
    const old = new Date('2026-01-01T00:00:00Z')
    await utimes(md, old, old)
    expect(await convertLegacyBoard(md)).toBe(true)
    expect(existsSync(md)).toBe(false)
    const json = join(dir, 'audit.tasks.json')
    expect((await readBoard(json))?.tasks[0]).toMatchObject({ name: 'A', state: 'done' })
    // The housekeeping counts a week from the last touch; converting is not a touch.
    expect((await stat(json)).mtime.getTime()).toBe(old.getTime())
  })

  it('a_json_board_already_there_wins_and_the_markdown_is_left', async () => {
    const md = join(dir, 'audit.tasks.md')
    await writeFile(md, markdown('- **Old**: o'))
    await writeFile(join(dir, 'audit.tasks.json'), renderBoard(board(task('New'))))
    expect(await convertLegacyBoard(md)).toBe(false)
    expect(existsSync(md)).toBe(true)
    expect(parseBoard(await readFile(join(dir, 'audit.tasks.json'), 'utf8')).tasks.map((t) => t.name)).toEqual(['New'])
  })

  it('no_markdown_board_is_nothing_to_convert', async () => {
    expect(await convertLegacyBoard(join(dir, 'none.tasks.md'))).toBe(false)
  })
})
