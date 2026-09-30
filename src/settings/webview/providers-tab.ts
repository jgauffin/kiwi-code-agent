import type { ReasoningControl } from '../../agent/session/effort'
import type { Engine, Provider } from '../../agent/session/model-profile'
import type { SettingsSnapshot } from '../protocol'
import { ApiKeySetEvent, ModelsRefreshRequestedEvent, ProviderRemovedEvent, ProviderSavedEvent } from './events'
import { button, el, field, heading, note, select, settingsFileLink, textInput } from './fields'

const ENGINES: { value: Engine; label: string }[] = [
  { value: 'claude-sdk', label: 'Claude (Agent SDK)' },
  { value: 'openai-compatible', label: 'OpenAI-compatible (own loop, API key)' },
]

const REASONING_CONTROLS: { value: ReasoningControl | ''; label: string }[] = [
  { value: '', label: 'As known for the model' },
  { value: 'reasoning_effort', label: 'reasoning_effort (low, medium, high)' },
  { value: 'none', label: 'None: send no effort' },
]

const engineLabel = (engine: Engine): string => ENGINES.find((e) => e.value === engine)?.label ?? engine

type KeyState = 'stored' | 'missing' | 'login'

/** A Claude provider with no key is not missing one: it runs on the editor's Claude login. */
const keyState = (engine: Engine | undefined, stored: boolean): KeyState => (stored ? 'stored' : engine === 'claude-sdk' ? 'login' : 'missing')

/** A class for the chip or badge that shows a key's state; the login state is neutral, neither good nor bad. */
const keyClass = (state: KeyState): string => (state === 'login' ? '' : state)

/**
 * What models come from: an engine, an endpoint and its key, and the models
 * it serves. A provider is edited as a whole, its API key alongside it. The
 * key is stored under the provider's own name, so a rename carries it and
 * there is no second name to keep in step with the first.
 */
export class ProvidersTab extends HTMLElement {
  private signature = ''
  private snapshot: SettingsSnapshot | undefined
  /** The card open for editing: a provider's index, or one past the end for a new provider. */
  private editing: number | undefined
  /** Models an endpoint just reported, by provider name, offered until the form is closed or saved. */
  private discovered = new Map<string, string[]>()

  update(snapshot: SettingsSnapshot): void {
    const signature = JSON.stringify([snapshot.providers, snapshot.keys])
    this.snapshot = snapshot
    if (signature === this.signature) return
    this.signature = signature
    if (this.editing !== undefined && this.editing > snapshot.providers.length) this.editing = undefined
    this.draw(snapshot)
  }

  /** The endpoint answered a refresh: fold its models into the open form, or drop them once nothing show them. */
  discoveredModels(provider: string, models: string[]): void {
    this.discovered.set(provider, models)
    if (this.snapshot) this.draw(this.snapshot)
  }

  private draw(snapshot: SettingsSnapshot): void {
    this.replaceChildren(heading('Providers', 'User settings'), this.providers(snapshot), this.keys(snapshot), settingsFileLink('user'))
  }

  private providers(snapshot: SettingsSnapshot): HTMLElement {
    const section = el('section', 'providers')
    section.append(el('h3', '', 'Providers'))
    snapshot.providers.forEach((provider, index) => {
      section.append(index === this.editing ? this.form(index, provider, snapshot) : this.card(index, provider, snapshot))
    })
    if (this.editing === snapshot.providers.length) {
      section.append(this.form(this.editing, { name: '', engine: 'claude-sdk', models: [] }, snapshot))
    } else {
      section.append(button('Add provider', () => this.edit(snapshot.providers.length, snapshot), 'add'))
    }
    return section
  }

  private card(index: number, provider: Provider, snapshot: SettingsSnapshot): HTMLElement {
    const card = el('article', 'provider')
    card.append(el('div', 'title', provider.name))
    const chips = el('div', 'chips')
    chips.append(el('span', 'chip', engineLabel(provider.engine)))
    if (provider.baseUrl) chips.append(el('span', 'chip', provider.baseUrl))
    const state = keyState(provider.engine, snapshot.keys.find((k) => k.name === provider.name)?.stored ?? false)
    chips.append(el('span', `chip ${keyClass(state)}`.trim(), state === 'login' ? 'editor login' : `key ${state}`))
    chips.append(el('span', 'chip', provider.models.length === 1 ? '1 model' : `${provider.models.length} models`))
    const controls = el('div', 'controls')
    controls.append(
      button('Edit', () => this.edit(index, this.snapshot!)),
      button('Remove', () => this.dispatchEvent(new ProviderRemovedEvent(index)), 'remove'),
    )
    card.append(chips, controls)
    return card
  }

