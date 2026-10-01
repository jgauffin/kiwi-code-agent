// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { ChatComposer } = await import('../src/chat/webview/chat-composer')
const { LinkedFilesRow } = await import('../src/chat/webview/linked-files-row')
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

  it('the_files_linked_under_the_prompt_go_out_with_it_and_are_let_go_once_it_is_sent', () => {
    const node = composer()
    const sent: string[][] = []
    node.addEventListener(PromptSubmittedEvent.type, (e) => sent.push(e.files))
    const row = node.querySelector('linked-files-row') as InstanceType<typeof LinkedFilesRow>
    row.link('src/chat/protocol.ts')
    row.link('src/chat/webview/style.css')

    submit(node, 'rename it')
    expect(sent).toEqual([['src/chat/protocol.ts', 'src/chat/webview/style.css']])
    expect(row.paths).toEqual([])

    submit(node, 'and again')
    expect(sent).toEqual([['src/chat/protocol.ts', 'src/chat/webview/style.css'], []])
  })

  it('the_link_button_sits_under_the_prompt_box', () => {
    const node = composer()
    let asked = 0
    node.addEventListener(LinkOpenFileRequestedEvent.type, () => asked++)
    node.querySelector<HTMLButtonElement>('button.link-file')!.click()
    expect(asked).toBe(1)
  })
})

describe('ChatComposer MCP line', () => {
  it('each_server_is_shown_with_its_status_and_a_failed_one_carries_its_error', () => {
    const node = composer()
    node.setSwitches({
      allowWrites: undefined,
      model: undefined,
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
    node.setSwitches({ allowWrites: undefined, model: undefined, mcp: [{ name: 'github', status: 'failed', error: 'down' }] })
    const seen: string[] = []
    node.addEventListener(McpReconnectRequestedEvent.type, (e) => seen.push(e.server))
    node.querySelector<HTMLButtonElement>('.mcp-servers .reconnect')!.click()
    expect(seen).toEqual(['github'])
  })

  it('no_line_is_shown_without_servers', () => {
    const node = composer()
    node.setSwitches({ allowWrites: true, model: undefined, mcp: undefined })
    expect(node.querySelector('.mcp-servers')).toBeNull()
    node.setSwitches({ allowWrites: true, model: undefined, mcp: [] })
    expect(node.querySelector('.mcp-servers')).toBeNull()
  })
})

describe('ChatComposer model switch', () => {
  it('the_switch_is_hidden_for_a_session_with_no_model_choice', () => {
    const node = composer()
    node.setSwitches({ allowWrites: undefined, mcp: undefined, model: undefined })
    expect(node.querySelector('select[name=model]')).toBeNull()
  })

  it('every_registered_model_is_offered_with_the_one_in_use_selected', () => {
    const node = composer()
    node.setSwitches({ allowWrites: undefined, mcp: undefined, model: { current: 'Kimi', options: ['Balanced', 'Kimi'] } })
    const select = node.querySelector<HTMLSelectElement>('select[name=model]')!
    expect([...select.options].map((o) => o.value)).toEqual(['Balanced', 'Kimi'])
    expect(select.value).toBe('Kimi')
  })

  it('picking_a_model_dispatches_its_name', async () => {
    const { SessionModelChangedEvent } = await import('../src/chat/webview/events')
    const node = composer()
    node.setSwitches({ allowWrites: undefined, mcp: undefined, model: { current: 'Balanced', options: ['Balanced', 'Kimi'] } })
    let seen: string | undefined
    node.addEventListener(SessionModelChangedEvent.type, (e) => (seen = e.name))
    const select = node.querySelector<HTMLSelectElement>('select[name=model]')!
    select.value = 'Kimi'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(seen).toBe('Kimi')
  })

  it('a_plan_sessions_phase_profile_is_named_with_no_switch_offered_there', () => {
    const node = composer()
    node.setSwitches({ allowWrites: undefined, mcp: undefined, model: { current: 'Careful' } })
    expect(node.querySelector('select[name=model]')).toBeNull()
    expect(node.querySelector('.model-current')?.textContent).toBe('Careful')
  })
})

describe('ChatComposer approve plan', () => {
  it('a_session_with_no_plan_to_approve_shows_no_button', () => {
    const node = composer()
    node.setSwitches({ allowWrites: undefined, mcp: undefined, model: undefined })
    expect(node.querySelector('.approve-plan')).toBeNull()
  })

  it('the_button_approves_the_plan', async () => {
    const { PlanApprovedEvent } = await import('../src/chat/webview/events')
    const node = composer()
    node.setSwitches({ allowWrites: undefined, mcp: undefined, model: undefined, approvePlan: true })
    let asked = false
    node.addEventListener(PlanApprovedEvent.type, () => (asked = true))
    const button = node.querySelector<HTMLButtonElement>('.approve-plan')!
    expect(button.textContent).toBe('Approve plan')
    button.click()
    expect(asked).toBe(true)
  })
})
