import { describe, expect, it } from 'vitest'
import { RepeatedEdit } from '../src/agent/script/repeated-edit'

const edit = (file_path: string, old_string: string, new_string: string, isError = false) => ({
  toolName: 'Edit',
  input: { file_path, old_string, new_string },
  toolUseId: 'e',
  output: '',
  isError,
})
const note = (outcome: { additionalContext?: string } | undefined) => outcome?.additionalContext ?? ''

describe('the repeated edit note', () => {
  it('the_same_change_in_a_third_file_points_at_RunScript', async () => {
    const hook = new RepeatedEdit()
    expect(note(await hook.postToolUse(edit('a.ts', 'const u = getUser(id)', 'const u = fetchUser(id)')))).toBe('')
    expect(note(await hook.postToolUse(edit('b.ts', 'return getUser(x)', 'return fetchUser(x)')))).toBe('')
    const third = note(await hook.postToolUse(edit('c.ts', 'await getUser(1)', 'await fetchUser(1)')))
    expect(third).toContain('RunScript')
    expect(third).toContain('a.ts')
    expect(third).toContain('b.ts')
  })

  it('different_changes_in_three_files_get_no_note', async () => {
    const hook = new RepeatedEdit()
    await hook.postToolUse(edit('a.ts', 'one', 'two'))
    await hook.postToolUse(edit('b.ts', 'three', 'four'))
    expect(note(await hook.postToolUse(edit('c.ts', 'five', 'six')))).toBe('')
  })

  it('the_same_file_edited_three_times_gets_no_note', async () => {
    const hook = new RepeatedEdit()
    await hook.postToolUse(edit('a.ts', 'getUser(1)', 'fetchUser(1)'))
    await hook.postToolUse(edit('a.ts', 'getUser(2)', 'fetchUser(2)'))
    expect(note(await hook.postToolUse(edit('a.ts', 'getUser(3)', 'fetchUser(3)')))).toBe('')
  })

  it('the_note_is_given_once_per_change', async () => {
    const hook = new RepeatedEdit()
    for (const f of ['a.ts', 'b.ts', 'c.ts']) await hook.postToolUse(edit(f, 'getUser(', 'fetchUser('))
    expect(note(await hook.postToolUse(edit('d.ts', 'getUser(', 'fetchUser(')))).toBe('')
  })

  it('a_failed_edit_does_not_count', async () => {
    const hook = new RepeatedEdit()
    await hook.postToolUse(edit('a.ts', 'getUser(', 'fetchUser('))
    await hook.postToolUse(edit('b.ts', 'getUser(', 'fetchUser(', true))
    expect(note(await hook.postToolUse(edit('c.ts', 'getUser(', 'fetchUser(')))).toBe('')
  })

  it('a_MultiEdit_counts_each_of_its_edits', async () => {
    const hook = new RepeatedEdit()
    await hook.postToolUse(edit('a.ts', 'getUser(', 'fetchUser('))
    await hook.postToolUse(edit('b.ts', 'getUser(', 'fetchUser('))
    const multi = {
      toolName: 'MultiEdit',
      input: { file_path: 'c.ts', edits: [{ old_string: 'x', new_string: 'y' }, { old_string: 'getUser(', new_string: 'fetchUser(' }] },
      toolUseId: 'm',
      output: '',
      isError: false,
    }
    expect(note(await hook.postToolUse(multi))).toContain('RunScript')
  })
})
