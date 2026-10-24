/** The transcript's own first child, naming the model the session runs on. */
export class StatusLine {
  readonly element = document.createElement('p')

  constructor() {
    this.element.className = 'status'
  }

  /** History can be replayed into the line before the transcript is on screen. */
  attachTo(parent: HTMLElement): void {
    if (!this.element.parentElement) parent.appendChild(this.element)
  }

  set(text: string): void {
    this.element.textContent = text
    this.element.hidden = text === ''
  }
}
