// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Provider } from '../src/agent/session/model-profile'
import type { SettingsSnapshot } from '../src/settings/protocol'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { ProvidersTab } = await import('../src/settings/webview/providers-tab')
const events = await import('../src/settings/webview/events')

const claude: Provider = { name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5'] }
const berget: Provider = { name: 'berget', engine: 'openai-compatible', baseUrl: 'https://api.berget.ai/v1', models: ['moonshotai/Kimi-K3'] }

function snapshot(over: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    providers: [claude, berget],
    profiles: [],
    activeProfile: '',
    keys: [{ name: 'berget', stored: false }],
    permissions: { allow: [], deny: [] },
    verify: [],
    verifyFailureBudget: 3,
    cleanup: { functionLines: 25, typeLines: 200, fileLines: 400, tests: [], testFunctionLines: 60, testTypeLines: 600, testFileLines: 1200, ignore: [] },
    planIgnore: [],
    nodePath: '',
    traceEngine: false,
    hasWorkspace: true,
    ...over,
  }
}

function tab(state = snapshot()) {
  const node = new ProvidersTab()
  document.body.appendChild(node)
  node.update(state)
  return node
}

const cards = (node: HTMLElement) => [...node.querySelectorAll<HTMLElement>('.providers .provider')]
const edit = (node: HTMLElement, index: number) => {
  ;[...cards(node)[index]!.querySelectorAll('button')].find((b) => b.textContent === 'Edit')!.click()
  return node.querySelector<HTMLFormElement>('form.provider')!
}
const set = (form: HTMLFormElement, name: string, value: string) => {
  const control = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name=${name}]`)!
  control.value = value
  control.dispatchEvent(new Event('input', { bubbles: true }))
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('ProvidersTab cards', () => {
  it('base_url_and_key_name_show_only_for_the_openai_engine', () => {
    const node = tab()
    const form = edit(node, 0)
    const openai = form.querySelector<HTMLElement>('.openai')!
    expect(openai.hidden).toBe(true)
    set(form, 'engine', 'openai-compatible')
    expect(openai.hidden).toBe(false)
    node.remove()
  })

  it('saving_a_card_dispatches_the_edited_provider_at_its_index', () => {
    const node = tab()
    const form = edit(node, 1)
    let seen: unknown
    node.addEventListener(events.ProviderSavedEvent.type, (e) => (seen = [e.index, e.provider]))
    set(form, 'name', 'GLM')
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(seen).toEqual([1, { ...berget, name: 'GLM' }])
    node.remove()
  })

  it('refresh_is_disabled_until_a_base_url_and_a_key_are_both_in_place', () => {
    const node = tab(snapshot({ providers: [claude, { ...berget, baseUrl: '' }] }))
    const form = edit(node, 1)
    const refresh = [...form.querySelectorAll('button')].find((b) => b.textContent === 'Refresh models')!
    expect(refresh.disabled).toBe(true) // no base URL yet, no key
    set(form, 'baseUrl', 'https://api.berget.ai/v1')
    expect(refresh.disabled).toBe(true) // base URL now, still no key
    set(form, 'apiKeyValue', 'sk-1')
    expect(refresh.disabled).toBe(false) // typed, not yet saved: no round trip needed
    node.remove()
  })

  it('refresh_is_enabled_off_an_already_stored_key_without_retyping_it', () => {
    const node = tab(snapshot({ keys: [{ name: 'berget', stored: true }] }))
    const form = edit(node, 1)
    expect([...form.querySelectorAll('button')].find((b) => b.textContent === 'Refresh models')!.disabled).toBe(false)
    node.remove()
  })

  it('refresh_dispatches_the_name_base_url_and_key_as_the_form_has_them', () => {
    const node = tab()
    const form = edit(node, 1)
    set(form, 'baseUrl', 'https://other.example/v1')
    set(form, 'apiKeyValue', 'sk-1')
    let seen: unknown
    node.addEventListener(events.ModelsRefreshRequestedEvent.type, (e) => (seen = [e.name, e.baseUrl, e.apiKeyValue]))
    ;[...form.querySelectorAll('button')].find((b) => b.textContent === 'Refresh models')!.click()
    expect(seen).toEqual(['berget', 'https://other.example/v1', 'sk-1'])
    node.remove()
  })

  it('refresh_saves_the_provider_and_the_typed_key_first_so_a_failed_request_costs_nothing_typed', () => {
    const node = tab()
    const form = edit(node, 1)
    set(form, 'baseUrl', 'https://other.example/v1')
    set(form, 'apiKeyValue', 'sk-1')
    const order: string[] = []
    let provider: unknown
    let key: unknown
    node.addEventListener(events.ProviderSavedEvent.type, (e) => {
      order.push('provider')
      provider = e.provider
    })
    node.addEventListener(events.ApiKeySetEvent.type, (e) => {
      order.push('key')
      key = [e.name, e.value]
    })
    node.addEventListener(events.ModelsRefreshRequestedEvent.type, () => order.push('refresh'))
    ;[...form.querySelectorAll('button')].find((b) => b.textContent === 'Refresh models')!.click()
    expect(order).toEqual(['provider', 'key', 'refresh'])
    expect(provider).toEqual({ ...berget, baseUrl: 'https://other.example/v1' })
    expect(key).toEqual(['berget', 'sk-1'])
    node.remove()
  })

  it('refresh_does_not_close_the_form_the_way_save_does', () => {
    const node = tab()
    const form = edit(node, 1)
    ;[...form.querySelectorAll('button')].find((b) => b.textContent === 'Refresh models')!.click()
    expect(node.querySelector('form.provider')).not.toBeNull()
    node.remove()
  })

  it('a_model_the_endpoint_reports_is_offered_and_adds_on_a_click', () => {
    const node = tab()
    const form = edit(node, 1)
    node.discoveredModels('berget', ['moonshotai/Kimi-K3', 'zai-org/GLM-5.3'])
    const again = node.querySelector<HTMLFormElement>('form.provider')!
    expect(again).not.toBe(form) // redrawn to show the offer
    const offer = [...again.querySelectorAll<HTMLButtonElement>('.offers button')].find((b) => b.textContent === 'zai-org/GLM-5.3')!
    offer.click()
    let seen: Provider | undefined
    node.addEventListener(events.ProviderSavedEvent.type, (e) => (seen = e.provider))
    again.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(seen!.models).toEqual(['moonshotai/Kimi-K3', 'zai-org/GLM-5.3'])
    node.remove()
  })

  it('remove_dispatches_the_index', () => {
    const node = tab()
    let seen: number | undefined
    node.addEventListener(events.ProviderRemovedEvent.type, (e) => (seen = e.index))
    ;[...cards(node)[1]!.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!.click()
    expect(seen).toBe(1)
    node.remove()
  })

  it('the_form_has_a_password_field_for_the_key_itself_beside_its_name', () => {
    const node = tab()
    const form = edit(node, 1)
    const value = form.querySelector<HTMLInputElement>('input[name=apiKeyValue]')!
    expect(value.type).toBe('password')
    expect(value.value).toBe('') // never echoes what is stored
    node.remove()
  })

  it('typing_a_key_and_saving_dispatches_both_the_key_and_the_provider', () => {
    const node = tab()
    const form = edit(node, 1)
    let key: unknown
    let provider: unknown
    node.addEventListener(events.ApiKeySetEvent.type, (e) => (key = [e.name, e.value]))
    node.addEventListener(events.ProviderSavedEvent.type, (e) => (provider = e.provider))
    set(form, 'apiKeyValue', 'sk-1')
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(key).toEqual(['berget', 'sk-1'])
    expect(provider).toEqual(berget)
    node.remove()
  })

  it('saving_with_the_password_field_left_blank_keeps_the_key_untouched', () => {
    const node = tab()
    const form = edit(node, 1)
    let keySet = false
    node.addEventListener(events.ApiKeySetEvent.type, () => (keySet = true))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(keySet).toBe(false)
    node.remove()
  })

  it('renaming_and_setting_the_key_in_the_same_save_stores_it_under_the_new_name', () => {
    const node = tab()
    const form = edit(node, 1)
    let key: unknown
    node.addEventListener(events.ApiKeySetEvent.type, (e) => (key = [e.name, e.value]))
    set(form, 'name', 'GLM')
    set(form, 'apiKeyValue', 'sk-1')
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(key).toEqual(['GLM', 'sk-1'])
    node.remove()
  })

  it('the_provider_is_saved_before_the_key_so_a_rename_moves_the_old_key_before_a_fresh_one_lands', () => {
    const node = tab()
    const form = edit(node, 1)
    const order: string[] = []
    node.addEventListener(events.ProviderSavedEvent.type, () => order.push('provider'))
    node.addEventListener(events.ApiKeySetEvent.type, () => order.push('key'))
    set(form, 'apiKeyValue', 'sk-1')
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(order).toEqual(['provider', 'key'])
    node.remove()
  })
})

describe('ProvidersTab api keys', () => {
  it('a_named_key_shows_its_stored_status_and_never_a_way_to_read_it_back', () => {
    const node = tab()
    const row = node.querySelector<HTMLElement>('.keys .key')!
    expect(row.querySelector('.badge')?.textContent).toBe('missing')
    expect(row.querySelector('input, button')).toBeNull()
    node.update(snapshot({ keys: [{ name: 'berget', stored: true }] }))
    expect(node.querySelector('.keys .key .badge')?.textContent).toBe('stored')
    node.remove()
  })
})
