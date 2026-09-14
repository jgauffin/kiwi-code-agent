import { describe, expect, it } from 'vitest'
import { editedFiles } from '../src/agent/edits/edited-files'
import type { SessionEvent } from '../src/agent/session/code-session'
import type { FileEditChange } from '../src/agent/edits/file-edit-diff'

const change = (path: string): FileEditChange => ({ path, label: path, diffs: [], omitted: 0 })

const edited = (path: string, isError = false): SessionEvent => ({ type: 'tool_result', toolUseId: 't', text: '', isError, edit: change(path) })

describe('editedFiles', () => {
  it('a_file_is_edited_when_its_step_carried_a_change_and_did_not_fail', () => {
    const events: SessionEvent[] = [
      { type: 'tool_call', toolUseId: 'r', name: 'Read', input: { file_path: '/w/read.ts' } },
      { type: 'tool_result', toolUseId: 'r', text: 'contents', isError: false },
      edited('/w/a.ts'),
      edited('/w/b.ts', true),
      { type: 'tool_result', toolUseId: 'x', text: 'no edit', isError: false },
    ]
    expect(editedFiles(events)).toEqual(['/w/a.ts'])
  })

  it('a_file_edited_twice_is_listed_once_in_first_edit_order_and_a_subagent_edit_counts', () => {
    const events: SessionEvent[] = [
      edited('/w/b.ts'),
      edited('/w/a.ts'),
      { ...edited('/w/b.ts'), parentToolUseId: 'agent' },
      { ...edited('/w/c.ts'), parentToolUseId: 'agent' },
    ]
    expect(editedFiles(events)).toEqual(['/w/b.ts', '/w/a.ts', '/w/c.ts'])
  })
})
