import { describe, expect, it } from 'vitest'
import { driftLines, mappedFiles, mappingDrift, mappingFile, readMappingSnapshot, writeMappingSnapshot } from '../src/agent/phases/mapping-snapshot'
import { task } from './task-board-fixture'
import { withWorkspace, writeFiles } from './workspace-fixture'

const FEATURE = 'Order cancellation'

const lines = (...text: string[]) => text.join('\n') + '\n'

describe('the mapping snapshot', () => {
  it('is_named_by_the_feature_slug_beside_the_other_working_files', () => {
    expect(mappingFile(FEATURE)).toBe('.kiwi/specs/order-cancellation.mapping.json')
  })

  it('holds_the_mapped_files_as_they_stood_and_leaves_out_one_that_does_not_exist_yet', async () => {
    await withWorkspace({ 'src/order.ts': lines('one', 'two') }, async (dir) => {
      await writeMappingSnapshot(dir, FEATURE, ['src/order.ts', 'src/refund.ts'])
      const snapshot = await readMappingSnapshot(dir, FEATURE)
      expect(snapshot?.files).toEqual({ 'src/order.ts': lines('one', 'two') })
    })
  })

  it('is_the_files_every_live_task_was_mapped_to_once_each', () => {
    const tasks = [
      task('Cancel', { context: ['src/order.ts', 'src/cancel.ts'], files: ['src/order.ts'] }),
      task('Refund', { context: ['src/order.ts'], files: ['test/refund.test.ts'] }),
      task('Gone', { context: ['src/old.ts'], removed: true }),
    ]
    expect(mappedFiles(tasks)).toEqual(['src/order.ts', 'src/cancel.ts', 'test/refund.test.ts'])
  })
})

describe('what the drift reports', () => {
  it('names_only_the_mapped_files_that_read_differently_now', async () => {
    await withWorkspace({ 'src/order.ts': lines('a', 'b', 'c'), 'src/cancel.ts': lines('x') }, async (dir) => {
      await writeMappingSnapshot(dir, FEATURE, ['src/order.ts', 'src/cancel.ts'])
      await writeFiles(dir, { 'src/order.ts': lines('a', 'CHANGED', 'c') })
      const drift = await mappingDrift(dir, await readMappingSnapshot(dir, FEATURE), ['src/order.ts', 'src/cancel.ts'])
      expect(drift).toEqual([{ file: 'src/order.ts', ranges: [{ from: 2, to: 2 }] }])
    })
  })

  it('a_file_the_mapping_never_saw_is_not_drift', async () => {
    await withWorkspace({ 'src/order.ts': lines('a') }, async (dir) => {
      await writeMappingSnapshot(dir, FEATURE, ['src/order.ts'])
      await writeFiles(dir, { 'src/new.ts': lines('fresh') })
      expect(await mappingDrift(dir, await readMappingSnapshot(dir, FEATURE), ['src/order.ts', 'src/new.ts'])).toEqual([])
    })
  })

  it('a_mapped_file_that_is_gone_is_reported_as_gone', async () => {
    await withWorkspace({ 'src/order.ts': lines('a') }, async (dir) => {
      await writeMappingSnapshot(dir, FEATURE, ['src/order.ts'])
      const drift = await mappingDrift(dir, { at: '2026-01-01T00:00:00.000Z', files: { 'src/missing.ts': lines('was here') } }, ['src/missing.ts'])
      expect(drift).toEqual([{ file: 'src/missing.ts', ranges: [], gone: true }])
    })
  })

  it('without_a_snapshot_nothing_has_drifted', async () => {
    await withWorkspace({ 'src/order.ts': lines('a') }, async (dir) => {
      expect(await readMappingSnapshot(dir, FEATURE)).toBeUndefined()
      expect(await mappingDrift(dir, undefined, ['src/order.ts'])).toEqual([])
    })
  })

  it('the_lines_name_each_file_and_where_to_look_again', () => {
    const text = driftLines([
      { file: 'src/order.ts', ranges: [{ from: 2, to: 2 }, { from: 40, to: 58 }] },
      { file: 'src/gone.ts', ranges: [], gone: true },
    ]).join('\n')
    expect(text).toContain('- src/order.ts: lines 2, 40-58')
    expect(text).toContain('- src/gone.ts: gone')
    expect(driftLines([])).toEqual([])
  })

  it('a_file_changed_in_many_places_is_counted_rather_than_listed', () => {
    const ranges = Array.from({ length: 12 }, (_, i) => ({ from: i * 10, to: i * 10 }))
    expect(driftLines([{ file: 'src/order.ts', ranges }])[1]).toBe('- src/order.ts: changed throughout, in 12 places')
  })
})
