import { compileTemplate } from '@relax.js/core/html'
import { readData } from '@relax.js/core/forms'
import type { SessionMode } from '../../agent/session/session-manager'
import type { ProfileDefaults } from '../../settings/settings-store'
import type { ResumableChat, ResumablePlan } from '../protocol'
import { LinkedFilesRow } from './linked-files-row'
import { DefaultProfileChangedEvent, NewSessionRequestedEvent, PlanResumeRequestedEvent, SessionSelectedEvent } from './events'

type NewSessionForm = { mode: SessionMode; feature?: string; prompt?: string }

/** Work already on disk this screen offers to pick up rather than start over. */
export type PickUp = { plans: ResumablePlan[]; chats: ResumableChat[]; unfiled: number }

const STATUS_HINT: Record<ResumablePlan['status'], string> = {
  draft: 'draft: review, check or approve',
  approved: 'approved: ready to implement',
}

const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })

/** The text fields, held by the view rather than by the form that happens to show them. */
type Draft = { feature: string; prompt: string }

type TextField = HTMLInputElement | HTMLTextAreaElement

/**
 * The two halves of the screen. Work in the code is what a person comes here
 * for; maintenance is the upkeep of the intent that work is planned from, and
 * it is nobody's errand of the day, so it waits on a tab of its own rather
 * than among the session types.
 */
type Screen = 'code' | 'maintenance'

/** The card a tab opens on, so a tab is never a row of cards with nothing under it. */
const FIRST: Record<Screen, SessionMode> = { code: 'chat', maintenance: 'docs' }

/**
 * The "+" screen, in two tabs: Code and Maintenance. One card per session
 * type; the fields differ per card, so a new type means a new card, not more
 * conditionals. Work already on disk is picked up from the list below the code
 * tab's cards, since it is not a new session.
 *
 * A card with a prompt links files beside its start button. On the plan card
 * that is a doc or a spec: a planner reads docs/**, the README and the specs
 * and nothing else, so a linked source file is a read it is denied.
 * A maintenance card has nothing to fill in, and is still a card with a
 * button: a session costs tokens, so it is never one stray click away.
 */
