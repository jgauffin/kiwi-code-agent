import { EFFORTS, effortLevels, STEP_EFFORT } from '../../agent/session/effort'
import type { Effort, ModelChoice, Profile, Provider, Step, StepChoice } from '../../agent/session/model-profile'
import { STEP_GROUPS, STEPS, stepTitle, type StepGroup } from '../../agent/session/session-manager'
import type { SettingsSnapshot } from '../protocol'
import { DefaultProfileChangedEvent } from '../../chat/webview/events'
import { ProfileRemovedEvent, ProfileSavedEvent, ProfileStepGroupSelectedEvent } from './events'
import { button, el, field, heading, select, settingsFileLink, textInput } from './fields'

/** What a blank effort means on a row: the provider's own for the default, the step's suggestion or the default's for a step. */
const blankEffort = (step: Step | undefined): string => {
  if (!step) return 'Provider default'
  const suggested = STEP_EFFORT[step]
  return suggested ? `Suggested (${suggested})` : 'Same as default'
}

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
  /** The kind of session whose steps the form shows; kept across redraws and profiles. */
  private group: StepGroup = 'Chat'

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
    for (const { step } of STEPS) {
      const own = profile.steps?.[step]
      if (own) chips.append(el('span', 'chip', `${stepTitle(step)}: ${describe(own)}`))
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
    defaultRow.configure('default', 'Default', profile.default, snapshot.providers)
    const stepRows = STEPS.map((s) => {
      const row = new ChoiceRow()
      row.configure(`step-${s.step}`, s.label, profile.steps?.[s.step], snapshot.providers, s)
      return row
    })
    // A step without a model of its own runs the default's, so what effort it can take follows the default row.
    const inherit = () => stepRows.forEach((row) => row.inherit(defaultRow.whole()))
    defaultRow.addEventListener('change', inherit)
    inherit()
    // Every pane stays in the form while hidden, so a step set on one tab saves with the rest.
    const strip = el('nav', 'subtabs')
    const panes = STEP_GROUPS.map((group) => {
      const pane = el('div', 'step-pane')
      pane.append(...stepRows.filter((_, i) => STEPS[i]!.group === group))
      return { group, pane }
    })
    const showGroup = () => {
      strip.replaceChildren(
        ...STEP_GROUPS.map((group) => {
          const tab = button(group, () => tab.dispatchEvent(new ProfileStepGroupSelectedEvent(group)))
          tab.className = `tab${group === this.group ? ' active' : ''}`
          return tab
        }),
      )
      for (const { group, pane } of panes) pane.hidden = group !== this.group
    }
    form.addEventListener(ProfileStepGroupSelectedEvent.type, (event) => {
      this.group = event.group
      showGroup()
    })
    showGroup()
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
    const steps = el('section', 'steps')
    steps.append(el('h4', '', 'Per step, only where it differs'), strip, ...panes.map((p) => p.pane))
    form.append(field('Name', name), defaultRow, steps, controls)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      this.editing = undefined
      const overrides = stepRows.map((r) => [r.stepKey(), r.choice()] as const).filter(([, choice]) => choice !== undefined)
      const steps = overrides.length > 0 ? (Object.fromEntries(overrides) as Profile['steps']) : undefined
      this.dispatchEvent(
        new ProfileSavedEvent(index, { name: name.value.trim(), default: defaultRow.whole(), ...(steps ? { steps } : {}) }),
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

const describe = (choice: StepChoice): string => {
  if (!choice.provider || !choice.model) return `${choice.effort} effort`
  return `${choice.provider} · ${choice.model}${choice.effort ? ` (${choice.effort})` : ''}`
}

const modelsOf = (providers: Provider[], name: string): string[] => providers.find((p) => p.name === name)?.models ?? []

/**
 * One row of a profile form: the default, always on, or a step. A step's
 * "Override" box governs only its model; its effort is its own either way.
 */
class ChoiceRow extends HTMLElement {
  private key = ''
  private providers: Provider[] = []
  private override: HTMLInputElement | undefined
  private provider!: HTMLSelectElement
  private model!: HTMLSelectElement
  private effort!: HTMLSelectElement
  /** The default row's model, which a step without its own runs on. */
  private inherited: ModelChoice | undefined

  /** Built once per row per form draw, since the row's providers and choice are fixed for that draw. A step row is given its step. */
  configure(key: string, label: string, choice: StepChoice | undefined, providers: Provider[], step?: { step: Step; hint: string }): void {
    this.key = key
    this.providers = providers
    this.className = 'choice-row'
    const ownModel = choice?.provider && choice.model ? { provider: choice.provider, model: choice.model } : undefined
    const active = ownModel ?? { provider: providers[0]?.name ?? '', model: providers[0]?.models[0] ?? '' }
    this.provider = select(`${key}-provider`, providers.map((p) => ({ value: p.name, label: p.name })), active.provider)
    this.model = select(`${key}-model`, modelsOf(providers, active.provider).map((m) => ({ value: m, label: m })), active.model)
    const levels = [{ value: '', label: blankEffort(step?.step) }, ...EFFORTS.map((e) => ({ value: e, label: e }))]
    this.effort = select(`${key}-effort`, levels, choice?.effort ?? '')
    this.provider.addEventListener('change', () => {
      const models = modelsOf(providers, this.provider.value)
      this.model.replaceChildren(...models.map((m) => new Option(m, m)))
    })
    this.addEventListener('change', () => this.refresh())
    const row = el('div', 'row')
    row.append(el('span', 'label', label), this.provider, this.model, this.effort)
    if (step) {
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.name = `${key}-override`
      box.title = 'Own model'
      box.checked = ownModel !== undefined
      this.override = box
      row.prepend(box)
    }
    this.replaceChildren(row)
    if (step) this.append(el('span', 'hint', step.hint))
    this.refresh()
  }

  stepKey(): string {
    return this.key.replace(/^step-/, '')
  }

  inherit(model: ModelChoice): void {
    this.inherited = model
    this.refresh()
  }

  /** The row's model and effort as they stand, what the default row saves. */
  whole(): ModelChoice {
    const effort = this.effort.value as Effort | ''
    return { provider: this.provider.value, model: this.model.value, ...(effort ? { effort } : {}) }
  }

  /** A step row's own model and effort, or undefined where it says nothing of its own. */
  choice(): StepChoice | undefined {
    const effort = this.effort.value as Effort | ''
    const own = this.override?.checked ?? true
    const choice: StepChoice = { ...(own ? { provider: this.provider.value, model: this.model.value } : {}), ...(effort ? { effort } : {}) }
    return Object.keys(choice).length > 0 ? choice : undefined
  }

  /** The model the row runs on decides which efforts it can take; one taking none turns the picker off. */
  private refresh(): void {
    const own = this.override?.checked ?? true
    this.provider.disabled = !own
    this.model.disabled = !own
    const runsOn = own ? { provider: this.provider.value, model: this.model.value } : this.inherited
    const provider = runsOn && this.providers.find((p) => p.name === runsOn.provider)
    const takes = provider ? effortLevels(provider, runsOn.model) : EFFORTS
    this.effort.disabled = takes.length === 0
    for (const option of this.effort.options) option.disabled = option.value !== '' && !takes.includes(option.value as Effort)
  }
}

customElements.define('choice-row', ChoiceRow)
customElements.define('profiles-tab', ProfilesTab)
