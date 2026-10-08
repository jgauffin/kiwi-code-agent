// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { SettingsSnapshot } from '../src/settings/protocol'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

// Test files share a worker, so the module registry is cleared first: what
// loads here is this file's own, bound to its stub and its document.
vi.resetModules()

const { ModelsSection } = await import('../src/settings/webview/models-section')

function snapshot(): SettingsSnapshot {
  return {
    providers: [{ name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5-5'] }],
    profiles: [{ name: 'Claude', default: { provider: 'Claude', model: 'claude-opus-5-5' } }],
    activeProfile: 'Claude',
    keys: [],
    permissions: { allow: [], deny: [], denyGitWrites: false, person: { allow: [], deny: [] } },
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
    remoteControl: { enabled: false, serviceUrl: 'wss://remote.kiwipow.com', pushByDefault: true, phones: [] },
  }
}

function section(state: SettingsSnapshot = snapshot()) {
  const node = new ModelsSection()
  document.body.appendChild(node)
  node.update(state)
  return node
}

const offer = (node: HTMLElement) => node.querySelector<HTMLElement>(".model-offer")!

describe('ModelsSection', () => {
  it('opens_on_providers_and_switches_to_profiles_on_the_subtab_strip', () => {
    const node = section()
    expect(node.querySelector<HTMLElement>('.subpane.providers')!.hidden).toBe(false)
    expect(node.querySelector<HTMLElement>('.subpane.profiles')!.hidden).toBe(true)
    ;[...node.querySelectorAll<HTMLButtonElement>('.subtabs .tab')].find((t) => t.textContent === 'Profiles')!.click()
    expect(node.querySelector<HTMLElement>('.subpane.providers')!.hidden).toBe(true)
    expect(node.querySelector<HTMLElement>('.subpane.profiles')!.hidden).toBe(false)
    node.remove()
  })

  it('both_subpanes_hold_the_same_settings_regardless_of_which_is_shown', () => {
    const node = section()
    expect(node.querySelector('.subpane.profiles select[name=activeProfile]')).not.toBeNull()
    expect(node.querySelector('.subpane.providers article.provider')).not.toBeNull()
    node.remove()
  })

  it('no_newer_models_on_offer_shows_no_banner', () => {
    const node = section()
    expect(offer(node).hidden).toBe(true)
    node.remove()
  })

  it('the_offer_names_each_model_moving_and_the_provider_it_would_add', () => {
    const node = section({
      ...snapshot(),
      modelUpgrade: { provider: 'Claude (installed)', providerIsNew: true, moves: [{ from: 'claude-opus-5[1m]', to: 'claude-opus-5-5[1m]' }] },
    })
    expect(offer(node).hidden).toBe(false)
    expect(offer(node).textContent).toContain('claude-opus-5[1m] → claude-opus-5-5[1m]')
    expect(offer(node).textContent).toContain('Claude (installed)')
    node.remove()
  })

  it('taking_the_offer_and_turning_it_down_are_each_one_event', () => {
    const node = section({
      ...snapshot(),
      modelUpgrade: { provider: 'Claude (installed)', providerIsNew: true, moves: [{ from: 'claude-opus-5', to: 'claude-opus-5-5' }] },
    })
    const seen: string[] = []
    node.addEventListener('model-upgrade-taken', () => seen.push('taken'))
    node.addEventListener('model-upgrade-dismissed', () => seen.push('dismissed'))
    ;[...offer(node).querySelectorAll('button')].find((b) => b.textContent === 'Use them')!.click()
    ;[...offer(node).querySelectorAll('button')].find((b) => b.textContent === 'No thanks')!.click()
    expect(seen).toEqual(['taken', 'dismissed'])
    node.remove()
  })

  it('an_offer_taken_leaves_the_banner_gone_on_the_next_snapshot', () => {
    const node = section({
      ...snapshot(),
      modelUpgrade: { provider: 'Claude (installed)', providerIsNew: true, moves: [{ from: 'claude-opus-5', to: 'claude-opus-5-5' }] },
    })
    node.update(snapshot())
    expect(offer(node).hidden).toBe(true)
    node.remove()
  })

  it('a_model_the_endpoint_reports_reaches_the_providers_subpane', () => {
    const node = section()
    ;[...node.querySelectorAll('button')].find((b) => b.textContent === 'Edit')!.click()
    node.discoveredModels('Claude', ['claude-opus-5-5', 'claude-haiku-4-5'])
    const offer = [...node.querySelectorAll<HTMLButtonElement>('.offers button')].find((b) => b.textContent === 'claude-haiku-4-5')
    expect(offer).not.toBeUndefined()
    node.remove()
  })
})
