import { compileTemplate } from '@relax.js/core/html'
import { readData } from '@relax.js/core/forms'
import type { SessionMode } from '../../agent/session/session-manager'
import type { ProfileDefaults } from '../../settings/settings-store'
import type { ResumableChat, ResumablePlan, UpdatableSpec } from '../protocol'
import { LinkedFilesRow } from './linked-files-row'
import {
  DefaultProfileChangedEvent,
  FeatureNameSuggestionRequestedEvent,
  NewSessionRequestedEvent,
  PlanResumeRequestedEvent,
  SessionSelectedEvent,
  UpdateSpecRequestedEvent,
} from './events'

type NewSessionForm = { mode: SessionMode; feature?: string; prompt?: string }

/** A card the new-session screen offers beside the engine's own session types: pick a spec, rather than start one from nothing. */
type Card = SessionMode | 'update-spec'

/** Work already on disk this screen offers to pick up rather than start over. */
export type PickUp = { plans: ResumablePlan[]; chats: ResumableChat[]; unfiled: number; updates: UpdatableSpec[] }

/** One spec on the Update spec card's picker: pickable once nothing is in flight, saying what it waits for otherwise. */
const updateChoice = (u: UpdatableSpec) => {
  const pickable = u.status === 'draft' || u.changeable === true
  return { feature: u.feature, disabled: !pickable, label: pickable ? `${u.feature} (${u.status})` : `${u.feature} (${u.status}) — waiting: ${u.waiting}` }
}

/** One folder's specs, in the Update spec picker: an `<optgroup>` of its own, named after it. */
type UpdateGroup = { folder: string; items: ReturnType<typeof updateChoice>[] }

/**
 * `folder`-carrying items, root first as they always sorted, then one
 * `<optgroup>` per folder: the folder groups specs, so the ones it holds sit
 * together, named by their feature same as any other.
 */
function groupUpdates(updates: UpdatableSpec[]): { rootUpdates: ReturnType<typeof updateChoice>[]; updateGroups: UpdateGroup[] } {
  const rootUpdates = updates.filter((u) => !u.folder).map(updateChoice)
  const byFolder = new Map<string, UpdatableSpec[]>()
  for (const u of updates) if (u.folder) byFolder.set(u.folder, [...(byFolder.get(u.folder) ?? []), u])
  const groups = [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([folder, items]) => ({ folder, items: items.map(updateChoice) }))
  return { rootUpdates, updateGroups: groups }
}

/**
 * The pick-up list's plans, root first as they always sorted, then grouped by
 * folder: a `heading` on the group's first item names the folder it opens,
 * the same flat list of buttons otherwise so picking one is unchanged.
 */
function withFolderHeadings<T extends { folder?: string }>(items: T[]): (T & { heading?: string })[] {
  const root = items.filter((i) => !i.folder)
  const byFolder = new Map<string, T[]>()
  for (const item of items) if (item.folder) byFolder.set(item.folder, [...(byFolder.get(item.folder) ?? []), item])
  const grouped = [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b))
  return [...root, ...grouped.flatMap(([folder, group]) => group.map((item, i) => ({ ...item, ...(i === 0 ? { heading: folder } : {}) })))]
}

const STATUS_HINT: Record<NonNullable<ResumablePlan['status']>, string> = {
  draft: 'draft: review, check or approve',
  approved: 'approved: ready to implement',
  implemented: 'implemented: ready to verify',
  verified: 'verified: done',
}

/** How a draft came to be, for the pick-up list; nothing recorded reads as hand-written. */
const AUTHORED_HINT: Record<NonNullable<ResumablePlan['authored']>, string> = {
  planned: 'planned with you',
  drafted: 'drafted from the docs',
  'hand-written': 'hand-written',
}

/** How far a draft's review has got, for the pick-up list. */
const REVIEW_HINT: Record<NonNullable<ResumablePlan['review']>, string> = {
  created: 'never reviewed',
  under_review: 'review in flight',
  final_draft: 'every comment answered',
}

