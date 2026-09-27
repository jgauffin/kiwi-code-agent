// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Profile, Provider } from '../src/agent/session/model-profile'
import type { SettingsSnapshot } from '../src/settings/protocol'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { ProfilesTab } = await import('../src/settings/webview/profiles-tab')
const events = await import('../src/settings/webview/events')
const chatEvents = await import('../src/chat/webview/events')

const claude: Provider = { name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5', 'claude-sonnet-5'] }
const berget: Provider = { name: 'berget', engine: 'openai-compatible', baseUrl: 'https://api.berget.ai/v1', models: ['moonshotai/Kimi-K3'] }

const balanced: Profile = { name: 'Balanced', default: { provider: 'Claude', model: 'claude-sonnet-5' } }
const opusPlan: Profile = { name: 'Opus plan', default: { provider: 'Claude', model: 'claude-sonnet-5' }, steps: { plan: { provider: 'Claude', model: 'claude-opus-5', effort: 'high' } } }

function snapshot(over: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    providers: [claude, berget],
    profiles: [balanced, opusPlan],
    activeProfile: 'Balanced',
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
  const node = new ProfilesTab()
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

describe('ProfilesTab defaults', () => {
  it('the_picker_lists_every_profile_and_saves_the_one_in_use', () => {
    const node = tab()
    const active = node.querySelector<HTMLSelectElement>('select[name=activeProfile]')!
    expect([...active.options].map((o) => o.value)).toEqual(['Balanced', 'Opus plan'])
    let seen: unknown
    node.addEventListener(chatEvents.DefaultProfileChangedEvent.type, (e) => (seen = e.name))
    active.value = 'Opus plan'
    active.dispatchEvent(new Event('change', { bubbles: true }))
    expect(seen).toBe('Opus plan')
    node.remove()
  })
})

describe('ProfilesTab profile cards', () => {
  it('a_card_shows_the_default_and_every_step_that_overrides_it', () => {
    const node = tab()
    expect(cards(node)[0]!.querySelector('.chips')!.textContent).toContain('default Claude · claude-sonnet-5')
    expect(cards(node)[1]!.querySelector('.chips')!.textContent).toContain('Plan: Claude · claude-opus-5 (high)')
    expect(cards(node)[1]!.querySelector('.chips')!.textContent).not.toContain('Implement')
    node.remove()
  })

  it('the_card_in_use_is_badged', () => {
    const node = tab()
    expect(cards(node)[0]!.querySelector('.badge')?.textContent).toBe('in use')
    expect(cards(node)[1]!.querySelector('.badge')).toBeNull()
    node.remove()
  })

  it('saving_a_card_dispatches_the_edited_profile_at_its_index', () => {
    const node = tab()
    const form = edit(node, 0)
    let seen: unknown
    node.addEventListener(events.ProfileSavedEvent.type, (e) => (seen = [e.index, e.profile]))
    set(form, 'default-model', 'claude-opus-5')
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(seen).toEqual([0, { name: 'Balanced', default: { provider: 'Claude', model: 'claude-opus-5' } }])
    node.remove()
  })

  it('checking_a_step_override_saves_it_alongside_the_default', () => {
    const node = tab()
    const form = edit(node, 0)
    const box = form.querySelector<HTMLInputElement>('.choice-row:nth-of-type(3) input[type=checkbox]')!
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    let seen: unknown
    node.addEventListener(events.ProfileSavedEvent.type, (e) => (seen = e.profile))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect((seen as Profile).steps).toBeDefined()
    node.remove()
  })

  it('add_profile_opens_a_form_past_the_end_and_cancel_closes_it', () => {
    const node = tab()
    ;[...node.querySelectorAll('button')].find((b) => b.textContent === 'Add profile')!.click()
    const form = node.querySelector<HTMLFormElement>('form.profile')!
    expect(cards(node)).toHaveLength(3)
    let seen: number | undefined
    node.addEventListener(events.ProfileSavedEvent.type, (e) => (seen = e.index))
    set(form, 'name', 'Throughput')
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(seen).toBe(2)
    // The form stays until the host answers: a refused save leaves what was typed in place.
    expect(node.querySelector('form.profile')).not.toBeNull()
    node.update(snapshot({ profiles: [balanced, opusPlan, { name: 'Throughput', default: { provider: 'Claude', model: 'claude-sonnet-5' } }] }))
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

  it('no_provider_configured_yet_hides_add_profile', () => {
    const node = tab(snapshot({ providers: [] }))
    expect([...node.querySelectorAll('button')].some((b) => b.textContent === 'Add profile')).toBe(false)
    node.remove()
  })
})
