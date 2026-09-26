import { compileTemplate } from '@relax.js/core/html'
import { readData } from '@relax.js/core/forms'
import type { SessionMode } from '../../agent/session/session-manager'
import type { ResumablePlan } from '../protocol'
import type { ProfileDefaults } from '../../settings/settings-store'
import { LinkedFilesRow } from './linked-files-row'
import { DefaultProfileChangedEvent, NewSessionRequestedEvent, PlanResumeRequestedEvent } from './events'

type NewSessionForm = { mode: SessionMode; feature?: string; prompt?: string }

/** The cards: a session type to start, or a plan on disk to pick up. */
type Choice = SessionMode | 'resume'

type PlanRow = ResumablePlan & { hint: string }

/** The text fields, held by the view rather than by the form that happens to show them. */
type Draft = { feature: string; prompt: string }

type TextField = HTMLInputElement | HTMLTextAreaElement

/** What picking the plan up means at its status: the plan bar offers the same. */
const STATUS_HINT: Record<ResumablePlan['status'], string> = {
  draft: 'draft: review, check or approve',
  approved: 'approved: ready to implement',
}

/**
 * The "+" screen. One card per session type, plus one for picking up a plan
 * on disk; the fields differ per card, so a new type means a new card, not
 * more conditionals.
 *
 * A card with a prompt links files beside its start button. On the plan card
 * that is a doc or a spec: a planner reads docs/**, the README and the specs
 * and nothing else, so a linked source file is a read it is denied.
 * The docs card has nothing to fill in, and is still a card with a button: a
 * session costs tokens, so it is never one stray click away.
 */