/** The card each conversation was started from, so a pick reads as the session type it is. */
const CONVERSATION: Partial<Record<SessionMode, { icon: string; label: string }>> = {
  chat: { icon: '🔧', label: 'Chat' },
  'code-plan': { icon: '🗺', label: 'Plan' },
  'file-decisions': { icon: '🗂', label: 'Filing decisions' },
  'doc-migration': { icon: '🧹', label: 'Docs cleanup' },
}

const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })

const planHint = (plan: ResumablePlan): string => {
  const stage = plan.status ? STATUS_HINT[plan.status] : 'no spec yet'
  // How a draft came to be and how far its review got matter only while it still is one.
  const parts = [stage, ...(plan.authored ? [AUTHORED_HINT[plan.authored]] : []), ...(plan.review ? [REVIEW_HINT[plan.review]] : [])]
  const summary = parts.join(' · ')
  return plan.lastActiveAt ? `${summary} · last worked on ${when(plan.lastActiveAt)}` : summary
}

const chatPick = (chat: ResumableChat) => {
  const kind = CONVERSATION[chat.mode] ?? CONVERSATION.chat!
  return { ...chat, icon: kind.icon, hint: `${kind.label} · last worked on ${when(chat.lastActiveAt)}` }
}

/** The text fields, held by the view rather than by the form that happens to show them. */
type Draft = { feature: string; prompt: string }

type TextField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

/**
 * The two halves of the screen. Work in the code is what a person comes here
 * for; maintenance is the upkeep of the intent that work is planned from, and
 * it is nobody's errand of the day, so it waits on a tab of its own rather
 * than among the session types.
 */
type Screen = 'code' | 'maintenance'

/** The card a tab opens on, so a tab is never a row of cards with nothing under it. */
const FIRST: Record<Screen, SessionMode> = { code: 'chat', maintenance: 'doc-migration' }

/** Where the plan card's ask for a name stands: in flight, and what the last one left to say. */
type Naming = { asking: boolean; reason: string }

/** What the plan card's name button offers. Only an ask in flight disables it: whether a description is there is read when it is pressed, so no keystroke re-renders the form under the caret. */
function namingData({ asking, reason }: Naming) {
  return { cannotName: asking, nameLabel: asking ? 'Naming…' : 'Suggest a name', nameHint: reason }
}

