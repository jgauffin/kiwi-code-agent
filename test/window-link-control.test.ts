// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { LinkAct, WindowLinkState } from '../src/cross-window/cross-window'

// Test files share a worker, so the module registry is cleared first: what loads here is this file's own, bound to its document.
vi.resetModules()

const { WindowLinkControl } = await import('../src/chat/webview/window-link-control')
const { WindowLinkRequestedEvent } = await import('../src/chat/webview/events')

function control(link: WindowLinkState) {
  const node = new WindowLinkControl()
  document.body.appendChild(node)
  node.setLink(link)
  const requested: LinkAct[] = []
  node.addEventListener(WindowLinkRequestedEvent.type, (e) => requested.push(e.act))
  return { node, requested }
}

const buttons = (node: HTMLElement) => [...node.querySelectorAll('button')].map((b) => b.textContent)

describe('window link control', () => {
  it('an_unlinked_chat_offers_only_to_link_and_asks_for_it_when_clicked', () => {
    const { node, requested } = control({ state: 'none' })
    expect(buttons(node)).toEqual(['Link window'])
    node.querySelector<HTMLButtonElement>('.link')!.click()
    expect(requested).toEqual(['link'])
  })

  it('a_linked_chat_names_the_other_workspace_and_offers_pause_and_unlink', () => {
    const { node } = control({ state: 'linked', workspace: 'backend', paused: false })
    expect(node.querySelector('.with')!.textContent).toBe('Linked to backend')
    expect(buttons(node)).toEqual(['Pause', 'Unlink'])
  })

  it('a_paused_link_says_so_and_offers_resume_instead_of_pause', () => {
    const { node, requested } = control({ state: 'linked', workspace: 'backend', paused: true })
    expect(node.querySelector('.with')!.textContent).toBe('Linked to backend, paused')
    expect(buttons(node)).toEqual(['Resume', 'Unlink'])
    node.querySelector<HTMLButtonElement>('.resume')!.click()
    expect(requested).toEqual(['resume'])
  })

  it('a_closed_other_window_shows_as_disconnected_and_the_link_can_still_be_ended', () => {
    const { node } = control({ state: 'disconnected', workspace: 'backend', paused: false })
    expect(node.querySelector('.with')!.textContent).toBe('backend window closed')
    expect(buttons(node)).toEqual(['Pause', 'Unlink'])
  })

  it('an_ended_link_says_so_and_offers_to_link_again', () => {
    const { node } = control({ state: 'ended', workspace: 'backend', paused: false })
    expect(node.querySelector('.with')!.textContent).toBe('Link to backend ended')
    expect(buttons(node)).toEqual(['Link window'])
  })
})
