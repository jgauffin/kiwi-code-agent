// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { SettingsSnapshot } from '../src/settings/protocol'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { ModelsSection } = await import('../src/settings/webview/models-section')

function snapshot(): SettingsSnapshot {
  return {
    providers: [{ name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5'] }],
    profiles: [{ name: 'Claude', default: { provider: 'Claude', model: 'claude-opus-5' } }],
    activeProfile: 'Claude',
    keys: [],
    permissions: { allow: [], deny: [], denyGitWrites: false },
    verify: [],
    verifyFailureBudget: 3,
    cleanup: { functionLines: 25, typeLines: 200, fileLines: 400, tests: [], testFunctionLines: 60, testTypeLines: 600, testFileLines: 1200, ignore: [] },
    planIgnore: [],
    nodePath: '',
    traceEngine: false,
    compactAtTokens: 400_000,
    hasWorkspace: true,
  }
}

function section() {
  const node = new ModelsSection()
  document.body.appendChild(node)
  node.update(snapshot())
  return node
}

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

  it('a_model_the_endpoint_reports_reaches_the_providers_subpane', () => {
    const node = section()
    ;[...node.querySelectorAll('button')].find((b) => b.textContent === 'Edit')!.click()
    node.discoveredModels('Claude', ['claude-opus-5', 'claude-haiku-4-5'])
    const offer = [...node.querySelectorAll<HTMLButtonElement>('.offers button')].find((b) => b.textContent === 'claude-haiku-4-5')
    expect(offer).not.toBeUndefined()
    node.remove()
  })
})
