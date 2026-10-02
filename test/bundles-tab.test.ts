// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Bundle } from '../src/agent/instructions/bundles'
import type { SettingsSnapshot } from '../src/settings/protocol'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { BundlesTab } = await import('../src/settings/webview/bundles-tab')

function snapshot(bundles: SettingsSnapshot['bundles']): SettingsSnapshot {
  return {
    providers: [],
    profiles: [],
    activeProfile: '',
    keys: [],
    permissions: { allow: [], deny: [], denyGitWrites: false },
    verify: [],
    verifyFailureBudget: 3,
    cleanup: { functionLines: 60, functionComplexity: 15, typeLines: 200, fileLines: 400, tests: [], testFunctionLines: 120, testFunctionComplexity: 15, testTypeLines: 600, testFileLines: 1200, ignore: [] },
    planIgnore: [],
    cutCoveredDocs: false,
    memories: { project: [], user: [] },
    bundles,
    nodePath: '',
    traceEngine: false,
    compactAtTokens: 400_000,
    hasWorkspace: true,
  }
}

function tab(bundles: SettingsSnapshot['bundles']) {
  const node = new BundlesTab()
  document.body.appendChild(node)
  node.update(snapshot(bundles))
  return node
}

const skillBundle: Bundle = {
  source: 'company',
  name: 'bug-repro',
  version: '1.0.0',
  target: { kind: 'any' },
  text: '',
  skills: [{ name: 'bug-repro', description: 'Reproduce a bug with a failing test before fixing it.', files: [] }],
}

describe('skills seen before they are applied', () => {
  it('the_name_and_description_of_every_skill_a_bundle_would_add_are_shown_before_it_is_applied', () => {
    const node = tab({ available: [skillBundle], applied: [], suggested: [], offerPending: false })
    const show = [...node.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Show'))!
    show.click()
    const list = node.querySelector('.bundle-skills')!
    expect(list.textContent).toContain('bug-repro')
    expect(list.textContent).toContain('Reproduce a bug with a failing test before fixing it.')
    node.remove()
  })

  it('nothing_is_written_until_the_person_presses_apply', () => {
    const node = tab({ available: [skillBundle], applied: [], suggested: [], offerPending: false })
    let applied = false
    node.addEventListener('bundle-applied', () => (applied = true))
    const show = [...node.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Show'))!
    show.click()
    expect(applied).toBe(false)
    node.remove()
  })

  it('a_bundles_rule_text_is_shown_beside_the_skills_it_would_add', () => {
    const both: Bundle = { ...skillBundle, text: 'Write the failing test first.' }
    const node = tab({ available: [both], applied: [], suggested: [], offerPending: false })
    const show = [...node.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Show'))!
    show.click()
    expect(node.querySelector('.bundle-text')!.textContent).toBe('Write the failing test first.')
    expect(node.querySelector('.bundle-skills')!.textContent).toContain('bug-repro')
    node.remove()
  })
})