export class NewSessionView extends HTMLElement {
  private readonly template = compileTemplate(`
    <h2>New session</h2>
    <div class="models">
      <label>Model
        <select name="work" r-change="pick('work', event)">
          <option loop="p in work" value="{{p.name}}" selected="{{p.selected}}">{{p.name}}</option>
        </select>
      </label>
      <label>Plan model
        <select name="plan" r-change="pick('plan', event)">
          <option value="" selected="{{planFollows}}">Same as model</option>
          <option loop="p in plan" value="{{p.name}}" selected="{{p.selected}}">{{p.name}}</option>
        </select>
      </label>
    </div>
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
      <button type="button" class="type {{resumeState}}" r-click="choose('resume')">
        <span class="icon">↩</span>
        <strong>Resume plan</strong>
        <span class="hint">Pick up a spec under plan/ where it stands.</span>
      </button>
      <button type="button" class="type {{docsState}}" r-click="choose('docs')">
        <span class="icon">🧭</span>
        <strong>Evaluate docs</strong>
        <span class="hint">Say where the docs would cost a planner, and change them.</span>
      </button>
    </div>
    <section class="resume" if="isResume">
      <p class="hint" unless="hasPlans">No plan under plan/ is in progress.</p>
      <ul class="plans" if="hasPlans">
        <li loop="p in plans">
          <button type="button" class="plan {{p.status}}" title="Open the plan session behind this spec, or start one on it." r-click="resume(p)">
            <strong>{{p.feature}}</strong>
            <span class="hint">{{p.hint}}</span>
          </button>
        </li>
      </ul>
    </section>
    <form class="chat-fields" if="isChat" r-submit="create(event)">
      <label>First prompt (optional)
        <textarea name="prompt" rows="4" placeholder="What should be done?" r-input="edit('prompt', event)"></textarea>
      </label>
      <div class="submit">
        <button type="submit">Start chat</button>
        <linked-files-row class="linked-files"></linked-files-row>
      </div>
    </form>
    <form class="plan-fields" if="isPlan" r-submit="create(event)">
      <label>Feature name
        <input name="feature" required placeholder="Order cancellation" r-input="edit('feature', event)">
      </label>
      <label>User story or feature description
        <textarea name="prompt" rows="6" required placeholder="As a ... I want ... so that ..." r-input="edit('prompt', event)"></textarea>
      </label>
      <p class="hint">The planner reads docs/**, the README and the other specs, never the code, and writes plan/&lt;feature&gt;.spec.md.</p>
      <div class="submit">
        <button type="submit">Start planning</button>
        <linked-files-row class="linked-files"></linked-files-row>
      </div>
    </form>
    <form class="docs-fields" if="isDocs" r-submit="create(event)">
      <p class="hint">Reads docs/**, the README and the specs, and says in chat where their arrangement would cost a planner: what it has to read whole, what it cannot cite. It changes a doc only when you ask, one confirmed write at a time.</p>
      <button type="submit">Evaluate the docs</button>
    </form>
  `)
  private mode: Choice = 'chat'
  /** What has been typed, so swapping card keeps it: the same intent describes either session type. */
  private draft: Draft = { feature: '', prompt: '' }
  private plans: PlanRow[] = []
  private profiles: ProfileDefaults = { names: [], active: '', plan: '' }

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.render()
  }

  reset(): void {
    this.mode = 'chat'
    this.render()
  }

  update(plans: ResumablePlan[], profiles: ProfileDefaults): void {
    const rows = plans.map((p) => ({ ...p, hint: STATUS_HINT[p.status] }))
    // State arrives often; a re-render while the user types is only worth it when something shown changed.
    if (JSON.stringify([rows, profiles]) === JSON.stringify([this.plans, this.profiles])) return
    this.plans = rows
    this.profiles = profiles
    this.render()
  }

  private render(): void {
    const { names, active, plan } = this.profiles
    this.template.render(
      {
        work: names.map((name) => ({ name, selected: name === active })),
        plan: names.map((name) => ({ name, selected: name === plan })),
        planFollows: plan === '',
        isChat: this.mode === 'chat',
        isPlan: this.mode === 'plan',
        isResume: this.mode === 'resume',
        isDocs: this.mode === 'docs',
        chatState: this.mode === 'chat' ? 'selected' : '',
        planState: this.mode === 'plan' ? 'selected' : '',
        resumeState: this.mode === 'resume' ? 'selected' : '',
        docsState: this.mode === 'docs' ? 'selected' : '',
        hasPlans: this.plans.length > 0,
        plans: this.plans,
      },
      {
        resume: (p: PlanRow) => this.dispatchEvent(new PlanResumeRequestedEvent(p.feature)),
        pick: (role: 'work' | 'plan', event: Event) =>
          this.dispatchEvent(new DefaultProfileChangedEvent(role, (event.target as HTMLSelectElement).value)),
        edit: (field: keyof Draft, event: Event) => {
          this.draft[field] = (event.target as TextField).value
        },
        choose: (mode: Choice) => {
          this.mode = mode
          this.render()
          // A card with nothing to fill in focuses its button, so the keyboard reaches the next step either way.
          this.querySelector<HTMLElement>('form input, form textarea, form button[type=submit]')?.focus()
        },
        create: (event: SubmitEvent) => {
          event.preventDefault()
          if (this.mode === 'resume') return
          const form = event.target as HTMLFormElement
          const data = readData<NewSessionForm>(form)
          const row = form.querySelector('linked-files-row') as LinkedFilesRow | null
          const request = new NewSessionRequestedEvent(
            this.mode,
            data.feature?.trim() || undefined,
            data.prompt?.trim() || undefined,
            row?.paths ?? [],
          )
          // The session carries all of it now; what stays behind would only be sent twice.
          this.draft = { feature: '', prompt: '' }
          row?.clear()
          this.render()
          this.dispatchEvent(request)
        },
      },
    )
    this.fill('input[name="feature"]', this.draft.feature)
    this.fill('textarea[name="prompt"]', this.draft.prompt)
  }

  /** Writes a field back after a render dropped it; an unchanged value is left alone to keep the caret. */
  private fill(selector: string, value: string): void {
    const field = this.querySelector(selector) as TextField | null
    if (field && field.value !== value) field.value = value
  }
}

customElements.define('new-session-view', NewSessionView)
