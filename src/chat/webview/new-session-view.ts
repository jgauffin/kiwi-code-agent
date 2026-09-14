import { compileTemplate } from '@relax.js/core/html'
import { readData } from '@relax.js/core/forms'
import type { SessionMode } from '../../agent/session/session-manager'
import { NewSessionRequestedEvent } from './events'

type NewSessionForm = { mode: SessionMode; feature?: string; prompt?: string }

/**
 * The "+" screen. One card per session type; the fields differ per type,
 * so a new type means a new card, not more conditionals.
 */
export class NewSessionView extends HTMLElement {
  private readonly template = compileTemplate(`
    <h2>New session</h2>
    <div class="types">
      <button type="button" class="type {{chatState}}" r-click="choose('chat')">
        <span class="icon">🔧</span>
        <strong>Chat</strong>
        <span class="hint">Work in the code with the full tool set.</span>
      </button>
      <button type="button" class="type {{planState}}" r-click="choose('plan')">
        <span class="icon">📐</span>
        <strong>Plan</strong>
        <span class="hint">Write a spec from the intent docs, blind to the code.</span>
      </button>
    </div>
    <form class="chat-fields" if="isChat" r-submit="create(event)">
      <label>First prompt (optional)
        <textarea name="prompt" rows="4" placeholder="What should be done?"></textarea>
      </label>
      <button type="submit">Start chat</button>
    </form>
    <form class="plan-fields" if="isPlan" r-submit="create(event)">
      <label>Feature name
        <input name="feature" required placeholder="Order cancellation">
      </label>
      <label>User story or feature description
        <textarea name="prompt" rows="6" required placeholder="As a ... I want ... so that ..."></textarea>
      </label>
      <p class="hint">The planner reads docs/intent/** only and writes plan/&lt;feature&gt;.spec.md.</p>
      <button type="submit">Start planning</button>
    </form>
  `)
  private mode: SessionMode = 'chat'

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.render()
  }

  reset(): void {
    this.mode = 'chat'
    this.render()
  }

  private render(): void {
    this.template.render(
      {
        isChat: this.mode === 'chat',
        isPlan: this.mode === 'plan',
        chatState: this.mode === 'chat' ? 'selected' : '',
        planState: this.mode === 'plan' ? 'selected' : '',
      },
      {
        choose: (mode: SessionMode) => {
          this.mode = mode
          this.render()
          this.querySelector<HTMLElement>('form input, form textarea')?.focus()
        },
        create: (event: SubmitEvent) => {
          event.preventDefault()
          const data = readData<NewSessionForm>(event.target as HTMLFormElement)
          this.dispatchEvent(new NewSessionRequestedEvent(this.mode, data.feature?.trim() || undefined, data.prompt?.trim() || undefined))
        },
      },
    )
  }
}

customElements.define('new-session-view', NewSessionView)
