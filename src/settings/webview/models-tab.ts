import type { Effort, Engine, ModelProfile } from '../../agent/session/model-profile'
import type { ApiKeyState, SettingsSnapshot } from '../protocol'
import { ApiKeySetEvent, ProfileRemovedEvent, ProfileSavedEvent, SettingSavedEvent } from './events'
import { button, el, field, heading, note, onChange, select, settingsFileLink, textInput } from './fields'

const ENGINES: { value: Engine; label: string }[] = [
  { value: 'claude-sdk', label: 'Claude (Agent SDK, editor login)' },
  { value: 'openai-compatible', label: 'OpenAI-compatible (own loop, API key)' },
]

const EFFORTS: { value: Effort | ''; label: string }[] = [
  { value: '', label: 'Engine default' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
]

const engineLabel = (engine: Engine): string => ENGINES.find((e) => e.value === engine)?.label ?? engine

/**
 * What a session can run on: the profiles, which of them new sessions get,
 * and the keys the profiles name. A profile is edited as a whole, since half
 * of one is not a profile; the rest saves as it changes.
 */
export class ModelsTab extends HTMLElement {
  private signature = ''
  /** The card open for editing: a profile's index, or one past the end for a new profile. */
  private editing: number | undefined

  update(snapshot: SettingsSnapshot): void {
    const signature = JSON.stringify([snapshot.profiles, snapshot.activeProfile, snapshot.planProfile, snapshot.keys])
    if (signature === this.signature) return
    this.signature = signature
    if (this.editing !== undefined && this.editing > snapshot.profiles.length) this.editing = undefined
    this.draw(snapshot)
  }

  private draw(snapshot: SettingsSnapshot): void {
    this.replaceChildren(
      heading('Models', 'User settings'),
      this.defaults(snapshot),
      this.profiles(snapshot),
      this.keys(snapshot.keys),
      settingsFileLink('user'),
    )
  }

  private defaults(snapshot: SettingsSnapshot): HTMLElement {
    const section = el('section', 'defaults')
    const names = snapshot.profiles.map((p) => ({ value: p.name, label: p.name }))
    const work = select('activeProfile', names, snapshot.activeProfile)
    onChange(work, () => this.dispatchEvent(new SettingSavedEvent('activeProfile', work.value)))
    const plan = select('planProfile', [{ value: '', label: 'Same as model' }, ...names], snapshot.planProfile)
    onChange(plan, () => this.dispatchEvent(new SettingSavedEvent('planProfile', plan.value)))
    section.append(
      el('h3', '', 'New sessions run on'),
      field('Model', work, { hint: 'Chat and implement sessions.' }),
      field('Plan model', plan, { hint: 'Plan, map and cleanup sessions: the strongest reasoner you have.' }),
    )
    return section
  }

  private profiles(snapshot: SettingsSnapshot): HTMLElement {
    const section = el('section', 'profiles')
    section.append(el('h3', '', 'Profiles'))
    snapshot.profiles.forEach((profile, index) => {
      section.append(index === this.editing ? this.form(index, profile, snapshot) : this.card(index, profile, snapshot))
    })
    if (this.editing === snapshot.profiles.length) {
      section.append(this.form(this.editing, { name: '', engine: 'claude-sdk', model: '' }, snapshot))
    } else {
      section.append(button('Add profile', () => this.edit(snapshot.profiles.length, snapshot), 'add'))
    }
    return section
  }

  private card(index: number, profile: ModelProfile, snapshot: SettingsSnapshot): HTMLElement {
    const card = el('article', 'profile')
    const title = el('div', 'title')
    title.append(el('strong', 'name', profile.name))
    if (profile.name === snapshot.activeProfile) title.append(el('span', 'badge', 'model'))
    if (profile.name === snapshot.planProfile) title.append(el('span', 'badge', 'plan model'))
    const chips = el('div', 'chips')
    chips.append(el('span', 'chip', engineLabel(profile.engine)), el('span', 'chip', profile.model))
    if (profile.effort) chips.append(el('span', 'chip', `effort ${profile.effort}`))
    if (profile.baseUrl) chips.append(el('span', 'chip', profile.baseUrl))
    if (profile.apiKeySecret) chips.append(el('span', 'chip', `key ${profile.apiKeySecret}`))
    const controls = el('div', 'controls')
    controls.append(
      button('Edit', () => this.edit(index, snapshot)),
      button('Remove', () => this.dispatchEvent(new ProfileRemovedEvent(index)), 'remove'),
    )
    card.append(title, chips, controls)
    return card
  }

  private form(index: number, profile: ModelProfile, snapshot: SettingsSnapshot): HTMLElement {
    const form = document.createElement('form')
    form.className = 'profile editing'
    const engine = select('engine', ENGINES, profile.engine)
    const openai = el('div', 'openai')
    openai.hidden = profile.engine !== 'openai-compatible'
    openai.append(
      field('Base URL', textInput('baseUrl', profile.baseUrl ?? '', { placeholder: 'https://api.berget.ai/v1' })),
      field('API key name', textInput('apiKeySecret', profile.apiKeySecret ?? '', { placeholder: 'berget' }), {
        hint: 'The key itself is set under API keys below; profiles sharing a name share the key.',
      }),
      field('System prompt file', textInput('systemPromptFile', profile.systemPromptFile ?? '', { placeholder: 'docs/agent-prompt.md' }), {
        hint: 'Relative to the workspace, appended after CLAUDE.md.',
      }),
    )
    engine.addEventListener('change', () => (openai.hidden = engine.value !== 'openai-compatible'))
    const name = textInput('name', profile.name, { placeholder: 'Claude' })
    name.required = true
    const model = textInput('model', profile.model, { placeholder: 'claude-opus-5' })
    model.required = true
    const cancel = button('Cancel', () => {
      this.editing = undefined
      this.draw(snapshot)
    })
    cancel.className = 'cancel'
    const save = document.createElement('button')
    save.type = 'submit'
    save.textContent = 'Save'
    const controls = el('div', 'controls')
    controls.append(save, cancel)
    form.append(
      field('Name', name),
      field('Engine', engine),
      field('Model', model),
      field('Effort', select('effort', EFFORTS, profile.effort ?? ''), { hint: 'Claude engine only.' }),
      openai,
      controls,
    )
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      this.editing = undefined
      this.dispatchEvent(new ProfileSavedEvent(index, readProfile(form)))
    })
    return form
  }

  private edit(index: number, snapshot: SettingsSnapshot): void {
    this.editing = index
    this.draw(snapshot)
    this.querySelector<HTMLInputElement>('form input[name=name]')?.focus()
  }

  private keys(keys: ApiKeyState[]): HTMLElement {
    const section = el('section', 'keys')
    section.append(el('h3', '', 'API keys'))
    if (keys.length === 0) section.append(note('No profile names an API key. Keys are stored in the editor’s secret storage, never in settings.'))
    for (const key of keys) {
      const row = new ApiKeyRow()
      row.update(key)
      section.append(row)
    }
    return section
  }
}

