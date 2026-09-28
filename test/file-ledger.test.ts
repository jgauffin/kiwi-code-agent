import { describe, expect, it } from 'vitest'
import { FileLedger } from '../src/agent/openai-session/file-ledger'

const cwd = '/repo'

describe('FileLedger', () => {
  it('renders_nothing_when_the_session_has_touched_no_files', () => {
    expect(new FileLedger().render(cwd)).toBe('')
  })

  it('reports_read_ranges_relative_to_the_workspace', () => {
    const ledger = new FileLedger()
    ledger.read('/repo/src/a.ts', 1, 40)
    expect(ledger.render(cwd)).toContain('- src/a.ts: read 1-40')
  })

  it('merges_reads_that_touch_or_overlap', () => {
    const ledger = new FileLedger()
    ledger.read('/repo/a.ts', 1, 40)
    ledger.read('/repo/a.ts', 41, 10)
    ledger.read('/repo/a.ts', 200, 10)
    expect(ledger.render(cwd)).toContain('- a.ts: read 1-50, 200-209')
  })

  it('a_read_without_a_range_is_the_whole_file_and_swallows_the_ranges', () => {
    const ledger = new FileLedger()
    ledger.read('/repo/a.ts', 1, 40)
    ledger.read('/repo/a.ts')
    expect(ledger.render(cwd)).toContain('- a.ts: read in full')
  })

  it('an_open_ended_read_runs_to_the_end', () => {
    const ledger = new FileLedger()
    ledger.read('/repo/a.ts', 120)
    expect(ledger.render(cwd)).toContain('- a.ts: read 120-end')
  })

  it('carries_writes_and_edit_ranges_alongside_reads', () => {
    const ledger = new FileLedger()
    ledger.read('/repo/a.ts')
    ledger.edited('/repo/a.ts', { from: 120, to: 135 })
    ledger.written('/repo/b.ts')
    const rendered = ledger.render(cwd)
    expect(rendered).toContain('- a.ts: read in full; edited 120-135')
    expect(rendered).toContain('- b.ts: written')
  })

  it('keeps_the_most_recently_touched_files_and_counts_the_rest', () => {
    const ledger = new FileLedger()
    for (let i = 0; i < 10; i++) ledger.read(`/repo/f${i}.ts`)
    const rendered = ledger.render(cwd, 3)
    expect(rendered).toContain('f9.ts')
    expect(rendered).not.toContain('f5.ts')
    expect(rendered).toContain('7 files touched earlier are not listed')
  })

  it('touching_a_file_again_moves_it_back_to_the_front_of_the_queue', () => {
    const ledger = new FileLedger()
    ledger.read('/repo/old.ts')
    ledger.read('/repo/b.ts')
    ledger.read('/repo/c.ts')
    ledger.edited('/repo/old.ts', { from: 1, to: 2 })
    expect(ledger.paths().at(-1)).toBe('/repo/old.ts')
    expect(ledger.render(cwd, 1)).toContain('old.ts')
  })

  it('a_moved_file_is_forgotten', () => {
    const ledger = new FileLedger()
    ledger.read('/repo/a.ts')
    ledger.forget('/repo/a.ts')
    expect(ledger.render(cwd)).toBe('')
  })
})