  private form(index: number, provider: Provider, snapshot: SettingsSnapshot): HTMLElement {
    const form = document.createElement('form')
    form.className = 'provider editing'
    const engine = select('engine', ENGINES, provider.engine)
    const openai = el('div', 'openai')
    openai.hidden = provider.engine !== 'openai-compatible'
    const key = snapshot.keys.find((k) => k.name === provider.name)
    const name = textInput('name', provider.name, { placeholder: 'berget' })
    name.required = true
    const baseUrlInput = textInput('baseUrl', provider.baseUrl ?? '', { placeholder: 'https://api.berget.ai/v1' })
    const reasoning = select('reasoningControl', REASONING_CONTROLS, provider.reasoningControl ?? '')
    const apiKeyValue = textInput('apiKeyValue', '', { placeholder: key?.stored ? 'Replace the stored key' : 'Paste the key' })
    apiKeyValue.type = 'password'
    const offered = this.discovered.get(provider.name) ?? []
    const models = new ModelListField()
    models.configure(provider.models, offered, provider.compactAtTokens ?? {}, snapshot.compactAtTokens)

    /** What the form holds right now, as a `Provider` to save; shared so a refresh saves the same thing Save would. */
    const current = (): Provider => {
      const limits = models.limits()
      const control = reasoning.value as ReasoningControl | ''
      return {
        name: name.value.trim(),
        engine: engine.value as Engine,
        models: models.values(),
        ...(engine.value === 'openai-compatible' ? { baseUrl: baseUrlInput.value.trim() } : {}),
        ...(Object.keys(limits).length > 0 ? { compactAtTokens: limits } : {}),
        ...(engine.value === 'openai-compatible' && control ? { reasoningControl: control } : {}),
      }
    }
    /** Saves what the form holds; a refresh's own network call must not cost what was typed if it fails. */
    const persist = () => {
      const saved = current()
      this.dispatchEvent(new ProviderSavedEvent(index, saved))
      // Saved first, so a rename's move of the old secret happens before a freshly typed one overwrites it.
      if (saved.name && apiKeyValue.value !== '') {
        this.dispatchEvent(new ApiKeySetEvent(saved.name, apiKeyValue.value))
      }
    }

    const refresh = button('Refresh models', () => {
      persist()
      this.dispatchEvent(new ModelsRefreshRequestedEvent(name.value.trim(), baseUrlInput.value.trim(), apiKeyValue.value))
    })
    // Live: it needs what a save would need too, but not the round trip through settings to get it.
    const updateRefresh = () => (refresh.disabled = baseUrlInput.value.trim() === '' || (apiKeyValue.value.trim() === '' && !key?.stored))
    updateRefresh()
    baseUrlInput.addEventListener('input', updateRefresh)
    apiKeyValue.addEventListener('input', updateRefresh)
    openai.append(
      field('Base URL', baseUrlInput),
      refresh,
      el('span', 'hint', 'Refresh saves the provider first, so a failed request never costs what you typed.'),
      field('Effort', reasoning, { hint: 'How the endpoint takes a profile’s effort. The same model may take it on one host and not another.' }),
    )
    const keyField = field('API key', apiKeyValue, { hint: ' ' })
    const keyHint = keyField.querySelector<HTMLElement>('.hint')!
    const describeKey = () => {
      const claude = engine.value === 'claude-sdk'
      keyHint.textContent = key?.stored
        ? `Stored under this provider’s name. Leave blank to keep it${claude ? ', or remove it to use the editor’s Claude login' : ''}.`
        : claude
          ? 'Optional: an Anthropic API key. Without one, sessions use the editor’s Claude login. Stored in the editor’s secret storage, never in settings.'
          : 'Stored in the editor’s secret storage, under this provider’s name, never in settings.'
    }
    describeKey()
    const keyControls: HTMLElement[] = [keyField]
    if (key?.stored) {
      const removeKey = button('Remove key', () => this.dispatchEvent(new ApiKeySetEvent(provider.name, '')), 'remove')
      keyControls.push(removeKey)
    }
    engine.addEventListener('change', () => {
      openai.hidden = engine.value !== 'openai-compatible'
      describeKey()
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
    form.append(
      field('Name', name),
      field('Engine', engine),
      openai,
      ...keyControls,
      field('Models', models, { hint: 'Beside each model, the conversation size in tokens at which it compacts: every request re-sends the whole conversation, so a pricier model may be worth compacting sooner. Blank follows the global setting.' }),
      controls,
    )
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      this.editing = undefined
      this.discovered.delete(provider.name)
      persist()
    })
    return form
  }

