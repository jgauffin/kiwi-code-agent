// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown, renderMarkdownInline } from '../src/chat/webview/markdown'

function render(text: string, final = true): HTMLElement {
  const target = document.createElement('div')
  renderMarkdown(text, target, final)
  return target
}

describe('code block syntax coloring', () => {
  it('a fenced block with a known language gets token spans', () => {
    const target = render('```ts\nconst x = "hi"\n```')
    const code = target.querySelector('pre > code')!
    expect(code.classList.contains('hljs')).toBe(true)
    expect(code.querySelector('.hljs-keyword')?.textContent).toBe('const')
    expect(code.querySelector('.hljs-string')?.textContent).toBe('"hi"')
  })

  it('an unknown language stays plain text', () => {
    const target = render('```nosuchlang\nconst x = 1\n```')
    const code = target.querySelector('pre > code')!
    expect(code.querySelector('span')).toBeNull()
    expect(code.textContent).toBe('const x = 1')
  })

  it('a block without a language stays plain text', () => {
    const target = render('```\n<b>not html</b>\n```')
    const code = target.querySelector('pre > code')!
    expect(code.querySelector('span')).toBeNull()
    expect(code.querySelector('b')).toBeNull()
    expect(code.textContent).toBe('<b>not html</b>')
  })

  it('markup inside a highlighted block is escaped, not rendered', () => {
    const target = render('```html\n<script>alert(1)</script>\n```')
    expect(target.querySelector('script')).toBeNull()
    expect(target.querySelector('pre > code')!.textContent).toContain('<script>')
  })

  it('a streamed block is colored too', () => {
    const target = render('```js\nreturn 1', false)
    expect(target.querySelector('pre > code .hljs-keyword')?.textContent).toBe('return')
  })

  it('mermaid fences are left for the diagram renderer', () => {
    const target = render('```mermaid\ngraph TD; A-->B\n```')
    expect(target.querySelector('pre.mermaid')).not.toBeNull()
    expect(target.querySelector('.hljs')).toBeNull()
  })
})

describe('one line of markdown', () => {
  const inline = (text: string): HTMLElement => {
    const target = document.createElement('div')
    renderMarkdownInline(text, target)
    return target
  }

  it('renders_as_phrasing_content_so_it_can_sit_inside_a_button', () => {
    const target = inline('`Order.cancel` **refuses** a shipped order')
    expect(target.querySelector('p')).toBeNull()
    expect(target.querySelector('code')!.textContent).toBe('Order.cancel')
    expect(target.querySelector('strong')!.textContent).toBe('refuses')
  })

  it('keeps_plain_markup_and_strips_what_could_run', () => {
    const target = inline('<b>bold</b> <img src=x onerror=alert(1)> <script>alert(1)</script>')
    expect(target.querySelector('b')!.textContent).toBe('bold')
    expect(target.querySelector('img')!.hasAttribute('onerror')).toBe(false)
    expect(target.querySelector('script')).toBeNull()
  })
})
