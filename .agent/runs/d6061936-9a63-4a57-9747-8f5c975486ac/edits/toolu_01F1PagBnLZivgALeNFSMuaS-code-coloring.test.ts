// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../src/agent/session/code-session'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { editDiffView } = await import('../src/chat/webview/edit-diff')
const { ChatTranscript } = await import('../src/chat/webview/chat-transcript')
const { PermissionCard } = await import('../src/chat/webview/permission-card')

const tokens = (root: Element, cls: string) => [...root.querySelectorAll(`.hljs-${cls}`)].map((n) => n.textContent)

describe('an edit diff in the chat', () => {
  it('colors_each_line_by_the_edited_file_language_and_keeps_the_add_and_delete_marks', () => {
    const view = editDiffView({
      path: 'D:/src/app/main.ts',
      label: 'src/main.ts',
      diffs: ['@@ -1,2 +1,2 @@\n-const a = "x"\n+const a = "y"\n return a'],
      omitted: 0,
    })
    const lines = [...view.querySelectorAll('.diff-line')]
    expect(lines.map((l) => l.className)).toEqual(['diff-line hunk', 'diff-line del', 'diff-line add', 'diff-line ctx'])
    expect(lines.map((l) => l.textContent)).toEqual(['@@ -1,2 +1,2 @@', '-const a = "x"', '+const a = "y"', ' return a'])
    expect(tokens(lines[1]!, 'keyword')).toEqual(['const'])
    expect(tokens(lines[2]!, 'string')).toEqual(['"y"'])
    expect(tokens(lines[3]!, 'keyword')).toEqual(['return'])
    expect(lines[0]!.querySelector('span')).toBeNull()
  })

  it('a_file_of_unknown_type_stays_plain', () => {
    const view = editDiffView({ path: 'D:/src/app/notes.xyz', label: 'notes.xyz', diffs: ['+const a = 1'], omitted: 0 })
    expect(view.querySelector('.diff-line .hljs, .diff-line [class^="hljs-"]')).toBeNull()
    expect(view.querySelector('.diff-line')?.textContent).toBe('+const a = 1')
  })
})

describe('tool input in the transcript', () => {
  it('shell_commands_are_colored_as_shell', () => {
    const view = new ChatTranscript()
    document.body.appendChild(view)
    view.reset([{ type: 'tool_call', toolUseId: 't1', name: 'Bash', input: { command: 'echo "hi" && ls -la', description: 'Say hi' } }])
    const input = view.querySelector('pre.input')!
    expect(input.textContent).toBe('echo "hi"\nls -la')
    expect(tokens(input, 'string')).toEqual(['"hi"'])
  })

  it('other_tool_input_is_colored_as_json', () => {
    const view = new ChatTranscript()
    document.body.appendChild(view)
    view.reset([{ type: 'tool_call', toolUseId: 't1', name: 'Read', input: { file_path: 'a.ts', limit: 5 } }])
    const input = view.querySelector('pre.input')!
    expect(input.textContent).toBe(JSON.stringify({ file_path: 'a.ts', limit: 5 }, null, 2))
    expect(tokens(input, 'attr')).toEqual(['"file_path"', '"limit"'])
    expect(tokens(input, 'number')).toEqual(['5'])
  })
})

describe('a permission card', () => {
  type Request = Extract<SessionEvent, { type: 'permission_request' }>

  function show(request: Request): InstanceType<typeof PermissionCard> {
    const card = new PermissionCard()
    document.body.appendChild(card)
    card.show(request)
    return card
  }

  it('shell_command_lines_are_colored_as_shell', () => {
    const card = show({
      type: 'permission_request',
      requestId: 'r1',
      toolName: 'Bash',
      title: 'Bash',
      input: { command: 'echo "hi"' },
      commands: [{ text: 'echo "hi"', rule: 'Bash(echo:*)' }],
    })
    const code = card.querySelector('li.command code')!
    expect(code.textContent).toBe('echo "hi"')
    expect(tokens(code, 'string')).toEqual(['"hi"'])
  })

  it('other_tool_input_is_colored_as_json', () => {
    const card = show({ type: 'permission_request', requestId: 'r1', toolName: 'WebFetch', title: 'WebFetch', input: { url: 'https://x' }, commands: [] })
    const input = card.querySelector('pre.input')!
    expect(input.textContent).toBe(JSON.stringify({ url: 'https://x' }, null, 2))
    expect(tokens(input, 'attr')).toEqual(['"url"'])
  })
})
