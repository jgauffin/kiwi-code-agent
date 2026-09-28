import { renderMarkdown, renderMarkdownInline } from './markdown'

/**
 * Markdown where a template can only put text. A template writes text, never
 * markup, and everything the planner writes into a plan file is markdown, so
 * the source goes in as an attribute and the element renders itself. Add
 * `block` for prose that may hold lists and paragraphs; the default is one
 * line of phrasing content, which fits inside a span or a button.
 */
export class MarkdownText extends HTMLElement {
  static readonly observedAttributes = ['text']

  connectedCallback(): void {
    this.draw()
  }

  attributeChangedCallback(): void {
    this.draw()
  }

  private draw(): void {
    const text = this.getAttribute('text') ?? ''
    if (this.hasAttribute('block')) renderMarkdown(text, this, true)
    else renderMarkdownInline(text, this)
  }
}

customElements.define('markdown-text', MarkdownText)
