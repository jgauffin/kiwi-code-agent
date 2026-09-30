import { describe, expect, it } from 'vitest'
import { advance, editedUnitFile, finished, measured, resumed, settled, startProgress } from '../src/chat/cleanup-progress'
import type { CleanupUnit } from '../src/chat/protocol'
import type { SessionEvent } from '../src/agent/session/code-session'

const ROOT = '/w'
const relativeTo = (path: string) => (path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path)

const unit = (path: string, name: string, kind: CleanupUnit['kind'] = 'function'): CleanupUnit => ({ path, line: 10, name, kind, lines: 90, threshold: 60 })
const run = unit('src/run.ts', 'run')
const parse = unit('src/run.ts', 'parse')
const report = unit('src/report.ts', 'report')

const call = (name: string, file: string): SessionEvent => ({ type: 'tool_call', toolUseId: 't', name, input: { file_path: file } })
const edited = (file: string): SessionEvent => ({
  type: 'tool_result',
  toolUseId: 't',
  text: 'ok',
  isError: false,
  edit: { path: file, hunks: [] } as never,
})

describe('the cleanup split, unit by unit', () => {
  it('every_unit_waits_until_the_run_reaches_its_file', () => {
    const progress = startProgress([run, report])
    expect(progress.units.map((u) => u.state)).toEqual(['waiting', 'waiting'])
    expect(progress.stage).toBe('splitting')
  })

  it('reading_a_flagged_file_marks_its_units_working_and_leaves_the_others_waiting', () => {
    const progress = advance(startProgress([run, parse, report]), call('Read', '/w/src/run.ts'), relativeTo)
    expect(progress.units.map((u) => u.state)).toEqual(['working', 'working', 'waiting'])
    expect(progress.activity).toBe('Read /w/src/run.ts')
  })

  it('an_edit_on_a_file_outside_the_list_is_a_file_split_into', () => {
    const progress = advance(startProgress([run]), edited('/w/src/run-parse.ts'), relativeTo)
    expect(progress.newFiles).toEqual(['src/run-parse.ts'])
  })

  it('an_edit_on_the_moves_file_records_moves_and_is_no_split', () => {
    const progress = advance(startProgress([run]), edited('/w/plan/unfiled-moves.md'), relativeTo)
    expect(progress.newFiles).toEqual([])
    expect(progress.movesFile).toBe('plan/unfiled-moves.md')
  })

  it('an_edit_on_a_flagged_file_asks_for_that_file_to_be_measured_again', () => {
    const progress = startProgress([run, report])
    expect(editedUnitFile(progress, edited('/w/src/run.ts'), relativeTo)).toBe('src/run.ts')
    expect(editedUnitFile(progress, edited('/w/src/other.ts'), relativeTo)).toBeUndefined()
  })

  it('a_question_holds_the_split_until_it_is_answered', () => {
    const asking = advance(startProgress([run]), { type: 'question_request', requestId: 'q', request: { questions: [] } as never }, relativeTo)
    expect(asking.stage).toBe('asking')
    const answered = advance(asking, { type: 'question_resolved', requestId: 'q', outcome: { kind: 'unanswered' } as never }, relativeTo)
    expect(answered.stage).toBe('splitting')
  })

  it('a_unit_the_measure_no_longer_finds_is_within_its_limit', () => {
    const working = advance(startProgress([run, parse]), call('Edit', '/w/src/run.ts'), relativeTo)
    const progress = measured(working, 'src/run.ts', [{ ...parse, line: 40 }])
    expect(progress.units.map((u) => [u.name, u.state])).toEqual([
      ['run', 'within'],
      ['parse', 'working'],
    ])
  })

  it('units_still_over_when_the_run_ends_are_over_and_the_tests_run', () => {
    const progress = finished(startProgress([run, report]), [report])
    expect(progress.units.map((u) => u.state)).toEqual(['within', 'over'])
    expect(progress.stage).toBe('testing')
    expect(settled(progress, true, 'Tests passed').stage).toBe('done')
    expect(settled(progress, false, 'Tests failed').outcome).toBe('Tests failed')
  })

  it('talking_to_a_finished_cleanup_sets_it_splitting_again', () => {
    const done = settled(finished(startProgress([run]), [run]), true, 'Tests passed')
    const again = resumed(done)
    expect(again.stage).toBe('splitting')
    expect(again.outcome).toBeUndefined()
    expect(again.units[0]!.state).toBe('waiting')
  })
})
