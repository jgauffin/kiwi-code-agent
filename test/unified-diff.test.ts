import { describe, expect, it } from 'vitest'
import { diffStats, firstChangedLine, splitLines, unifiedDiff } from '../src/agent/edits/unified-diff'

const lines = (...text: string[]) => text.join('\n') + '\n'

describe('unifiedDiff', () => {
  it('a_new_file_is_all_additions', () => {
    expect(unifiedDiff('', lines('one', 'two'))).toEqual(['@@ -0,0 +1,2 @@', '+one', '+two'])
    expect(diffStats('', lines('one', 'two'))).toEqual({ added: 2, removed: 0 })
  })

  it('an_overwrite_is_a_diff_against_the_prior_content', () => {
    const before = lines('one', 'two', 'three')
    const after = lines('one', 'TWO', 'three')
    expect(unifiedDiff(before, after)).toEqual(['@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three'])
    expect(diffStats(before, after)).toEqual({ added: 1, removed: 1 })
  })

  it('context_is_three_lines_on_each_side_and_untouched_regions_are_left_out', () => {
    const before = lines(...Array.from({ length: 20 }, (_, i) => `line ${i + 1}`))
    const after = before.replace('line 10', 'changed')
    const diff = unifiedDiff(before, after)
    expect(diff[0]).toBe('@@ -7,7 +7,7 @@')
    expect(diff.slice(1)).toEqual([' line 7', ' line 8', ' line 9', '-line 10', '+changed', ' line 11', ' line 12', ' line 13'])
  })

  it('two_changes_far_apart_are_two_hunks', () => {
    const before = lines(...Array.from({ length: 30 }, (_, i) => `line ${i + 1}`))
    const after = before.replace('line 3\n', 'line 3\nextra\n').replace('line 25', 'twenty-five')
    const diff = unifiedDiff(before, after)
    expect(diff.filter((l) => l.startsWith('@@'))).toHaveLength(2)
    expect(diff).toContain('+extra')
    expect(diff).toContain('-line 25')
  })

  it('a_deletion_at_the_end_keeps_its_leading_context', () => {
    const before = lines('a', 'b', 'c')
    const after = lines('a', 'b')
    expect(unifiedDiff(before, after)).toEqual(['@@ -1,3 +1,2 @@', ' a', ' b', '-c'])
  })

  it('the_first_changed_line_is_where_the_change_lands_in_the_file_as_it_now_is', () => {
    const before = lines('a', 'b', 'c', 'd')
    expect(firstChangedLine(before, lines('a', 'b', 'B', 'c', 'd'))).toBe(3)
    expect(firstChangedLine(before, before)).toBeUndefined()
    expect(firstChangedLine('', lines('new'))).toBe(1)
  })

  it('a_trailing_newline_does_not_show_up_as_an_empty_line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([])
    expect(unifiedDiff('a\n', 'a')).toEqual([])
  })
})
