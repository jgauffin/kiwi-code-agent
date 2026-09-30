import { compileTemplate } from '@relax.js/core/html'
import type { McpServerState } from '../../agent/session/code-session'
import { LinkedFilesRow } from './linked-files-row'
import './context-meter'
import type { ContextMeter, ContextUsage } from './context-meter'
import {
  AllowWritesToggledEvent,
  ContinueInChatRequestedEvent,
  InterruptRequestedEvent,
  McpReconnectRequestedEvent,
  PromptSubmittedEvent,
  SessionModelChangedEvent,
} from './events'

/**
 * The profile a session's next turn runs on. A chat session offers every
 * model on offer to switch to (B9); a plan session's phase names its profile
 * with no way to change it here — its model is chosen per phase, from the
 * plan bar (E2), so `options` is left out.
 */
type ModelSwitch = { current: string; options?: string[] }

/**
 * The composer's per-session switches; `undefined` hides a switch the session has no use for.
 * `continueInChat` offers to carry a restricted session's conversation into a chat.
 */
type Switches = {
  allowWrites: boolean | undefined
  mcp: McpServerState[] | undefined
  model: ModelSwitch | undefined
  continueInChat?: boolean
  /** An engine holds the conversation, so it can be compacted. */
  compactable?: boolean
}

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
      <div class="actions">
        <span class="switches">
          <label class="allow-writes" if="allowWritesAvailable" title="Let this session write files without asking. Bash and other tools still ask; deny rules still block.">
            <input type="checkbox" name="allowWrites" checked="{{allowWrites}}" r-change="toggleAllowWrites(event)"> Allow writes
          </label>
          <label class="model" if="modelSwitchable" title="Runs this session's next turn on the model chosen; the conversation carries over only within the same engine.">
            <select name="model" r-change="changeModel(event)">
              <option loop="m in models" value="{{m.name}}" selected="{{m.selected}}">{{m.name}}</option>
            </select>
          </label>
          <span class="model-current" if="modelReadOnly" title="This session's phase runs on the profile chosen for it, from the plan bar.">{{modelCurrent}}</span>
          <button type="button" class="continue-in-chat" if="continueInChat" title="Carry this conversation into a chat with the full tool set." r-click="continueInChat()">Continue in chat</button>
          <linked-files-row class="linked-files"></linked-files-row>
        </span>
        <context-meter class="context"></context-meter>
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
  private switches: Switches = { allowWrites: undefined, mcp: undefined, model: undefined }
  private context: ContextUsage | undefined
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

  /** How full the window of the conversation this composer reaches is; undefined until its engine has said. */
  setContext(usage: ContextUsage | undefined): void {
    this.context = usage
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
    const { allowWrites, mcp, model, continueInChat } = this.switches
    this.template.render(
      {
        held: this.held,
        placeholder: this.held ? 'Answer or skip the question above first.' : 'Ask for a change...',
        allowWritesAvailable: allowWrites !== undefined,
        allowWrites: allowWrites ?? false,
        mcpAvailable: mcp !== undefined && mcp.length > 0,
        servers: (mcp ?? []).map((s) => ({ ...s, title: s.error ?? s.status })),
        modelSwitchable: model !== undefined && model.options !== undefined,
        modelReadOnly: model !== undefined && model.options === undefined,
        modelCurrent: model?.current ?? '',
        models: (model?.options ?? []).map((name) => ({ name, selected: name === model?.current })),
        continueInChat: continueInChat ?? false,
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
        changeModel: (event: Event) => this.dispatchEvent(new SessionModelChangedEvent((event.target as HTMLSelectElement).value)),
        continueInChat: () => this.dispatchEvent(new ContinueInChatRequestedEvent()),
        stop: () => this.dispatchEvent(new InterruptRequestedEvent()),
        toggleAllowWrites: (event: Event) => {
          this.dispatchEvent(new AllowWritesToggledEvent((event.target as HTMLInputElement).checked))
        },
      },
    )
    ;(this.querySelector('context-meter') as ContextMeter).update(this.context, this.switches.compactable ?? false)
  }

  private get textarea(): HTMLTextAreaElement {
    return this.querySelector('textarea')!
  }

  private get linkedFiles(): LinkedFilesRow {
    return this.querySelector('linked-files-row') as LinkedFilesRow
  }

  private send(): void {
    const text = this.textarea.value.trim()
    if (text === '' || this.held) return
    const files = this.linkedFiles.paths
    this.textarea.value = ''
    this.linkedFiles.clear()
    this.dispatchEvent(new PromptSubmittedEvent(text, files))
  }
}

customElements.define('chat-composer', ChatComposer)
