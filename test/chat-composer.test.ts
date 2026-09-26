// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { ChatComposer } = await import('../src/chat/webview/chat-composer')
const { LinkOpenFileRequestedEvent, McpReconnectRequestedEvent, PromptSubmittedEvent } = await import('../src/chat/webview/events')

function composer(): InstanceType<typeof ChatComposer> {
  const node = new ChatComposer()
  document.body.appendChild(node)
  return node
}

describe('ChatComposer while a question waits', () => {
  it('a_prompt_is_held_back_while_a_question_card_waits_and_goes_out_once_it_is_resolved', () => {
    const node = composer()
    const sent: string[] = []
    node.addEventListener(PromptSubmittedEvent.type, (e) => sent.push(e.text))
    const textarea = node.querySelector('textarea')!
    const send = node.querySelector<HTMLButtonElement>('button.send')!

    node.setHeldByQuestion(true)
    expect(textarea.disabled).toBe(true)
    expect(send.disabled).toBe(true)
    expect(textarea.placeholder).toBe('Answer or skip the question above first.')
    textarea.value = 'do it anyway'
    node.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(sent).toEqual([])
    // Stop is the way out that needs no answer, so it stays live.
    expect(node.querySelector<HTMLButtonElement>('button.stop')!.disabled).toBe(false)

    node.setHeldByQuestion(false)
    expect(textarea.disabled).toBe(false)
    node.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(sent).toEqual(['do it anyway'])
  })
})

describe('ChatComposer linked files', () => {
  function submit(node: InstanceType<typeof ChatComposer>, text: string): void {
    node.querySelector('textarea')!.value = text
    node.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  }

  it('the_button_asks_the_host_which_file_is_open_rather_than_guessing', () => {
    const node = composer()
    let asked = 0
    node.addEventListener(LinkOpenFileRequestedEvent.type, () => asked++)
    node.querySelector<HTMLButtonElement>('button.link-file')!.click()
    expect(asked).toBe(1)
    // Nothing is linked until the host answers with a path.
    expect(node.querySelector('.linked-files')).toBeNull()
  })

  it('every_linked_file_rides_along_with_the_next_prompt_and_is_named_by_its_file_name', () => {
    const node = composer()
    const sent: string[][] = []
    node.addEventListener(PromptSubmittedEvent.type, (e) => sent.push(e.files))
    node.linkFile('src/chat/protocol.ts')
    node.linkFile('src/chat/webview/style.css')

    const chips = [...node.querySelectorAll('.linked-files .file')]
    expect(chips.map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['protocol.ts ✕', 'style.css ✕'])
    expect(chips[0]!.getAttribute('title')).toBe('src/chat/protocol.ts')

    submit(node, 'rename it')
    expect(sent).toEqual([['src/chat/protocol.ts', 'src/chat/webview/style.css']])
  })

  it('the_same_file_linked_twice_stays_one_link', () => {
    const node = composer()
    node.linkFile('src/chat/protocol.ts')
    node.linkFile('src/chat/protocol.ts')
    expect(node.querySelectorAll('.linked-files .file').length).toBe(1)
  })

  it('the_x_unlinks_only_the_file_it_sits_on', () => {
    const node = composer()
    const sent: string[][] = []
    node.addEventListener(PromptSubmittedEvent.type, (e) => sent.push(e.files))
    node.linkFile('a/one.ts')
    node.linkFile('b/two.ts')
    node.querySelectorAll<HTMLButtonElement>('.linked-files .file .unlink')[0]!.click()

    expect([...node.querySelectorAll('.linked-files .file')].map((c) => c.getAttribute('title'))).toEqual(['b/two.ts'])
    submit(node, 'go')
    expect(sent).toEqual([['b/two.ts']])
  })

  it('links_are_let_go_once_the_prompt_they_were_meant_for_is_sent', () => {
    const node = composer()
    const sent: string[][] = []
    node.addEventListener(PromptSubmittedEvent.type, (e) => sent.push(e.files))
    node.linkFile('a/one.ts')
    submit(node, 'first')
    expect(node.querySelector('.linked-files')).toBeNull()

    submit(node, 'second')
    expect(sent).toEqual([['a/one.ts'], []])
  })
})

describe('ChatComposer MCP line', () => {
  it('each_server_is_shown_with_its_status_and_a_failed_one_carries_its_error', () => {
    const node = composer()
    node.setSwitches({
      allowWrites: undefined,
      mcp: [
        { name: 'docs', status: 'connected' },
        { name: 'github', status: 'failed', error: 'ECONNREFUSED' },
      ],
    })
    const servers = [...node.querySelectorAll('.mcp-servers .server')]
    expect(servers.map((s) => s.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['docs connected ↻', 'github failed ↻'])
    expect(servers[1]!.classList.contains('failed')).toBe(true)
    expect(servers[1]!.getAttribute('title')).toBe('ECONNREFUSED')
    expect(servers[0]!.getAttribute('title')).toBe('connected')
  })

  it('the_reconnect_button_names_its_server', () => {
    const node = composer()
    node.setSwitches({ allowWrites: undefined, mcp: [{ name: 'github', status: 'failed', error: 'down' }] })
    const seen: string[] = []
    node.addEventListener(McpReconnectRequestedEvent.type, (e) => seen.push(e.server))
    node.querySelector<HTMLButtonElement>('.mcp-servers .reconnect')!.click()
    expect(seen).toEqual(['github'])
  })

  it('no_line_is_shown_without_servers', () => {
    const node = composer()
    node.setSwitches({ allowWrites: true, mcp: undefined })
    expect(node.querySelector('.mcp-servers')).toBeNull()
    node.setSwitches({ allowWrites: true, mcp: [] })
    expect(node.querySelector('.mcp-servers')).toBeNull()
  })
})
