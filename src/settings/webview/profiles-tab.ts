import type { Effort, ModelChoice, Profile, Provider } from '../../agent/session/model-profile'
import { STEPS } from '../../agent/session/session-manager'
import type { SettingsSnapshot } from '../protocol'
import { DefaultProfileChangedEvent } from '../../chat/webview/events'
import { ProfileRemovedEvent, ProfileSavedEvent } from './events'
import { button, el, field, heading, select, settingsFileLink, textInput } from './fields'

const EFFORTS: { value: Effort | ''; label: string }[] = [
  { value: '', label: 'Provider default' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
]

/**
 * What a session runs on: a profile names a model for every step, one default
 * and the steps that earn a different one, built out of the providers on the
 * Providers tab. A profile is edited as a whole, since half of one is not a
 * profile; which profile is in use saves as it changes.
 */
export class ProfilesTab extends HTMLElement {
  private signature = ''
  /** The card open for editing: a profile's index, or one past the end for a new profile. */
  private editing: number | undefined

  update(snapshot: SettingsSnapshot): void {
    const signature = JSON.stringify([snapshot.providers, snapshot.profiles, snapshot.activeProfile])
    if (signature === this.signature) return
    this.signature = signature
    if (this.editing !== undefined && this.editing > snapshot.profiles.length) this.editing = undefined
    this.draw(snapshot)
  }

  private draw(snapshot: SettingsSnapshot): void {
    this.replaceChildren(heading('Profiles', 'User settings'), this.defaults(snapshot), this.profiles(snapshot), settingsFileLink('user'))
  }

  private defaults(snapshot: SettingsSnapshot): HTMLElement {
    const section = el('section', 'defaults')
    const names = snapshot.profiles.map((p) => ({ value: p.name, label: p.name }))
    const active = select('activeProfile', names, snapshot.activeProfile)
    active.addEventListener('change', () => this.dispatchEvent(new DefaultProfileChangedEvent(active.value)))
    section.append(el('h3', '', 'New sessions run on'), field('Profile', active))
    return section
  }

  private profiles(snapshot: SettingsSnapshot): HTMLElement {
    const section = el('section', 'profiles')
    section.append(el('h3', '', 'Profiles'))
    if (snapshot.providers.length === 0) section.append(el('p', 'note', 'Add a provider first, on the Providers tab.'))
    snapshot.profiles.forEach((profile, index) => {
      section.append(index === this.editing ? this.form(index, profile, snapshot) : this.card(index, profile, snapshot))
    })
    if (this.editing === snapshot.profiles.length) {
      const blank: Profile = { name: '', default: { provider: snapshot.providers[0]?.name ?? '', model: snapshot.providers[0]?.models[0] ?? '' } }
      section.append(this.form(this.editing, blank, snapshot))
    } else if (snapshot.providers.length > 0) {
      section.append(button('Add profile', () => this.edit(snapshot.profiles.length, snapshot), 'add'))
    }
    return section
  }

  private card(index: number, profile: Profile, snapshot: SettingsSnapshot): HTMLElement {
    const card = el('article', 'profile')
    const title = el('div', 'title')
    title.append(el('strong', 'name', profile.name))
    if (profile.name === snapshot.activeProfile) title.append(el('span', 'badge', 'in use'))
    const chips = el('div', 'chips')
    chips.append(el('span', 'chip', `default ${describe(profile.default)}`))
    for (const { step, label } of STEPS) {
      const own = profile.steps?.[step]
      if (own) chips.append(el('span', 'chip', `${label}: ${describe(own)}`))
    }
    const controls = el('div', 'controls')
    controls.append(
      button('Edit', () => this.edit(index, snapshot)),
      button('Remove', () => this.dispatchEvent(new ProfileRemovedEvent(index)), 'remove'),
    )
    card.append(title, chips, controls)
    return card
  }

  private form(index: number, profile: Profile, snapshot: SettingsSnapshot): HTMLElement {
    const form = document.createElement('form')
    form.className = 'profile editing'
    const name = textInput('name', profile.name, { placeholder: 'Balanced' })
    name.required = true
    const defaultRow = new ChoiceRow()
    defaultRow.configure('default', 'Default', profile.default, snapshot.providers, true)
    const stepRows = STEPS.map((s) => {
      const row = new ChoiceRow()
      row.configure(`step-${s.step}`, s.label, profile.steps?.[s.step], snapshot.providers, false, s.hint)
      return row
    })
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
    form.append(field('Name', name), defaultRow, el('h4', '', 'Per step, only where it differs'), ...stepRows, controls)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      this.editing = undefined
      const overrides = stepRows.filter((r) => r.hasOverride())
      const steps = overrides.length > 0 ? (Object.fromEntries(overrides.map((r) => [r.stepKey(), r.choice()])) as Profile['steps']) : undefined
      this.dispatchEvent(
        new ProfileSavedEvent(index, { name: name.value.trim(), default: defaultRow.choice()!, ...(steps ? { steps } : {}) }),
      )
    })
    return form
  }

  private edit(index: number, snapshot: SettingsSnapshot): void {
    this.editing = index
    this.draw(snapshot)
    this.querySelector<HTMLInputElement>('form input[name=name]')?.focus()
  }
}

