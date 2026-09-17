import { compileTemplate } from '@relax.js/core/html'
import type { McpServerState } from '../../agent/session/code-session'
import { AllowWritesToggledEvent, InterruptRequestedEvent, McpReconnectRequestedEvent, PromptSubmittedEvent } from './events'

/** The composer's per-session switches; `undefined` hides a switch the session has no use for. */
type Switches = { allowWrites: boolean | undefined; mcp: McpServerState[] | undefined }

/**
 * Prompt input. Enter sends, Shift+Enter breaks the line. Held while the
 * session waits on a question card: a prompt sent then would queue behind
 * the unanswered question and look like a hang. Stop stays available.
 */
export class ChatComposer extends HTMLElement {
  private readonly template = compileTemplate(`
    <form r-submit="submit(event)">
      <textarea name="prompt" rows="3" placeholder="{{placeholder}}" disabled="{{held}}" r-keydown="keydown(event)"></textarea>
      <div class="actions">
        <span class="switches">
          <label class="allow-writes" if="allowWritesAvailable" title="Let this session write files without asking. Bash and other tools still ask; deny rules still block.">
            <input type="checkbox" name="allowWrites" checked="{{allowWrites}}" r-change="toggleAllowWrites(event)"> Allow writes
          </label>
        </span>
        <button type="button" class="stop" r-click="stop()">Stop</button>
        <button type="submit" class="send" disabled="{{held}}">Send</button>
      </div>
      <div class="mcp-servers" if="mcpAvailable">
        <span loop="s in servers" class="server {{s.status}}" title="{{s.title}}">
          {{s.name}} {{s.status}}
          <button type="button" class="reconnect" title="Reconnect {{s.name}}" r-click="reconnect(s)">↻</button>
        </span>
      </div>
    </form>
  `)
  private switches: Switches = { allowWrites: undefined, mcp: undefined }
  private held = false

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.render()
  }

  setSwitches(switches: Switches): void {
    this.switches = switches
    this.render()
  }

  /** Whether a question card waits on the user; while it does, no prompt goes out. */
  setHeldByQuestion(held: boolean): void {
    if (this.held === held) return
    this.held = held
    this.render()
  }

  focusInput(): void {
    if (!this.held) this.textarea.focus()
  }

  private render(): void {
    const { allowWrites, mcp } = this.switches
    this.template.render(
      {
        held: this.held,
        placeholder: this.held ? 'Answer or skip the question above first.' : 'Ask for a change...',
        allowWritesAvailable: allowWrites !== undefined,
        allowWrites: allowWrites ?? false,
        mcpAvailable: mcp !== undefined && mcp.length > 0,
        servers: (mcp ?? []).map((s) => ({ ...s, title: s.error ?? s.status })),
      },
      {
        reconnect: (s: McpServerState) => this.dispatchEvent(new McpReconnectRequestedEvent(s.name)),
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
    if (text === '' || this.held) return
    this.textarea.value = ''
    this.dispatchEvent(new PromptSubmittedEvent(text))
  }
}

customElements.define('chat-composer', ChatComposer)
