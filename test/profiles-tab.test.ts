// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Profile, Provider } from '../src/agent/session/model-profile'
import type { SettingsSnapshot } from '../src/settings/protocol'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

// Test files share a worker, so the module registry is cleared first: what
// loads here is this file's own, bound to its stub and its document.
vi.resetModules()

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
    permissions: { allow: [], deny: [], denyGitWrites: false },
    verify: [],
    verifyFailureBudget: 3,
    cleanup: { functionLines: 60, functionComplexity: 15, typeLines: 200, fileLines: 400, tests: [], testFunctionLines: 120, testFunctionComplexity: 15, testTypeLines: 600, testFileLines: 1200, ignore: [] },
    planIgnore: [],
    cutCoveredDocs: false,
    memories: { project: [], user: [] },
    bundles: { available: [], applied: [], suggested: [], offerPending: false },
    nodePath: '',
    traceEngine: false,
    compactAtTokens: 400_000,
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
    expect(cards(node)[1]!.querySelector('.chips')!.textContent).toContain('Feature planning · Spec: Claude · claude-opus-5 (high)')
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
    const box = form.querySelector<HTMLInputElement>('input[name=step-plan-override]')!
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    let seen: unknown
    node.addEventListener(events.ProfileSavedEvent.type, (e) => (seen = e.profile))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect((seen as Profile).steps).toBeDefined()
    node.remove()
  })

  it('steps_are_grouped_in_a_tab_per_mode_and_only_the_selected_one_shows', () => {
    const node = tab()
    const form = edit(node, 0)
    const tabs = [...form.querySelectorAll<HTMLButtonElement>('.subtabs .tab')]
    expect(tabs.map((t) => t.textContent)).toEqual(['Chat', 'Plan', 'Feature planning', 'Maintenance'])
    const shown = () => [...form.querySelectorAll<HTMLElement>('.step-pane')].filter((p) => !p.hidden)
    expect(shown()).toHaveLength(1)
    tabs[1]!.click()
    expect(shown()).toHaveLength(1)
    expect([...shown()[0]!.querySelectorAll('.choice-row .label')].map((l) => l.textContent)).toEqual(['Planning', 'Build'])
    node.remove()
  })

  it('a_step_edited_in_a_hidden_tab_still_saves', () => {
    const node = tab()
    const form = edit(node, 0)
    ;[...form.querySelectorAll<HTMLButtonElement>('.subtabs .tab')].find((t) => t.textContent === 'Plan')!.click()
    set(form, 'step-code-build-effort', 'low')
    ;[...form.querySelectorAll<HTMLButtonElement>('.subtabs .tab')].find((t) => t.textContent === 'Chat')!.click()
    let seen: unknown
    node.addEventListener(events.ProfileSavedEvent.type, (e) => (seen = e.profile))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect((seen as Profile).steps).toEqual({ 'code-build': { effort: 'low' } })
    node.remove()
  })

  it('the_selected_tab_survives_a_redraw', () => {
    const node = tab()
    const form = edit(node, 0)
    ;[...form.querySelectorAll<HTMLButtonElement>('.subtabs .tab')].find((t) => t.textContent === 'Maintenance')!.click()
    node.update(snapshot({ activeProfile: 'Opus plan' }))
    const active = node.querySelector<HTMLButtonElement>('form.profile .subtabs .tab.active')
    expect(active?.textContent).toBe('Maintenance')
    node.remove()
  })

  it('a_step_s_effort_saves_on_its_own_without_overriding_the_model', () => {
    const node = tab()
    const form = edit(node, 0)
    set(form, 'step-implement-effort', 'low')
    let seen: unknown
    node.addEventListener(events.ProfileSavedEvent.type, (e) => (seen = e.profile))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect((seen as Profile).steps).toEqual({ implement: { effort: 'low' } })
    expect(cards(tab(snapshot({ profiles: [seen as Profile] })))[0]!.querySelector('.chips')!.textContent).toContain('Implement: low effort')
    node.remove()
  })

  it('a_step_s_blank_effort_names_the_one_suggested_for_it', () => {
    const form = edit(tab(), 0)
    const blank = (step: string) => form.querySelector<HTMLSelectElement>(`select[name=step-${step}-effort]`)!.options[0]!.textContent
    expect(blank('plan')).toBe('Suggested (high)')
    expect(blank('implement')).toBe('Suggested (medium)')
    expect(blank('chat')).toBe('Same as default')
  })

  it('the_effort_picker_is_off_for_a_model_that_takes_no_effort_and_follows_the_default_it_inherits', () => {
    const form = edit(tab(), 0)
    const effort = (name: string) => form.querySelector<HTMLSelectElement>(`select[name=${name}]`)!
    expect(effort('step-plan-effort').disabled).toBe(false)
    set(form, 'default-provider', 'berget')
    expect(effort('default-effort').disabled).toBe(true)
    expect(effort('step-plan-effort').disabled).toBe(true)
  })

  it('levels_the_model_does_not_take_cannot_be_picked', () => {
    const declared: Provider = { ...berget, reasoningControl: 'reasoning_effort' }
    const form = edit(tab(snapshot({ providers: [claude, declared] })), 0)
    set(form, 'default-provider', 'berget')
    const options = [...form.querySelector<HTMLSelectElement>('select[name=default-effort]')!.options]
    expect(options.filter((o) => !o.disabled).map((o) => o.value)).toEqual(['', 'low', 'medium', 'high'])
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
