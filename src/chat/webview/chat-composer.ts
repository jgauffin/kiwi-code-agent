import { compileTemplate } from '@relax.js/core/html'
import { InterruptRequestedEvent, PromptSubmittedEvent } from './events'

/** Prompt input. Enter sends, Shift+Enter breaks the line. */
export class ChatComposer extends HTMLElement {
  private readonly template = compileTemplate(`
    <form r-submit="submit(event)">
      <textarea name="prompt" rows="3" placeholder="Ask for a change..." r-keydown="keydown(event)"></textarea>
      <div class="actions">
        <button type="button" class="stop" r-click="stop()">Stop</button>
        <button type="submit" class="send">Send</button>
      </div>
    </form>
  `)

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.template.render(
      {},
      {
        submit: (event: SubmitEvent) => {
          event.preventDefault()
          this.send()
        },
        keydown: (event: KeyboardEvent) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            this.send()
          }
        },
        stop: () => this.dispatchEvent(new InterruptRequestedEvent()),
      },
    )
  }

  focusInput(): void {
    this.textarea.focus()
  }

  private get textarea(): HTMLTextAreaElement {
    return this.querySelector('textarea')!
  }

  private send(): void {
    const text = this.textarea.value.trim()
    if (text === '') return
    this.textarea.value = ''
    this.dispatchEvent(new PromptSubmittedEvent(text))
  }
}

customElements.define('chat-composer', ChatComposer)