const describe = (choice: ModelChoice): string => `${choice.provider} · ${choice.model}${choice.effort ? ` (${choice.effort})` : ''}`

const modelsOf = (providers: Provider[], name: string): string[] => providers.find((p) => p.name === name)?.models ?? []

/** One row of a profile form: the default, always on, or a step, toggled by an "Override" box. */
class ChoiceRow extends HTMLElement {
  private key = ''
  private override: HTMLInputElement | undefined
  private provider!: HTMLSelectElement
  private model!: HTMLSelectElement
  private effort!: HTMLSelectElement

  /** Built once per row per form draw, since the row's providers and choice are fixed for that draw. */
  configure(key: string, label: string, choice: ModelChoice | undefined, providers: Provider[], alwaysOn: boolean, hint?: string): void {
    this.key = key
    this.className = 'choice-row'
    const active = choice ?? { provider: providers[0]?.name ?? '', model: providers[0]?.models[0] ?? '' }
    this.provider = select(`${key}-provider`, providers.map((p) => ({ value: p.name, label: p.name })), active.provider)
    this.model = select(`${key}-model`, modelsOf(providers, active.provider).map((m) => ({ value: m, label: m })), active.model)
    this.effort = select(`${key}-effort`, EFFORTS, active.effort ?? '')
    this.provider.addEventListener('change', () => {
      const models = modelsOf(providers, this.provider.value)
      this.model.replaceChildren(...models.map((m) => new Option(m, m)))
    })
    const row = el('div', 'row')
    row.append(el('span', 'label', label), this.provider, this.model, this.effort)
    if (!alwaysOn) {
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = choice !== undefined
      box.addEventListener('change', () => this.setDisabled())
      this.override = box
      row.prepend(box)
    }
    this.replaceChildren(row)
    if (hint) this.append(el('span', 'hint', hint))
    this.setDisabled()
  }

  stepKey(): string {
    return this.key.replace(/^step-/, '')
  }

  hasOverride(): boolean {
    return this.override?.checked ?? true
  }

  choice(): ModelChoice | undefined {
    if (!this.hasOverride()) return undefined
    const effort = this.effort.value as Effort | ''
    return { provider: this.provider.value, model: this.model.value, ...(effort ? { effort } : {}) }
  }

  private setDisabled(): void {
    const on = this.hasOverride()
    this.provider.disabled = !on
    this.model.disabled = !on
    this.effort.disabled = !on
  }
}

customElements.define('choice-row', ChoiceRow)
customElements.define('profiles-tab', ProfilesTab)
