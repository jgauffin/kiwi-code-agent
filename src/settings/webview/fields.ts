import type { SettingsTarget } from '../protocol'
import { SettingsFileRequestedEvent } from './events'

export function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = className
  node.textContent = label
  node.addEventListener('click', onClick)
  return node
}

type FieldOptions = { hint?: string; placeholder?: string; disabled?: boolean }

/** A labelled control: the label above, the hint under. */
export function field(label: string, control: HTMLElement, options: FieldOptions = {}): HTMLLabelElement {
  const node = document.createElement('label')
  node.className = 'field'
  node.append(el('span', 'label', label), control)
  if (options.hint) node.append(el('span', 'hint', options.hint))
  return node
}

export function textInput(name: string, value: string, options: FieldOptions = {}): HTMLInputElement {
  const input = document.createElement('input')
  input.name = name
  input.value = value
  if (options.placeholder) input.placeholder = options.placeholder
  input.disabled = options.disabled === true
  return input
}

export function numberInput(name: string, value: number, options: FieldOptions = {}): HTMLInputElement {
  const input = textInput(name, String(value), options)
  input.type = 'number'
  input.min = '0'
  return input
}

export function checkbox(name: string, checked: boolean, options: FieldOptions = {}): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.name = name
  input.checked = checked
  input.disabled = options.disabled === true
  return input
}

export function select(name: string, options: { value: string; label: string }[], selected: string, disabled = false): HTMLSelectElement {
  const node = document.createElement('select')
  node.name = name
  for (const option of options) {
    const item = document.createElement('option')
    item.value = option.value
    item.textContent = option.label
    item.selected = option.value === selected
    node.append(item)
  }
  node.disabled = disabled
  return node
}

/** A labelled checkbox reads as one line: the box first, the words after. */
export function checkField(label: string, control: HTMLInputElement, hint?: string): HTMLLabelElement {
  const node = document.createElement('label')
  node.className = 'field check'
  node.append(control, el('span', 'label', label))
  if (hint) node.append(el('span', 'hint', hint))
  return node
}

/** Saves on `change`, so a value is written when the field is left, not on every keystroke. */
export function onChange(control: HTMLElement, save: () => void): void {
  control.addEventListener('change', save)
}

export function heading(title: string, scope: string): HTMLElement {
  const node = el('header', 'heading')
  node.append(el('h2', '', title), el('span', 'scope', scope))
  return node
}

/** The tail of every tab: the file behind it, for what the page does not edit. */
export function settingsFileLink(target: SettingsTarget): HTMLElement {
  const footer = el('footer', 'footer')
  const link = button(target === 'user' ? 'Open user settings.json' : 'Open workspace settings.json', () =>
    footer.dispatchEvent(new SettingsFileRequestedEvent(target)),
  )
  link.className = 'link'
  footer.append(link)
  return footer
}

export function note(text: string): HTMLElement {
  return el('p', 'note', text)
}
