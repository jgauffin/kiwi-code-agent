import { compileTemplate } from '@relax.js/core/html'
import type { McpServerState } from '../../agent/session/code-session'
import type { Effort } from '../../agent/session/model-profile'
import { LinkedFilesRow } from './linked-files-row'
import './context-meter'
import type { ContextMeter, ContextUsage } from './context-meter'
import {
  AllowWritesToggledEvent,
  InterruptRequestedEvent,
  McpReconnectRequestedEvent,
  PlanApprovedEvent,
  PromptSubmittedEvent,
  SessionEffortChangedEvent,
  SessionModelChangedEvent,
} from './events'

/**
 * The profile a session's next turn runs on. A chat session offers every
 * model on offer to switch to (B9); a plan session's phase names its profile
 * with no way to change it here — its model is chosen per phase, from the
 * plan bar (E2), so `options` is left out.
 *
 * `efforts` are the levels the current model takes: empty where they are not
 * known, and then no effort is offered (B14). `effort` is the level picked,
 * absent while the session runs at the model's own default.
 */
type ModelSwitch = { current: string; options?: string[]; effort?: Effort; efforts?: readonly Effort[] }

/**
 * The composer's per-session switches; `undefined` hides a switch the session has no use for.
 * `approvePlan` offers to approve a code plan and build it in the same session.
 */
type Switches = {
  allowWrites: boolean | undefined
  mcp: McpServerState[] | undefined
  model: ModelSwitch | undefined
  approvePlan?: boolean
  /** An engine holds the conversation, so it can be compacted. */
  compactable?: boolean
}

/**
 * Prompt input. Enter sends, Shift+Enter breaks the line, Escape stops the
 * run as the Stop button does. Held while the
 * session waits on a question card: a prompt sent then would queue behind
 * the unanswered question and look like a hang. Stop stays available.
 *
 * Files linked from the editor ride along with the next prompt and are let go
 * once it is sent: they point at what that request is about, not at the session.
 */
export class ChatComposer extends HTMLElement {
  private readonly template = compileTemplate(`
    <form r-submit="submit(event)">
      <p class="recipient" if="hasRecipient">{{recipientText}}</p>
      <p class="refusal" if="refused">{{refusal}}</p>
      <textarea name="prompt" rows="3" placeholder="{{placeholder}}" disabled="{{blocked}}" r-keydown="keydown(event)"></textarea>
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
          <label class="effort" if="effortSwitchable" title="How hard the model thinks on this session's next turn. Default leaves it to the model.">
            <select name="effort" r-change="changeEffort(event)">
              <option value="" selected="{{effortIsDefault}}">default effort</option>
              <option loop="e in efforts" value="{{e.name}}" selected="{{e.selected}}">{{e.name}} effort</option>
            </select>
          </label>
          <span class="model-current" if="modelReadOnly" title="This session's phase runs on the profile chosen for it, from the plan bar.">{{modelCurrent}}</span>
          <span class="effort-current" if="effortReadOnly" title="How hard the model thinks on this phase, as its profile sets it.">{{effortCurrent}} effort</span>
          <button type="button" class="approve-plan" if="approvePlan" title="Approve the plan and build it here, with the full tool set." r-click="approvePlan()">Approve plan</button>
          <linked-files-row class="linked-files"></linked-files-row>
        </span>
        <context-meter class="context"></context-meter>
        <button type="button" class="stop" r-click="stop()">Stop</button>
        <button type="submit" class="send" disabled="{{blocked}}">Send</button>
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
  /** Who what is typed reaches, named so a tab with several conversations never leaves it to a guess. */
  private recipient: string | undefined
  /** Why the conversation shown takes no input; nothing is sent while it stands. */
  private refusal: string | undefined

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

  /** The run what is typed reaches, by name, and why it takes no input when it does not. */
  setTarget(recipient: string | undefined, refusal: string | undefined): void {
    if (this.recipient === recipient && this.refusal === refusal) return
    this.recipient = recipient
    this.refusal = refusal
    this.render()
  }

  focusInput(): void {
    if (!this.blocked) this.textarea.focus()
  }

  private get blocked(): boolean {
    return this.held || this.refusal !== undefined
  }

  private render(): void {
    const { allowWrites, mcp, model, approvePlan } = this.switches
    this.template.render(
      {
        blocked: this.blocked,
        hasRecipient: this.recipient !== undefined,
        recipientText: `To: ${this.recipient ?? ''}`,
        refused: this.refusal !== undefined,
        refusal: this.refusal ?? '',
        placeholder: this.refusal !== undefined ? '' : this.held ? 'Answer or skip the question above first.' : 'Ask for a change...',
        allowWritesAvailable: allowWrites !== undefined,
        allowWrites: allowWrites ?? false,
        mcpAvailable: mcp !== undefined && mcp.length > 0,
        servers: (mcp ?? []).map((s) => ({ ...s, title: s.error ?? s.status })),
        modelSwitchable: model !== undefined && model.options !== undefined,
        modelReadOnly: model !== undefined && model.options === undefined,
        modelCurrent: model?.current ?? '',
        models: (model?.options ?? []).map((name) => ({ name, selected: name === model?.current })),
        // Effort is offered where the model's levels are known and the model itself is switchable; a phase shows its level as text.
        effortSwitchable: model?.options !== undefined && (model.efforts ?? []).length > 0,
        effortIsDefault: model?.effort === undefined,
        efforts: (model?.efforts ?? []).map((name) => ({ name, selected: name === model?.effort })),
        effortReadOnly: model !== undefined && model.options === undefined && model.effort !== undefined,
        effortCurrent: model?.effort ?? '',
        approvePlan: approvePlan ?? false,
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
          if (event.key === 'Escape') {
            event.preventDefault()
            this.dispatchEvent(new InterruptRequestedEvent())
          }
        },
        changeModel: (event: Event) => this.dispatchEvent(new SessionModelChangedEvent((event.target as HTMLSelectElement).value)),
        changeEffort: (event: Event) => {
          const picked = (event.target as HTMLSelectElement).value
          this.dispatchEvent(new SessionEffortChangedEvent(picked === '' ? undefined : (picked as Effort)))
        },
        approvePlan: () => this.dispatchEvent(new PlanApprovedEvent()),
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
    if (text === '' || this.blocked) return
    const files = this.linkedFiles.paths
    this.textarea.value = ''
    this.linkedFiles.clear()
    this.dispatchEvent(new PromptSubmittedEvent(text, files))
  }
}

customElements.define('chat-composer', ChatComposer)
