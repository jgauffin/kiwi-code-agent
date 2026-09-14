import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import mermaid from 'mermaid'

/**
 * Markdown for assistant text. Mermaid fences become diagrams once the
 * message is final; while streaming they stay as code so a half-written
 * diagram does not flash errors on every delta.
 */
const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      if (lang === 'mermaid') return `<pre class="mermaid">${escapeHtml(text)}</pre>`
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      return `<pre><code${cls}>${escapeHtml(text)}</code></pre>`
    },
  },
})

let mermaidReady = false

function ensureMermaid(): void {
  if (mermaidReady) return
  mermaidReady = true
  const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast')
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' })
}

export function renderMarkdown(text: string, target: HTMLElement, final: boolean): void {
  const html = marked.parse(text, { async: false })
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, ADD_ATTR: ['class'] })
  target.replaceChildren(fragment)
  if (!final) return
  const diagrams = target.querySelectorAll<HTMLElement>('pre.mermaid')
  if (diagrams.length === 0) return
  ensureMermaid()
  for (const node of diagrams) node.dataset['source'] = node.textContent ?? ''
  mermaid.run({ nodes: diagrams, suppressErrors: true }).catch((error: unknown) => {
    for (const node of diagrams) {
      if (node.querySelector('svg')) continue
      node.classList.add('failed')
      node.title = error instanceof Error ? error.message : String(error)
    }
  })
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