/** One named key: whether it is stored, and a way to set it that never shows what is there. */
class ApiKeyRow extends HTMLElement {
  private key: ApiKeyState = { name: '', stored: false }

  update(key: ApiKeyState): void {
    this.key = key
    this.className = 'key'
    this.closed()
  }

  private closed(): void {
    this.replaceChildren(
      el('strong', 'name', this.key.name),
      el('span', `badge ${this.key.stored ? 'stored' : 'missing'}`, this.key.stored ? 'stored' : 'missing'),
      button(this.key.stored ? 'Replace' : 'Set', () => this.open()),
    )
  }

  private open(): void {
    const form = document.createElement('form')
    const input = textInput('value', '', { placeholder: 'Paste the key' })
    input.type = 'password'
    input.required = true
    const save = document.createElement('button')
    save.type = 'submit'
    save.textContent = 'Save'
    const cancel = button('Cancel', () => this.closed(), 'cancel')
    form.append(input, save, cancel)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      this.dispatchEvent(new ApiKeySetEvent(this.key.name, input.value))
      this.closed()
    })
    this.replaceChildren(el('strong', 'name', this.key.name), form)
    input.focus()
  }
}

function readProfile(form: HTMLFormElement): ModelProfile {
  const data = new FormData(form)
  const text = (name: string) => String(data.get(name) ?? '').trim()
  const engine = text('engine') as Engine
  const effort = text('effort') as Effort | ''
  return {
    name: text('name'),
    engine,
    model: text('model'),
    ...(effort ? { effort } : {}),
    ...(engine === 'openai-compatible'
      ? { baseUrl: text('baseUrl'), apiKeySecret: text('apiKeySecret'), ...(text('systemPromptFile') ? { systemPromptFile: text('systemPromptFile') } : {}) }
      : {}),
  }
}

customElements.define('api-key-row', ApiKeyRow)
customElements.define('models-tab', ModelsTab)
