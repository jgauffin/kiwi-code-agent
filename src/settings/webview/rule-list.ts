import { RuleListChangedEvent } from './events'
import { button, el, textInput } from './fields'

/**
 * A list of strings edited one per row. A row is added empty and becomes a
 * value once it has text; removing a row or leaving one reports the list.
 */
export class RuleList extends HTMLElement {
  private placeholder = ''
  private disabled = false

  update(values: string[], options: { placeholder?: string; disabled?: boolean } = {}): void {
    this.placeholder = options.placeholder ?? ''
    this.disabled = options.disabled === true
    this.replaceChildren()
    for (const value of values) this.append(this.row(value))
    const add = button('Add', () => {
      const row = this.row('')
      add.before(row)
      row.querySelector('input')?.focus()
    })
    add.className = 'add'
    add.disabled = this.disabled
    this.append(add)
  }

  values(): string[] {
    return [...this.querySelectorAll('input')].map((input) => input.value.trim()).filter((value) => value !== '')
  }

  private row(value: string): HTMLElement {
    const row = el('div', 'row')
    const input = textInput('rule', value, { placeholder: this.placeholder, disabled: this.disabled })
    input.addEventListener('change', () => this.report())
    const remove = button('×', () => {
      row.remove()
      this.report()
    })
    remove.className = 'remove'
    remove.title = 'Remove'
    remove.disabled = this.disabled
    row.append(input, remove)
    return row
  }

  private report(): void {
    this.dispatchEvent(new RuleListChangedEvent(this.values()))
  }
}

customElements.define('rule-list', RuleList)