/** The template data for a render: what each card and tab shows, from the screen and mode shown and what is there to pick up. */
function renderData(screen: Screen, mode: Card, profileDefaults: ProfileDefaults, pickUp: PickUp, naming: Naming) {
  const { names, active } = profileDefaults
  const { plans, chats, unfiled, updates } = pickUp
  return {
    ...namingData(naming),
    profiles: names.map((name) => ({ name, selected: name === active })),
    // Plans and chats are code work; what waits to be filed is counted on the maintenance tab instead.
    any: screen === 'code' && (plans.length > 0 || chats.length > 0),
    unfiled,
    nothingUnfiled: unfiled === 0,
    filingHint: unfiled > 0 ? `${unfiled} decided, not yet in the specs or docs` : 'Nothing waiting to be filed',
    plans: withFolderHeadings(plans).map((p) => ({ ...p, stage: p.status ?? 'unwritten', hint: planHint(p) })),
    chats: chats.map(chatPick),
    ...groupUpdates(updates),
    noUpdates: updates.length === 0,
    onCode: screen === 'code',
    onMaintenance: screen === 'maintenance',
    codeScreenState: screen === 'code' ? 'active' : '',
    maintenanceScreenState: screen === 'maintenance' ? 'active' : '',
    isChat: mode === 'chat',
    isCodePlan: mode === 'code-plan',
    isPlan: mode === 'plan',
    isUpdate: mode === 'update-spec',
    isFiling: mode === 'file-decisions',
    isMigration: mode === 'doc-migration',
    chatState: mode === 'chat' ? 'selected' : '',
    codePlanState: mode === 'code-plan' ? 'selected' : '',
    planState: mode === 'plan' ? 'selected' : '',
    updateState: mode === 'update-spec' ? 'selected' : '',
    filingState: mode === 'file-decisions' ? 'selected' : '',
    migrationState: mode === 'doc-migration' ? 'selected' : '',
  }
}

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
      <button type="button" class="type {{updateState}}" r-click="choose('update-spec')">
        <span class="icon">🔄</span>
        <strong>Update spec</strong>
        <span class="hint">Pick a spec, whatever its state, and say what should change.</span>
      </button>
    </div>
    <div class="types" if="onMaintenance">
      <button type="button" class="type {{migrationState}}" r-click="choose('doc-migration')">
        <span class="icon">🧹</span>
        <strong>Clean up docs</strong>
        <span class="hint">Move behaviour into specs, drop what the specs already say, and make the rest easy to find.</span>
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
      <p class="hint">The planner settles what you want before it reads the code, then plans in chat. Approve plan builds it.</p>
      <div class="submit">
        <button type="submit">Start planning</button>
        <linked-files-row class="linked-files"></linked-files-row>
      </div>
    </form>
    <form class="plan-fields" if="isPlan" r-submit="create(event)">
      <label>Feature name
        <input name="feature" required placeholder="Order cancellation" r-input="edit('feature', event)">
      </label>
      <div class="naming">
        <button type="button" class="suggest" disabled="{{cannotName}}" r-click="suggestName()">{{nameLabel}}</button>
        <span class="hint" if="nameHint">{{nameHint}}</span>
      </div>
      <label>User story or feature description
        <textarea name="prompt" rows="6" required placeholder="As a ... I want ... so that ..." r-input="edit('prompt', event)"></textarea>
      </label>
      <p class="hint">The planner reads docs/**, the README and the other specs, never the code, and writes specs/&lt;feature&gt;.spec.md.</p>
      <div class="submit">
        <button type="submit">Start feature planning</button>
        <linked-files-row class="linked-files"></linked-files-row>
      </div>
    </form>
    <form class="update-fields" if="isUpdate" r-submit="create(event)">
      <label>Which spec?
        <select name="feature" required r-change="edit('feature', event)">
          <option value="" disabled selected hidden>Pick a spec</option>
          <option loop="u in rootUpdates" value="{{u.feature}}" disabled="{{u.disabled}}">{{u.label}}</option>
          <optgroup loop="g in updateGroups" label="{{g.folder}}">
            <option loop="u in g.items" value="{{u.feature}}" disabled="{{u.disabled}}">{{u.label}}</option>
          </optgroup>
        </select>
      </label>
      <label>What should change, and why?
        <textarea name="prompt" rows="6" required placeholder="What should change, and why" r-input="edit('prompt', event)"></textarea>
      </label>
      <p class="hint" if="noUpdates">No spec yet: write one with Feature planning first.</p>
      <div class="submit">
        <button type="submit">Update spec</button>
      </div>
    </form>
    <form class="filing-fields" if="isFiling" r-submit="create(event)">
      <p class="hint">Reads the unfiled decisions with the docs and the specs, says where each one belongs, and moves it there one confirmed write at a time. An entry leaves the file once it stands where a planner looks for it.</p>
      <p class="hint" if="nothingUnfiled">Nothing is waiting. An entry lands there when a chat or an implement run settles something that reaches features other than the one at hand.</p>
      <button type="submit" if="unfiled">File the decisions</button>
    </form>
    <form class="migration-fields" if="isMigration" r-submit="create(event)">
      <p class="hint">Reads docs/**, the README and the specs, never the code, in three stages: cut what a settled spec already says, turn behaviour no spec holds into draft specs, then fix what makes the rest hard to find or cite. Each stage proposes first, and you can stop after any of them. Each change to a doc is one confirmed write, asked for by you.</p>
      <button type="submit">Clean up the docs</button>
    </form>
    <section class="pick-up" if="any">
      <h3>Pick up where you left off</h3>
      <ul class="picks">
        <li loop="p in plans">
          <h4 class="folder-heading" if="p.heading">{{p.heading}}</h4>
          <button type="button" class="pick plan {{p.stage}}" r-click="resume(p)">
            <span class="icon">📐</span>
            <span class="what"><strong>{{p.feature}}</strong><span class="hint">{{p.hint}}</span></span>
          </button>
        </li>
        <li loop="c in chats">
          <button type="button" class="pick chat" r-click="reopen(c)">
            <span class="icon">{{c.icon}}</span>
            <span class="what"><strong>{{c.title}}</strong><span class="hint">{{c.hint}}</span></span>
          </button>
        </li>
      </ul>
    </section>
  `)
  private screen: Screen = 'code'
  private mode: Card = 'chat'
  /** What has been typed, so swapping card keeps it: the same intent describes either session type. */
  private draft: Draft = { feature: '', prompt: '' }
  private profileDefaults: ProfileDefaults = { names: [], active: '' }
  private pickUp: PickUp = { plans: [], chats: [], unfiled: 0, updates: [] }
  /** An ask for a name in flight, and what the last one left to say. */
  private asking = false
  private nameReason = ''

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.render()
  }

  reset(): void {
    this.screen = 'code'
    this.mode = 'chat'
    this.asking = false
    this.nameReason = ''
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
    this.template.render(
      renderData(this.screen, this.mode, this.profileDefaults, this.pickUp, { asking: this.asking, reason: this.nameReason }),
      {
        suggestName: () => this.suggestName(),
        pick: (event: Event) => this.dispatchEvent(new DefaultProfileChangedEvent((event.target as HTMLSelectElement).value)),
        open: (screen: Screen) => {
          if (screen === this.screen) return
          this.screen = screen
          this.choose(FIRST[screen])
        },
        // What was typed before picking a plan goes with it; the card is about to be replaced by that plan's chat.
        resume: (plan: ResumablePlan) => this.dispatchEvent(new PlanResumeRequestedEvent(plan.feature, this.take())),
        reopen: (chat: ResumableChat) => this.dispatchEvent(new SessionSelectedEvent(chat.sessionId)),
        edit: (field: keyof Draft, event: Event) => {
          this.draft[field] = (event.target as TextField).value
        },
        choose: (mode: Card) => this.choose(mode),
        create: (event: SubmitEvent) => {
          event.preventDefault()
          const form = event.target as HTMLFormElement
          if (this.mode === 'update-spec') return this.updateSpec(form)
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
    this.fill('input[name="feature"], select[name="feature"]', this.draft.feature)
    this.fill('textarea[name="prompt"]', this.draft.prompt)
  }

  /** Asks the host to name the feature being described; the button says it is at work until the answer lands. */
  private suggestName(): void {
    if (this.asking) return
    const description = this.draft.prompt.trim()
    this.asking = description !== ''
    this.nameReason = description === '' ? 'Describe the feature below first, so there is something to name it from.' : ''
    this.render()
    if (description !== '') this.dispatchEvent(new FeatureNameSuggestionRequestedEvent(description))
  }

  /**
   * The host's answer to a name asked for. A name goes into the field, where it
   * is the developer's to keep or edit; a failure says why, rather than leaving
   * the button at work over an answer that is never coming.
   */
  suggestedName(answer: { name?: string; reason?: string }): void {
    this.asking = false
    if (answer.name) this.draft.feature = answer.name
    this.nameReason = answer.reason ?? ''
    this.render()
  }

  /** Update spec's own submit: a pick and a description, neither of which starts anything on its own. */
  private updateSpec(form: HTMLFormElement): void {
    const data = readData<{ feature?: string; prompt?: string }>(form)
    const feature = data.feature?.trim()
    const description = data.prompt?.trim()
    if (!feature || !description) return
    this.draft = { feature: '', prompt: '' }
    this.render()
    this.dispatchEvent(new UpdateSpecRequestedEvent(feature, description))
  }

  private choose(mode: Card): void {
    this.mode = mode
    this.render()
    // A card with nothing to fill in focuses its button, so the keyboard reaches the next step either way.
    this.querySelector<HTMLElement>('form input, form textarea, form button[type=submit]')?.focus()
  }

  /** The typed prompt, taken off the card so it cannot be sent twice. */
  private take(): string | undefined {
    const note = this.draft.prompt.trim()
    this.draft = { feature: '', prompt: '' }
    this.render()
    return note || undefined
  }

  /** Writes a field back after a render dropped it; an unchanged value is left alone to keep the caret. */
  private fill(selector: string, value: string): void {
    const field = this.querySelector(selector) as TextField | null
    if (field && field.value !== value) field.value = value
  }
}

customElements.define('new-session-view', NewSessionView)