export class NewSessionView extends HTMLElement {
  private readonly template = compileTemplate(`
    <h2>New session</h2>
    <div class="models">
      <label>Profile
        <select name="profile" r-change="pick(event)">
          <option loop="p in profiles" value="{{p.name}}" selected="{{p.selected}}">{{p.name}}</option>
        </select>
      </label>
    </div>
    <div class="screens">
      <button type="button" class="tab {{codeScreenState}}" r-click="open('code')">Code</button>
      <button type="button" class="tab {{maintenanceScreenState}}" r-click="open('maintenance')">
        Maintenance<span class="waiting" if="unfiled">{{unfiled}}</span>
      </button>
    </div>
    <div class="types" if="onCode">
      <button type="button" class="type {{chatState}}" r-click="choose('chat')">
        <span class="icon">🔧</span>
        <strong>Chat</strong>
        <span class="hint">Work in the code with the full tool set.</span>
      </button>
      <button type="button" class="type {{codePlanState}}" r-click="choose('code-plan')">
        <span class="icon">🗺</span>
        <strong>Plan</strong>
        <span class="hint">Agree on intent, then plan against the code.</span>
      </button>
      <button type="button" class="type {{planState}}" r-click="choose('plan')">
        <span class="icon">📐</span>
        <strong>Feature planning</strong>
        <span class="hint">Write a spec from the intent docs, blind to the code.</span>
      </button>
    </div>
    <div class="types" if="onMaintenance">
      <button type="button" class="type {{docsState}}" r-click="choose('docs')">
        <span class="icon">🧭</span>
        <strong>Evaluate docs</strong>
        <span class="hint">Say where the docs would cost a planner, and change them.</span>
      </button>
      <button type="button" class="type {{filingState}}" r-click="choose('file-decisions')">
        <span class="icon">🗂</span>
        <strong>File decisions</strong>
        <span class="hint">{{filingHint}}</span>
      </button>
    </div>
    <form class="chat-fields" if="isChat" r-submit="create(event)">
      <label>First prompt (optional)
        <textarea name="prompt" rows="4" placeholder="What should be done?" r-input="edit('prompt', event)"></textarea>
      </label>
      <div class="submit">
        <button type="submit">Start chat</button>
        <linked-files-row class="linked-files"></linked-files-row>
      </div>
    </form>
    <form class="code-plan-fields" if="isCodePlan" r-submit="create(event)">
      <label>What should be done?
        <textarea name="prompt" rows="6" required placeholder="The change, and why" r-input="edit('prompt', event)"></textarea>
      </label>
      <p class="hint">The planner settles what you want before it reads the code, then plans in chat. Continue in chat builds it.</p>
      <div class="submit">
        <button type="submit">Start planning</button>
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
        <button type="submit">Start feature planning</button>
        <linked-files-row class="linked-files"></linked-files-row>
      </div>
    </form>
    <form class="docs-fields" if="isDocs" r-submit="create(event)">
      <p class="hint">Reads docs/**, the README and the specs, and says in chat where their arrangement would cost a planner: what it has to read whole, what it cannot cite. It changes a doc only when you ask, one confirmed write at a time.</p>
      <button type="submit">Evaluate the docs</button>
    </form>
    <form class="filing-fields" if="isFiling" r-submit="create(event)">
      <p class="hint">Reads the unfiled decisions with the docs and the specs, says where each one belongs, and moves it there one confirmed write at a time. An entry leaves the file once it stands where a planner looks for it.</p>
      <p class="hint" if="nothingUnfiled">Nothing is waiting. An entry lands there when a chat or an implement run settles something that reaches features other than the one at hand.</p>
      <button type="submit" if="unfiled">File the decisions</button>
    </form>
    <section class="pick-up" if="any">
      <h3>Pick up where you left off</h3>
      <ul class="picks">
        <li loop="p in plans">
          <button type="button" class="pick plan {{p.status}}" r-click="resume(p)">
            <span class="icon">📐</span>
            <span class="what"><strong>{{p.feature}}</strong><span class="hint">{{p.hint}}</span></span>
          </button>
        </li>
        <li loop="c in chats">
          <button type="button" class="pick chat" r-click="reopen(c)">
            <span class="icon">🔧</span>
            <span class="what"><strong>{{c.title}}</strong><span class="hint">{{c.hint}}</span></span>
          </button>
        </li>
      </ul>
    </section>
  `)
  private screen: Screen = 'code'
  private mode: SessionMode = 'chat'
  /** What has been typed, so swapping card keeps it: the same intent describes either session type. */
  private draft: Draft = { feature: '', prompt: '' }
  private profileDefaults: ProfileDefaults = { names: [], active: '' }
  private pickUp: PickUp = { plans: [], chats: [], unfiled: 0 }

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.render()
  }

  reset(): void {
    this.screen = 'code'
    this.mode = 'chat'
    this.render()
  }

  update(profiles: ProfileDefaults, pickUp: PickUp): void {
    // State arrives often; a re-render while the user types is only worth it when something shown changed.
    if (JSON.stringify([profiles, pickUp]) === JSON.stringify([this.profileDefaults, this.pickUp])) return
    this.profileDefaults = profiles
    this.pickUp = pickUp
    this.render()
  }

  private render(): void {
    const { names, active } = this.profileDefaults
    const { plans, chats, unfiled } = this.pickUp
    this.template.render(
      {
        profiles: names.map((name) => ({ name, selected: name === active })),
        // Plans and chats are code work; what waits to be filed is counted on the maintenance tab instead.
        any: this.screen === 'code' && (plans.length > 0 || chats.length > 0),
        unfiled,
        nothingUnfiled: unfiled === 0,
        filingHint: unfiled > 0 ? `${unfiled} decided, not yet in the specs or docs` : 'Nothing waiting to be filed',
        plans: plans.map((p) => ({ ...p, hint: STATUS_HINT[p.status] })),
        chats: chats.map((c) => ({ ...c, hint: `last worked on ${when(c.startedAt)}` })),
        onCode: this.screen === 'code',
        onMaintenance: this.screen === 'maintenance',
        codeScreenState: this.screen === 'code' ? 'active' : '',
        maintenanceScreenState: this.screen === 'maintenance' ? 'active' : '',
        isChat: this.mode === 'chat',
        isCodePlan: this.mode === 'code-plan',
        isPlan: this.mode === 'plan',
        isDocs: this.mode === 'docs',
        isFiling: this.mode === 'file-decisions',
        chatState: this.mode === 'chat' ? 'selected' : '',
        codePlanState: this.mode === 'code-plan' ? 'selected' : '',
        planState: this.mode === 'plan' ? 'selected' : '',
        docsState: this.mode === 'docs' ? 'selected' : '',
        filingState: this.mode === 'file-decisions' ? 'selected' : '',
      },
      {
        pick: (event: Event) => this.dispatchEvent(new DefaultProfileChangedEvent((event.target as HTMLSelectElement).value)),
        open: (screen: Screen) => {
          if (screen === this.screen) return
          this.screen = screen
          this.choose(FIRST[screen])
        },
        resume: (plan: ResumablePlan) => this.dispatchEvent(new PlanResumeRequestedEvent(plan.feature)),
        reopen: (chat: ResumableChat) => this.dispatchEvent(new SessionSelectedEvent(chat.sessionId)),
        edit: (field: keyof Draft, event: Event) => {
          this.draft[field] = (event.target as TextField).value
        },
        choose: (mode: SessionMode) => this.choose(mode),
        create: (event: SubmitEvent) => {
          event.preventDefault()
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
