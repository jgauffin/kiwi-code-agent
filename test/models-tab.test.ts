// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ModelProfile } from '../src/agent/session/model-profile'
import type { SettingsSnapshot } from '../src/settings/protocol'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { ModelsTab } = await import('../src/settings/webview/models-tab')
const events = await import('../src/settings/webview/events')

const claude: ModelProfile = { name: 'Claude', engine: 'claude-sdk', model: 'claude-opus-5', effort: 'high' }
const kimi: ModelProfile = { name: 'Kimi', engine: 'openai-compatible', model: 'moonshotai/Kimi-K3', baseUrl: 'https://api.berget.ai/v1', apiKeySecret: 'berget' }

function snapshot(over: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    profiles: [claude, kimi],
    activeProfile: 'Claude',
    planProfile: '',
    keys: [{ name: 'berget', stored: false }],
    permissions: { allow: [], deny: [] },
    verify: [],
    verifyFailureBudget: 3,
    cleanup: { functionLines: 25, typeLines: 200, fileLines: 400, ignore: [] },
    planIgnore: [],
    nodePath: '',
    traceEngine: false,
    hasWorkspace: true,
    ...over,
  }
}

function tab(state = snapshot()) {
  const node = new ModelsTab()
  document.body.appendChild(node)
  node.update(state)
  return node
}

const cards = (node: HTMLElement) => [...node.querySelectorAll<HTMLElement>('.profiles .profile')]
const edit = (node: HTMLElement, index: number) => {
  ;[...cards(node)[index]!.querySelectorAll('button')].find((b) => b.textContent === 'Edit')!.click()
  return node.querySelector<HTMLFormElement>('form.profile')!
}
const set = (form: HTMLFormElement, name: string, value: string) => {
  const control = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name=${name}]`)!
  control.value = value
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('ModelsTab defaults', () => {
  it('the_pickers_list_every_profile_and_save_under_their_keys', () => {
    const node = tab()
    const work = node.querySelector<HTMLSelectElement>('select[name=activeProfile]')!
    const plan = node.querySelector<HTMLSelectElement>('select[name=planProfile]')!
    expect([...work.options].map((o) => o.value)).toEqual(['Claude', 'Kimi'])
    expect([...plan.options].map((o) => o.textContent)).toEqual(['Same as model', 'Claude', 'Kimi'])
    expect(plan.value).toBe('')
    let seen: unknown
    node.addEventListener(events.SettingSavedEvent.type, (e) => (seen = [e.key, e.value]))
    plan.value = 'Kimi'
    plan.dispatchEvent(new Event('change', { bubbles: true }))
    expect(seen).toEqual(['planProfile', 'Kimi'])
    node.remove()
  })

  it('a_card_shows_which_role_its_profile_holds', () => {
    const node = tab(snapshot({ planProfile: 'Kimi' }))
    expect(cards(node)[0]!.querySelector('.badge')?.textContent).toBe('model')
    expect(cards(node)[1]!.querySelector('.badge')?.textContent).toBe('plan model')
    node.remove()
  })
})

describe('ModelsTab profile cards', () => {
  it('base_url_and_key_name_show_only_for_the_openai_engine', () => {
    const node = tab()
    const form = edit(node, 0)
    const openai = form.querySelector<HTMLElement>('.openai')!
    expect(openai.hidden).toBe(true)
    set(form, 'engine', 'openai-compatible')
    expect(openai.hidden).toBe(false)
    node.remove()
  })

  it('saving_a_card_dispatches_the_edited_profile_at_its_index', () => {
    const node = tab()
    const form = edit(node, 1)
    let seen: unknown
    node.addEventListener(events.ProfileSavedEvent.type, (e) => (seen = [e.index, e.profile]))
    set(form, 'model', 'zai-org/GLM-5.3')
    set(form, 'effort', 'low')
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(seen).toEqual([1, { ...kimi, model: 'zai-org/GLM-5.3', effort: 'low' }])
    node.remove()
  })

  it('a_claude_card_saves_no_openai_fields_even_if_typed', () => {
    const node = tab()
    const form = edit(node, 0)
    set(form, 'engine', 'openai-compatible')
    set(form, 'baseUrl', 'https://x')
    set(form, 'engine', 'claude-sdk')
    let seen: ModelProfile | undefined
    node.addEventListener(events.ProfileSavedEvent.type, (e) => (seen = e.profile))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(seen).toEqual(claude)
    node.remove()
  })

  it('add_profile_opens_a_form_past_the_end_and_cancel_closes_it', () => {
    const node = tab()
    ;[...node.querySelectorAll('button')].find((b) => b.textContent === 'Add profile')!.click()
    const form = node.querySelector<HTMLFormElement>('form.profile')!
    expect(cards(node)).toHaveLength(3)
    let seen: number | undefined
    node.addEventListener(events.ProfileSavedEvent.type, (e) => (seen = e.index))
    set(form, 'name', 'GLM')
    set(form, 'model', 'zai-org/GLM-5.3')
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(seen).toBe(2)
    // The form stays until the host answers: a refused save leaves what was typed in place.
    expect(node.querySelector('form.profile')).not.toBeNull()
    node.update(snapshot({ profiles: [claude, kimi, { name: 'GLM', engine: 'claude-sdk', model: 'zai-org/GLM-5.3' }] }))
    expect(node.querySelector('form.profile')).toBeNull()
    expect(cards(node)).toHaveLength(3)
    ;[...node.querySelectorAll('button')].find((b) => b.textContent === 'Add profile')!.click()
    ;[...node.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click()
    expect(node.querySelector('form.profile')).toBeNull()
    expect(cards(node)).toHaveLength(3)
    node.remove()
  })

  it('remove_dispatches_the_index', () => {
    const node = tab()
    let seen: number | undefined
    node.addEventListener(events.ProfileRemovedEvent.type, (e) => (seen = e.index))
    ;[...cards(node)[1]!.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!.click()
    expect(seen).toBe(1)
    node.remove()
  })
})

describe('ModelsTab api keys', () => {
  it('a_named_key_shows_stored_or_missing_and_sets_without_echo', () => {
    const node = tab()
    const row = node.querySelector<HTMLElement>('.keys .key')!
    expect(row.querySelector('.badge')?.textContent).toBe('missing')
    ;[...row.querySelectorAll('button')].find((b) => b.textContent === 'Set')!.click()
    const input = row.querySelector<HTMLInputElement>('input')!
    expect(input.type).toBe('password')
    let seen: unknown
    node.addEventListener(events.ApiKeySetEvent.type, (e) => (seen = [e.name, e.value]))
    input.value = 'sk-1'
    row.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(seen).toEqual(['berget', 'sk-1'])
    expect(row.querySelector('input')).toBeNull()
    node.update(snapshot({ keys: [{ name: 'berget', stored: true }] }))
    expect(node.querySelector('.keys .key .badge')?.textContent).toBe('stored')
    expect([...node.querySelectorAll('.keys button')].map((b) => b.textContent)).toContain('Replace')
    node.remove()
  })
})