  private edit(index: number, snapshot: SettingsSnapshot): void {
    this.editing = index
    this.draw(snapshot)
    this.querySelector<HTMLInputElement>('form input[name=name]')?.focus()
  }

  /** A quick status readout; a key is set or replaced on the provider's own form, above, where its name is already at hand. */
  private keys(snapshot: SettingsSnapshot): HTMLElement {
    const section = el('section', 'keys')
    section.append(el('h3', '', 'API keys'))
    if (snapshot.keys.length === 0) section.append(note('No provider is configured. Keys are stored in the editor’s secret storage, never in settings.'))
    for (const key of snapshot.keys) {
      const state = keyState(snapshot.providers.find((p) => p.name === key.name)?.engine, key.stored)
      const row = el('div', 'key')
      row.append(el('strong', 'name', key.name), el('span', `badge ${keyClass(state)}`.trim(), state === 'login' ? 'editor login' : state))
      section.append(row)
    }
    return section
  }
}

/** One model of a provider's form, as typed so far: its id, and its compaction limit or blank for the global one. */
type ModelRow = { model: string; limit: string }

/**
 * The model list of a provider's form: one row per model with its compaction
 * limit, an offer row per model the endpoint reported but the list lacks.
 */
class ModelListField extends HTMLElement {
  private rows: ModelRow[] = []
  private fallback = 0

  /** Built once per form draw, since the list it starts from is fixed for that draw. */
  configure(models: string[], offered: string[], limits: Record<string, number>, fallbackTokens: number): void {
    this.rows = models.map((model) => ({ model, limit: limits[model] === undefined ? '' : String(limits[model]) }))
    this.fallback = fallbackTokens
    this.className = 'model-list'
    this.draw(offered.filter((m) => !models.includes(m)))
  }

  values(): string[] {
    return this.typed().map((r) => r.model.trim()).filter((v) => v !== '')
  }

  /** The limits typed, by model; a blank or unreadable one is left out so the model follows the global setting. */
  limits(): Record<string, number> {
    const entries = this.typed()
      .map((r) => [r.model.trim(), Number.parseInt(r.limit, 10)] as const)
      .filter(([model, tokens]) => model !== '' && Number.isInteger(tokens) && tokens >= 0)
    return Object.fromEntries(entries)
  }

  /** The rows as the inputs hold them now, so a redraw keeps what was typed. */
  private typed(): ModelRow[] {
    return [...this.querySelectorAll<HTMLElement>('.row')].map((row) => ({
      model: row.querySelector<HTMLInputElement>('input[name=model]')?.value ?? '',
      limit: row.querySelector<HTMLInputElement>('input[name=compactAtTokens]')?.value ?? '',
    }))
  }

  private redraw(offers: string[], change: (rows: ModelRow[]) => ModelRow[]): void {
    this.rows = change(this.typed())
    this.draw(offers)
  }

  private draw(offers: string[]): void {
    this.replaceChildren()
    this.rows.forEach((entry, index) => {
      const model = textInput('model', entry.model)
      const limit = textInput('compactAtTokens', entry.limit, { placeholder: `${this.fallback} (global)` })
      limit.type = 'number'
      limit.min = '0'
      limit.title = 'Compact a conversation on this model once it is this many tokens. Blank follows the global setting on the Advanced tab.'
      const remove = button('×', () => this.redraw(offers, (rows) => rows.filter((_, i) => i !== index)), 'remove')
      const row = el('div', 'row')
      row.append(model, limit, remove)
      this.append(row)
    })
    this.append(button('Add model', () => this.redraw(offers, (rows) => [...rows, { model: '', limit: '' }]), 'add'))
    if (offers.length > 0) {
      const offerRow = el('div', 'offers')
      offerRow.append(el('span', 'hint', 'The endpoint also serves:'))
      for (const model of offers) {
        offerRow.append(button(model, () => this.redraw(offers.filter((m) => m !== model), (rows) => [...rows, { model, limit: '' }]), 'offer'))
      }
      this.append(offerRow)
    }
  }
}

customElements.define('model-list-field', ModelListField)
customElements.define('providers-tab', ProvidersTab)
