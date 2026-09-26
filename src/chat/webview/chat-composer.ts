import { compileTemplate } from '@relax.js/core/html'
import type { McpServerState } from '../../agent/session/code-session'
import {
  AllowWritesToggledEvent,
  InterruptRequestedEvent,
  LinkOpenFileRequestedEvent,
  McpReconnectRequestedEvent,
  PromptSubmittedEvent,
} from './events'

/** The composer's per-session switches; `undefined` hides a switch the session has no use for. */
type Switches = { allowWrites: boolean | undefined; mcp: McpServerState[] | undefined }

/**
 * Prompt input. Enter sends, Shift+Enter breaks the line. Held while the
 * session waits on a question card: a prompt sent then would queue behind
 * the unanswered question and look like a hang. Stop stays available.
 *
 * Files linked from the editor ride along with the next prompt and are let go
 * once it is sent: they point at what that request is about, not at the session.
 */
export class ChatComposer extends HTMLElement {
  private readonly template = compileTemplate(`
    <form r-submit="submit(event)">
      <textarea name="prompt" rows="3" placeholder="{{placeholder}}" disabled="{{held}}" r-keydown="keydown(event)"></textarea>
      <div class="linked-files" if="anyLinked">
        <span loop="f in linked" class="file" title="{{f.path}}">
          {{f.name}}
          <button type="button" class="unlink" title="Unlink {{f.path}}" r-click="unlink(f)">✕</button>
        </span>
      </div>
      <div class="actions">
        <span class="switches">
          <label class="allow-writes" if="allowWritesAvailable" title="Let this session write files without asking. Bash and other tools still ask; deny rules still block.">
            <input type="checkbox" name="allowWrites" checked="{{allowWrites}}" r-change="toggleAllowWrites(event)"> Allow writes
          </label>
          <button type="button" class="link-file" title="Link the file open in the editor; the next prompt asks the agent to read it." r-click="linkOpenFile()">Link open file</button>
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
  /** Paths as the prompt will name them, in the order they were linked. */
  private linked: string[] = []

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

  /** Links a file the host resolved; the same file twice stays one chip. */
  linkFile(path: string): void {
    if (this.linked.includes(path)) return
    this.linked = [...this.linked, path]
    this.render()
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
        anyLinked: this.linked.length > 0,
        linked: this.linked.map((path) => ({ path, name: path.split('/').pop() ?? path })),
      },
      {
        reconnect: (s: McpServerState) => this.dispatchEvent(new McpReconnectRequestedEvent(s.name)),
        linkOpenFile: () => this.dispatchEvent(new LinkOpenFileRequestedEvent()),
        unlink: (file: { path: string }) => {
          this.linked = this.linked.filter((path) => path !== file.path)
          this.render()
        },
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
    const files = this.linked
    this.textarea.value = ''
    this.linked = []
    this.render()
    this.dispatchEvent(new PromptSubmittedEvent(text, files))
  }
}

customElements.define('chat-composer', ChatComposer)
