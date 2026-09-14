import { compileTemplate } from '@relax.js/core/html'
import { InterruptRequestedEvent, PromptSubmittedEvent, VerifyToggledEvent } from './events'

/** Prompt input. Enter sends, Shift+Enter breaks the line. */
export class ChatComposer extends HTMLElement {
  private readonly template = compileTemplate(`
    <form r-submit="submit(event)">
      <textarea name="prompt" rows="3" placeholder="Ask for a change..." r-keydown="keydown(event)"></textarea>
      <div class="actions">
        <label class="verify" if="verifyAvailable" title="Run the configured build/test commands when the model stops after editing. Leave off while still discussing the plan.">
          <input type="checkbox" name="verify" checked="{{verify}}" r-change="toggleVerify(event)"> Verify on stop
        </label>
        <button type="button" class="stop" r-click="stop()">Stop</button>
        <button type="submit" class="send">Send</button>
      </div>
    </form>
  `)
  private verifyState: { verifyAvailable: boolean; verify: boolean } = { verifyAvailable: false, verify: false }

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.render()
  }

  /** `undefined` hides the toggle (no verification rules configured). */
  setVerify(enabled: boolean | undefined): void {
    this.verifyState = { verifyAvailable: enabled !== undefined, verify: enabled ?? false }
    this.render()
  }

  focusInput(): void {
    this.textarea.focus()
  }

  private render(): void {
    this.template.render(
      { ...this.verifyState },
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
        toggleVerify: (event: Event) => {
          this.dispatchEvent(new VerifyToggledEvent((event.target as HTMLInputElement).checked))
        },
      },
    )
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
