// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { LinkedFilesRow } = await import('../src/chat/webview/linked-files-row')
const { LinkOpenFileRequestedEvent } = await import('../src/chat/webview/events')

function row(): InstanceType<typeof LinkedFilesRow> {
  const node = new LinkedFilesRow()
  document.body.appendChild(node)
  return node
}

describe('LinkedFilesRow', () => {
  it('the_button_asks_which_file_is_open_rather_than_guessing_one', () => {
    const node = row()
    let asked = 0
    node.addEventListener(LinkOpenFileRequestedEvent.type, () => asked++)
    node.querySelector<HTMLButtonElement>('button.link-file')!.click()
    expect(asked).toBe(1)
    // Nothing is linked until the host answers with a path.
    expect(node.paths).toEqual([])
    expect(node.querySelectorAll('.file').length).toBe(0)
  })

  it('a_linked_file_is_shown_by_its_file_name_with_the_whole_path_to_hand', () => {
    const node = row()
    node.link('src/chat/webview/style.css')
    const chip = node.querySelector('.file')!
    expect(chip.textContent!.replace(/\s+/g, ' ').trim()).toBe('style.css ✕')
    expect(chip.getAttribute('title')).toBe('src/chat/webview/style.css')
  })

  it('the_same_file_linked_twice_stays_one_link', () => {
    const node = row()
    node.link('src/chat/protocol.ts')
    node.link('src/chat/protocol.ts')
    expect(node.paths).toEqual(['src/chat/protocol.ts'])
    expect(node.querySelectorAll('.file').length).toBe(1)
  })

  it('the_x_unlinks_only_the_file_it_sits_on', () => {
    const node = row()
    node.link('a/one.ts')
    node.link('b/two.ts')
    node.querySelectorAll<HTMLButtonElement>('.file .unlink')[0]!.click()
    expect(node.paths).toEqual(['b/two.ts'])
    expect([...node.querySelectorAll('.file')].map((c) => c.getAttribute('title'))).toEqual(['b/two.ts'])
  })
})
