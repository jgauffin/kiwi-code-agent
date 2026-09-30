import { EditorClosedEvent } from './events'
import { button } from './plan-parts'

/**
 * The box for writing a comment or a ruling. Built in code rather than from a
 * template: a template writes the value property back on every render, which
 * would replace the text under the user and move the caret. A tab places this
 * with a conditional instead, so it is built when the editor opens and dropped
 * when it closes, and nothing touches it in between.
 */
export class PlanEditor extends HTMLElement {
  /** Built for the box now open; a reconnect while open keeps what is typed. */
  private open = false

  connectedCallback(): void {
    if (this.open) return
    this.open = true
    const area = document.createElement('textarea')
    area.value = this.getAttribute('text') ?? ''
    area.rows = 3
    area.placeholder = this.getAttribute('placeholder') ?? ''
    const save = button(this.getAttribute('label') ?? 'Save', () => {
      const text = area.value.trim()
      if (text) this.close(text)
    })
    this.replaceChildren(area, save, button('Cancel', () => this.close()))
    queueMicrotask(() => area.focus())
  }

  // The conditional re-inserts this same element when a box opens again, so a closed one must start over from its text attribute.
  private close(text?: string): void {
    this.open = false
    this.dispatchEvent(new EditorClosedEvent(text))
  }
}

customElements.define('plan-editor', PlanEditor)
