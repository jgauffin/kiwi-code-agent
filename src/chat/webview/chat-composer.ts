import { compileTemplate } from '@relax.js/core/html'
import { AllowWritesToggledEvent, InterruptRequestedEvent, PromptSubmittedEvent } from './events'

/** The composer's per-session switches; `undefined` hides a switch the session has no use for. */
type Switches = { allowWrites: boolean | undefined }

/** Prompt input. Enter sends, Shift+Enter breaks the line. */
export class ChatComposer extends HTMLElement {
  private readonly template = compileTemplate(`
    <form r-submit="submit(event)">
      <textarea name="prompt" rows="3" placeholder="Ask for a change..." r-keydown="keydown(event)"></textarea>
      <div class="actions">
        <span class="switches">
          <label class="allow-writes" if="allowWritesAvailable" title="Let this session write files without asking. Bash and other tools still ask; deny rules still block.">
            <input type="checkbox" name="allowWrites" checked="{{allowWrites}}" r-change="toggleAllowWrites(event)"> Allow writes
          </label>
        </span>
        <button type="button" class="stop" r-click="stop()">Stop</button>
        <button type="submit" class="send">Send</button>
      </div>
    </form>
  `)
  private switches: Switches = { allowWrites: undefined }

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.render()
  }

  setSwitches(switches: Switches): void {
    this.switches = switches
    this.render()
  }

  focusInput(): void {
    this.textarea.focus()
  }

  private render(): void {
    const { allowWrites } = this.switches
    this.template.render(
      {
        allowWritesAvailable: allowWrites !== undefined,
        allowWrites: allowWrites ?? false,
      },
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
        toggleAllowWrites: (event: Event) => {
          this.dispatchEvent(new AllowWritesToggledEvent((event.target as HTMLInputElement).checked))
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
