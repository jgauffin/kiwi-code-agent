import { compileTemplate } from '@relax.js/core/html'
import { readData } from '@relax.js/core/forms'
import type { SessionMode } from '../../agent/session/session-manager'
import type { ResumablePlan } from '../protocol'
import type { ProfileDefaults } from '../../settings/settings-store'
import { DefaultProfileChangedEvent, NewSessionRequestedEvent, PlanResumeRequestedEvent } from './events'

type NewSessionForm = { mode: SessionMode; feature?: string; prompt?: string }

/** The cards: a session type to start, or a plan on disk to pick up. */
type Choice = SessionMode | 'resume'

type PlanRow = ResumablePlan & { hint: string }

/** What picking the plan up means at its status: the plan bar offers the same. */
const STATUS_HINT: Record<ResumablePlan['status'], string> = {
  draft: 'draft: review, check or approve',
  approved: 'approved: ready to implement',
}

/**
 * The "+" screen. One card per session type, plus one for picking up a plan
 * on disk; the fields differ per card, so a new type means a new card, not
 * more conditionals.
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
      <p class="hint">The planner reads docs/**, the README and the other specs, never the code, and writes plan/&lt;feature&gt;.spec.md.</p>
      <button type="submit">Start planning</button>
    </form>
  `)
  private mode: Choice = 'chat'
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
        chatState: this.mode === 'chat' ? 'selected' : '',
        planState: this.mode === 'plan' ? 'selected' : '',
        resumeState: this.mode === 'resume' ? 'selected' : '',
        hasPlans: this.plans.length > 0,
        plans: this.plans,
      },
      {
        resume: (p: PlanRow) => this.dispatchEvent(new PlanResumeRequestedEvent(p.feature)),
        pick: (role: 'work' | 'plan', event: Event) =>
          this.dispatchEvent(new DefaultProfileChangedEvent(role, (event.target as HTMLSelectElement).value)),
        choose: (mode: Choice) => {
          this.mode = mode
          this.render()
          this.querySelector<HTMLElement>('form input, form textarea')?.focus()
        },
        create: (event: SubmitEvent) => {
          event.preventDefault()
          if (this.mode === 'resume') return
          const data = readData<NewSessionForm>(event.target as HTMLFormElement)
          this.dispatchEvent(new NewSessionRequestedEvent(this.mode, data.feature?.trim() || undefined, data.prompt?.trim() || undefined))
        },
      },
    )
  }
}

customElements.define('new-session-view', NewSessionView)
