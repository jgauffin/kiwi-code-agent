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
  connectedCallback(): void {
    if (this.childElementCount > 0) return
    const area = document.createElement('textarea')
    area.value = this.getAttribute('text') ?? ''
    area.rows = 3
    area.placeholder = this.getAttribute('placeholder') ?? ''
    const save = button(this.getAttribute('label') ?? 'Save', () => {
      const text = area.value.trim()
      if (text) this.dispatchEvent(new EditorClosedEvent(text))
    })
    this.append(area, save, button('Cancel', () => this.dispatchEvent(new EditorClosedEvent())))
    queueMicrotask(() => area.focus())
  }
}

customElements.define('plan-editor', PlanEditor)
