// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

// Test files share a worker, so the module registry is cleared first: what
// loads here is this file's own, bound to its stub and its document.
vi.resetModules()

const { ChatComposer } = await import('../src/chat/webview/chat-composer')
const { NewSessionView } = await import('../src/chat/webview/new-session-view')
// The composer reaches its linked-files row only through the DOM, so the element has to be defined here too.
await import('../src/chat/webview/linked-files-row')
const { AttachedImagesRow } =await import('../src/chat/webview/attached-images-row')
const { PromptSubmittedEvent, NewSessionRequestedEvent } = await import('../src/chat/webview/events')
const { imageOnlyLabel } = await import('../src/chat/image-note')

const png = (name = 'shot.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
const PNG_BASE64 = 'AQID'

function composer(): InstanceType<typeof ChatComposer> {
  const node = new ChatComposer()
  document.body.appendChild(node)
  return node
}

function transferEvent(type: 'paste' | 'drop', target: Element, files: File[], text = ''): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const transfer = { files, items: [], getData: (kind: string) => (kind === 'text/plain' ? text : '') }
  Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: transfer })
  target.dispatchEvent(event)
  return event
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const row = (node: HTMLElement) => node.querySelector('attached-images-row') as InstanceType<typeof AttachedImagesRow>
// Reading a file is asynchronous and slower under a loaded suite, so wait for the images rather than a fixed delay.
const imagesArrive = (node: HTMLElement, count: number) => vi.waitFor(() => expect(row(node).images.length).toBe(count))
const submit = (node: HTMLElement) => node.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))

describe('pasting an image into the composer', () => {
  it('pasting_an_image_with_no_text_attaches_it_and_inserts_nothing_into_the_prompt', async () => {
    const node = composer()
    const event = transferEvent('paste', node.querySelector('textarea')!, [png()])
    await imagesArrive(node, 1)
    expect(event.defaultPrevented).toBe(true)
    expect(row(node).images).toEqual([{ mediaType: 'image/png', data: PNG_BASE64 }])
    expect(node.querySelector('textarea')!.value).toBe('')
    node.remove()
  })

  it('a_clipboard_of_text_only_pastes_as_text_and_attaches_nothing', async () => {
    const node = composer()
    const event = transferEvent('paste', node.querySelector('textarea')!, [], 'just words')
    await settle()
    expect(event.defaultPrevented).toBe(false)
    expect(row(node).images).toEqual([])
    node.remove()
  })

  it('a_clipboard_of_an_image_and_text_pastes_the_text_and_attaches_no_image', async () => {
    const node = composer()
    const event = transferEvent('paste', node.querySelector('textarea')!, [png()], 'a1\tb1')
    await settle()
    expect(event.defaultPrevented).toBe(false)
    expect(row(node).images).toEqual([])
    node.remove()
  })

  it('a_clipboard_of_several_images_attaches_each', async () => {
    const node = composer()
    transferEvent('paste', node.querySelector('textarea')!, [png('a.png'), png('b.png')])
    await imagesArrive(node, 2)
    node.remove()
  })

  it('dropping_an_image_file_attaches_it_like_a_pasted_one', async () => {
    const node = composer()
    const event = transferEvent('drop', node.querySelector('textarea')!, [png()])
    await imagesArrive(node, 1)
    expect(event.defaultPrevented).toBe(true)
    expect(row(node).images).toEqual([{ mediaType: 'image/png', data: PNG_BASE64 }])
    node.remove()
  })

  it('dropping_a_file_that_is_not_an_image_attaches_nothing', async () => {
    const node = composer()
    const event = transferEvent('drop', node.querySelector('textarea')!, [new File(['x'], 'notes.txt', { type: 'text/plain' })])
    await settle()
    expect(event.defaultPrevented).toBe(false)
    expect(row(node).images).toEqual([])
    node.remove()
  })
})

describe('the composer holding images', () => {
  it('each_attached_image_shows_as_a_thumbnail_and_the_x_removes_only_that_one', async () => {
    const node = composer()
    transferEvent('paste', node.querySelector('textarea')!, [png('a.png'), png('b.png')])
    await imagesArrive(node, 2)
    expect(node.querySelectorAll('attached-images-row img').length).toBe(2)
    node.querySelectorAll<HTMLButtonElement>('attached-images-row .remove-image')[0]!.click()
    expect(node.querySelectorAll('attached-images-row img').length).toBe(1)
    expect(row(node).images.length).toBe(1)
    node.remove()
  })

  it('a_prompt_of_images_alone_is_sent_and_the_composer_holds_no_images_afterwards', async () => {
    const node = composer()
    const sent: { text: string; images: number }[] = []
    node.addEventListener(PromptSubmittedEvent.type, (e) => sent.push({ text: e.text, images: e.images.length }))
    transferEvent('paste', node.querySelector('textarea')!, [png()])
    await imagesArrive(node, 1)

    submit(node)
    expect(sent).toEqual([{ text: '', images: 1 }])
    expect(row(node).images).toEqual([])
    expect(node.querySelectorAll('attached-images-row img').length).toBe(0)

    node.querySelector('textarea')!.value = 'next'
    submit(node)
    expect(sent[1]).toEqual({ text: 'next', images: 0 })
    node.remove()
  })

  it('a_prompt_with_neither_words_nor_images_is_not_sent', () => {
    const node = composer()
    let sent = 0
    node.addEventListener(PromptSubmittedEvent.type, () => sent++)
    submit(node)
    expect(sent).toBe(0)
    node.remove()
  })
})

describe('an image-only prompt in the session list', () => {
  it('is_shown_by_how_many_images_it_carried', () => {
    expect(imageOnlyLabel('', 1)).toBe('1 image')
    expect(imageOnlyLabel('  ', 3)).toBe('3 images')
    expect(imageOnlyLabel('look at this', 2)).toBeUndefined()
    expect(imageOnlyLabel('', 0)).toBeUndefined()
  })
})

describe('the new-session screen accepting images', () => {
  it('the_first_prompt_card_takes_a_pasted_image_and_starts_the_chat_with_it', async () => {
    const node = new NewSessionView()
    document.body.appendChild(node)
    node.update({ names: ['Claude'], active: 'Claude' }, { plans: [], chats: [], unfiled: 0 })
    const requests: { images: number }[] = []
    node.addEventListener(NewSessionRequestedEvent.type, (e) => requests.push({ images: e.images.length }))

    transferEvent('paste', node.querySelector('textarea[name=prompt]')!, [png()])
    await imagesArrive(node, 1)
    expect(node.querySelectorAll('attached-images-row img').length).toBe(1)

    node.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(requests).toEqual([{ images: 1 }])
    expect(node.querySelectorAll('attached-images-row img').length).toBe(0)
    node.remove()
  })
})
