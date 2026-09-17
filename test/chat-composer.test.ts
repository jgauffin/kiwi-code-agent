// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { ChatComposer } = await import('../src/chat/webview/chat-composer')
const { McpReconnectRequestedEvent, PromptSubmittedEvent } = await import('../src/chat/webview/events')

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
