import { describe, expect, it } from 'vitest'
import { linkedFilePath, withLinkedFiles } from '../src/chat/linked-files'

describe('naming a file linked from the editor', () => {
  it('a_file_in_the_workspace_is_named_relative_to_it_with_forward_slashes', () => {
    expect(linkedFilePath('D:\\src\\app', 'D:\\src\\app\\src\\chat\\protocol.ts')).toBe('src/chat/protocol.ts')
  })

  it('a_file_outside_the_workspace_keeps_its_full_path_so_the_agent_can_still_find_it', () => {
    expect(linkedFilePath('D:\\src\\app', 'D:\\other\\notes.md')).toBe('D:/other/notes.md')
  })
})

describe('the prompt for a send with linked files', () => {
  it('the_request_is_followed_by_the_files_to_read', () => {
    expect(withLinkedFiles('rename the field', ['src/a.ts', 'src/b.ts'])).toBe(
      'rename the field\n\nRead these files first; the request is about them:\n- src/a.ts\n- src/b.ts',
    )
  })

  it('a_send_without_links_is_the_prompt_the_user_typed', () => {
    expect(withLinkedFiles('rename the field', [])).toBe('rename the field')
  })
})
