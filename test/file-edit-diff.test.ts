import { describe, expect, it } from 'vitest'
import { DIFF_LINE_BUDGET, capDiffs, fileEditChange, omittedNotice } from '../src/agent/edits/file-edit-diff'
import { applyEdits, editedPath, isDiffable, isFileEdit } from '../src/agent/edits/edit-tools'

const lines = (...text: string[]) => text.join('\n') + '\n'
const numbered = (count: number, mark = '') => lines(...Array.from({ length: count }, (_, i) => `line ${i + 1}${mark}`))

describe('fileEditChange', () => {
  it('a_new_file_shows_as_an_all_additions_diff', () => {
    const change = fileEditChange({ path: '/w/a.ts', label: 'a.ts', states: ['', lines('one', 'two')] })
    expect(change.diffs).toEqual(['@@ -0,0 +1,2 @@\n+one\n+two'])
    expect(change).toMatchObject({ omitted: 0, added: 2, removed: 0, line: 1 })
    expect(change.summary).toBeUndefined()
  })

  it('an_overwrite_shows_as_a_diff_against_the_prior_content', () => {
    const change = fileEditChange({ path: '/w/a.ts', label: 'a.ts', states: [lines('one', 'two'), lines('one', 'TWO')] })
    expect(change.diffs).toEqual(['@@ -1,2 +1,2 @@\n one\n-two\n+TWO'])
    expect(change).toMatchObject({ added: 1, removed: 1, line: 2 })
  })

  it('a_write_of_the_content_already_on_disk_says_so_instead_of_showing_an_empty_diff', () => {
    const same = lines('one', 'two')
    const change = fileEditChange({ path: '/w/a.ts', label: 'a.ts', states: [same, same] })
    expect(change.diffs).toEqual([])
    expect(change.summary).toBe('a.ts: no change')
    expect(change.snapshot).toBeUndefined()
  })

  it('content_that_is_not_text_is_reported_in_summary_form_with_no_diff_and_no_link', () => {
    const change = fileEditChange({ path: '/w/a.png', label: 'a.png', unreadable: 'binary file' })
    expect(change).toEqual({ path: '/w/a.png', label: 'a.png', diffs: [], omitted: 0, summary: 'a.png: binary file' })
  })

  it('a_diff_longer_than_the_budget_keeps_its_first_lines_and_counts_the_rest', () => {
    const change = fileEditChange({ path: '/w/a.ts', label: 'a.ts', states: ['', numbered(40)] })
    const shown = change.diffs.join('\n').split('\n')
    expect(shown).toHaveLength(DIFF_LINE_BUDGET)
    expect(shown[0]).toBe('@@ -0,0 +1,40 @@')
    expect(shown[1]).toBe('+line 1')
    // 41 lines of diff: the hunk header and one per added line.
    expect(change.omitted).toBe(41 - DIFF_LINE_BUDGET)
  })

  it('a_diff_inside_the_budget_is_shown_whole_with_nothing_omitted', () => {
    const change = fileEditChange({ path: '/w/a.ts', label: 'a.ts', states: ['', numbered(5)] })
    expect(change.omitted).toBe(0)
    expect(change.diffs.join('\n').split('\n')).toHaveLength(6)
  })

  it('several_edits_in_one_step_are_several_diffs_under_one_shared_budget', () => {
    const start = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
    const afterFirst = start.map((text, i) => (i >= 4 && i <= 6 ? `early ${i + 1}` : text))
    const afterSecond = afterFirst.map((text, i) => (i >= 29 && i <= 31 ? `late ${i + 1}` : text))
    const change = fileEditChange({
      path: '/w/a.ts',
      label: 'a.ts',
      states: [lines(...start), lines(...afterFirst), lines(...afterSecond)],
    })
    expect(change.diffs).toHaveLength(2)
    expect(change.diffs.join('\n').split('\n')).toHaveLength(DIFF_LINE_BUDGET)
    expect(change.omitted).toBeGreaterThan(0)
  })

  it('the_omission_notice_states_how_many_lines_are_left_out', () => {
    expect(omittedNotice(26)).toBe('26 more diff lines — open the full edit')
    expect(omittedNotice(1)).toBe('1 more diff line — open the full edit')
  })

  it('capDiffs_spends_the_budget_in_order_and_reports_what_it_dropped', () => {
    expect(capDiffs([['a', 'b'], ['c']], 15)).toEqual({ diffs: [['a', 'b'], ['c']], omitted: 0 })
    expect(capDiffs([['a', 'b'], ['c']], 2)).toEqual({ diffs: [['a', 'b']], omitted: 1 })
    expect(capDiffs([['a', 'b', 'c']], 2)).toEqual({ diffs: [['a', 'b']], omitted: 1 })
  })
})

describe('edit tools', () => {
  it('every_step_that_writes_a_file_counts_as_a_file_edit', () => {
    expect(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].every(isFileEdit)).toBe(true)
    expect(['Read', 'Bash', 'Grep'].some(isFileEdit)).toBe(false)
    // A cell inside JSON is not readable as a text diff.
    expect(isDiffable('NotebookEdit')).toBe(false)
    expect(isDiffable('Edit')).toBe(true)
  })

  it('the_edited_path_is_taken_from_the_step_however_it_names_it', () => {
    expect(editedPath({ file_path: 'src/a.ts' })).toBe('src/a.ts')
    expect(editedPath({ notebook_path: 'n.ipynb' })).toBe('n.ipynb')
    expect(editedPath({ pattern: 'x' })).toBeUndefined()
  })

  it('a_proposed_change_is_worked_out_per_edit_so_each_edit_gets_its_own_diff', () => {
    const before = lines('a', 'b', 'c')
    expect(applyEdits(before, 'Write', { content: 'new' })).toEqual([before, 'new'])
    expect(applyEdits(before, 'Edit', { old_string: 'b', new_string: 'B' })).toEqual([before, lines('a', 'B', 'c')])
    expect(
      applyEdits(before, 'MultiEdit', {
        edits: [
          { old_string: 'a', new_string: 'A' },
          { old_string: 'c', new_string: 'C' },
        ],
      }),
    ).toEqual([before, lines('A', 'b', 'c'), lines('A', 'b', 'C')])
  })

  it('a_change_that_cannot_be_worked_out_is_not_guessed_at', () => {
    expect(applyEdits('a\n', 'Edit', { old_string: 'nowhere', new_string: 'x' })).toBeUndefined()
    expect(applyEdits('a\n', 'NotebookEdit', { new_source: 'x' })).toBeUndefined()
    expect(applyEdits('', 'Edit', { old_string: '', new_string: 'fresh' })).toEqual(['', 'fresh'])
  })

  it('replace_all_replaces_every_occurrence_and_the_default_replaces_the_first', () => {
    expect(applyEdits('x x\n', 'Edit', { old_string: 'x', new_string: 'y' })).toEqual(['x x\n', 'y x\n'])
    expect(applyEdits('x x\n', 'Edit', { old_string: 'x', new_string: 'y', replace_all: true })).toEqual(['x x\n', 'y y\n'])
  })
})
