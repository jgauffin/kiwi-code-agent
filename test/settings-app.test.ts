// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Bundle } from '../src/agent/instructions/bundles'
import type { SettingsSnapshot } from '../src/settings/protocol'

const posted: unknown[] = []
// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => posted.push(m) })

// Test files share a worker, so the module registry is cleared first: what
// loads here is this file's own, bound to its stub and its document.
vi.resetModules()

const { SettingsApp } = await import('../src/settings/webview/settings-app')
const { PermissionsTab } = await import('../src/settings/webview/permissions-tab')
const { ProjectTab } = await import('../src/settings/webview/project-tab')
const { AdvancedTab } = await import('../src/settings/webview/advanced-tab')
const { MemoriesTab } = await import('../src/settings/webview/memories-tab')
const { BundlesTab } = await import('../src/settings/webview/bundles-tab')
const events = await import('../src/settings/webview/events')

export function snapshot(over: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    providers: [{ name: 'Claude', engine: 'claude-sdk', models: ['claude-opus-5'] }],
    profiles: [{ name: 'Claude', default: { provider: 'Claude', model: 'claude-opus-5' } }],
    activeProfile: 'Claude',
    keys: [],
    permissions: { allow: ['Edit'], deny: [], denyGitWrites: false },
    verify: [{ match: 'src/**/*.ts', project: 'package.json', command: 'npm test' }],
    verifyFailureBudget: 3,
    cleanup: {
      functionLines: 60,
      functionComplexity: 15,
      typeLines: 200,
      fileLines: 400,
      tests: ['**/*.test.*'],
      testFunctionLines: 120,
      testFunctionComplexity: 15,
      testTypeLines: 600,
      testFileLines: 1200,
      ignore: [],
    },
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

function saved(node: HTMLElement, act: () => void): { key: string; value: unknown } | undefined {
  let seen: { key: string; value: unknown } | undefined
  node.addEventListener(events.SettingSavedEvent.type, (e) => (seen = { key: e.key, value: e.value }))
  act()
  return seen
}

const change = (input: HTMLInputElement | HTMLSelectElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('SettingsApp', () => {
  it('shows_one_tab_at_a_time_and_switches_on_the_strip', () => {
    const app = new SettingsApp()
    document.body.appendChild(app)
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'settings', snapshot: snapshot() } }))
    const visible = () => [...app.querySelectorAll<HTMLElement>('.pane')].filter((p) => !p.hidden).map((p) => p.className)
    expect(visible()).toEqual(['pane models'])
    const tab = (label: string) => [...app.querySelectorAll<HTMLButtonElement>('.tabs .tab')].find((t) => t.textContent === label)!
    tab('Project').click()
    expect(visible()).toEqual(['pane project'])
    expect(tab('Project').classList.contains('active')).toBe(true)
    expect(tab('Models').classList.contains('active')).toBe(false)
    app.remove()
  })

  it('a_saved_setting_is_posted_to_the_host_with_its_key', () => {
    posted.length = 0
    const app = new SettingsApp()
    document.body.appendChild(app)
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'settings', snapshot: snapshot() } }))
    const trace = app.querySelector<HTMLInputElement>('.advanced input[name=traceEngine]')!
    trace.checked = true
    trace.dispatchEvent(new Event('change', { bubbles: true }))
    expect(posted).toContainEqual({ type: 'save', key: 'traceEngine', value: true })
    app.remove()
  })
})

describe('AdvancedTab', () => {
  it('node_path_saves_trimmed_on_change', () => {
    const tab = new AdvancedTab()
    tab.update(snapshot())
    const input = tab.querySelector<HTMLInputElement>('input[name=nodePath]')!
    expect(saved(tab, () => change(input, ' C:/node/node.exe '))).toEqual({ key: 'nodePath', value: 'C:/node/node.exe' })
  })

  it('the_compaction_ceiling_saves_as_a_token_count', () => {
    const tab = new AdvancedTab()
    tab.update(snapshot())
    const input = tab.querySelector<HTMLInputElement>('input[name=compactAtTokens]')!
    expect(input.value).toBe('400000')
    expect(saved(tab, () => change(input, '150000'))).toEqual({ key: 'compactAtTokens', value: 150_000 })
  })

  it('a_blank_or_negative_ceiling_is_not_saved_and_the_field_goes_back', () => {
    const tab = new AdvancedTab()
    tab.update(snapshot())
    const input = tab.querySelector<HTMLInputElement>('input[name=compactAtTokens]')!
    expect(saved(tab, () => change(input, '-5'))).toBeUndefined()
    expect(input.value).toBe('400000')
  })
})

describe('PermissionsTab', () => {
  it('editing_a_rule_saves_the_whole_allow_list', () => {
    const tab = new PermissionsTab()
    tab.update(snapshot())
    const input = tab.querySelector<HTMLInputElement>('rule-list input')!
    expect(saved(tab, () => change(input, 'Edit(src/**)'))).toEqual({ key: 'permissions.allow', value: ['Edit(src/**)'] })
  })

  it('removing_a_rule_saves_the_list_without_it', () => {
    const tab = new PermissionsTab()
    tab.update(snapshot({ permissions: { allow: ['Edit', 'Bash(npm test)'], deny: [], denyGitWrites: false } }))
    const remove = tab.querySelector<HTMLButtonElement>('rule-list .remove')!
    expect(saved(tab, () => remove.click())).toEqual({ key: 'permissions.allow', value: ['Bash(npm test)'] })
  })

  it('an_added_row_is_not_a_rule_until_it_has_text', () => {
    const tab = new PermissionsTab()
    tab.update(snapshot({ permissions: { allow: [], deny: [], denyGitWrites: false } }))
    const list = tab.querySelector<HTMLElement>('rule-list')!
    list.querySelector<HTMLButtonElement>('.add')!.click()
    const input = list.querySelector<HTMLInputElement>('input')!
    expect(saved(tab, () => change(input, ''))).toEqual({ key: 'permissions.allow', value: [] })
    expect(saved(tab, () => change(input, 'Bash'))).toEqual({ key: 'permissions.allow', value: ['Bash'] })
  })

  it('the_git_writes_switch_saves_on_its_own_key', () => {
    const tab = new PermissionsTab()
    tab.update(snapshot())
    const box = tab.querySelector<HTMLInputElement>('input[name="permissions.denyGitWrites"]')!
    expect(box.checked).toBe(false)
    box.checked = true
    expect(saved(tab, () => box.dispatchEvent(new Event('change', { bubbles: true })))).toEqual({ key: 'permissions.denyGitWrites', value: true })
  })

  it('fields_are_disabled_without_a_folder_open', () => {
    const tab = new PermissionsTab()
    tab.update(snapshot({ hasWorkspace: false }))
    expect(tab.textContent).toContain('Open a folder')
    expect([...tab.querySelectorAll<HTMLInputElement>('input, button.add')].every((i) => i.disabled)).toBe(true)
  })
})

describe('ProjectTab', () => {
  it('a_changed_verify_row_saves_the_rules_dropping_incomplete_ones', () => {
    const tab = new ProjectTab()
    tab.update(snapshot())
    tab.querySelector<HTMLButtonElement>('verify-rules .add')!.click()
    const rows = tab.querySelectorAll<HTMLElement>('verify-rules .row:not(.head)')
    expect(rows).toHaveLength(2)
    const command = rows[0]!.querySelector<HTMLInputElement>('input[name=command]')!
    expect(saved(tab, () => change(command, 'npm run test:unit'))).toEqual({
      key: 'verify',
      value: [{ match: 'src/**/*.ts', project: 'package.json', command: 'npm run test:unit' }],
    })
  })

  it('a_threshold_saves_as_a_number_and_a_blank_goes_back_to_what_holds', () => {
    const tab = new ProjectTab()
    tab.update(snapshot())
    const input = tab.querySelector<HTMLInputElement>('input[name="cleanup.fileLines"]')!
    expect(saved(tab, () => change(input, '300'))).toEqual({ key: 'cleanup.fileLines', value: 300 })
    expect(saved(tab, () => change(input, ''))).toBeUndefined()
    expect(input.value).toBe('400')
  })

  it('plan_ignore_globs_save_under_their_key', () => {
    const tab = new ProjectTab()
    tab.update(snapshot({ planIgnore: ['docs/intent/old/**'] }))
    const input = tab.querySelector<HTMLInputElement>('.planning rule-list input')!
    expect(saved(tab, () => change(input, 'docs/intent/drafts/**'))).toEqual({ key: 'planIgnore', value: ['docs/intent/drafts/**'] })
  })

  it('cutting_covered_docs_is_a_planning_choice_saved_under_its_key', () => {
    const tab = new ProjectTab()
    tab.update(snapshot())
    const box = tab.querySelector<HTMLInputElement>('.planning input[name="cutCoveredDocs"]')!
    expect(box.checked).toBe(false)
    box.checked = true
    expect(saved(tab, () => box.dispatchEvent(new Event('change', { bubbles: true })))).toEqual({ key: 'cutCoveredDocs', value: true })
  })

  it('test_file_globs_and_test_limits_save_under_their_own_keys', () => {
    const tab = new ProjectTab()
    tab.update(snapshot())
    const glob = tab.querySelector<HTMLInputElement>('.cleanup rule-list input')!
    expect(saved(tab, () => change(glob, '**/*.spec.*'))).toEqual({ key: 'cleanup.tests', value: ['**/*.spec.*'] })
    const lines = tab.querySelector<HTMLInputElement>('input[name="cleanup.testFileLines"]')!
    expect(saved(tab, () => change(lines, '900'))).toEqual({ key: 'cleanup.testFileLines', value: 900 })
  })

  it('the_complexity_limits_show_what_holds_and_save_under_their_own_keys', () => {
    const tab = new ProjectTab()
    tab.update(snapshot())
    const source = tab.querySelector<HTMLInputElement>('input[name="cleanup.functionComplexity"]')!
    expect(source.value).toBe('15')
    expect(saved(tab, () => change(source, '10'))).toEqual({ key: 'cleanup.functionComplexity', value: 10 })
    const tests = tab.querySelector<HTMLInputElement>('input[name="cleanup.testFunctionComplexity"]')!
    expect(saved(tab, () => change(tests, '20'))).toEqual({ key: 'cleanup.testFunctionComplexity', value: 20 })
  })
})

describe('MemoriesTab', () => {
  it('memories_can_be_listed_each_with_its_own_scope', () => {
    const tab = new MemoriesTab()
    tab.update(
      snapshot({
        memories: {
          project: [{ title: 'Blue means clickable', file: 'blue.md', summary: 'Non-interactive UI never uses button/badge/focus blue.' }],
          user: [{ title: 'Likes short replies', file: 'CLAUDE.md', summary: 'say less, not more.' }],
        },
      }),
    )
    const titles = (scope: string) => [...tab.querySelectorAll<HTMLElement>(`.${scope} .memory .title`)].map((n) => n.textContent)
    expect(titles('project')).toEqual(['Blue means clickable'])
    expect(titles('user')).toEqual(['Likes short replies'])
  })

  it('a_scope_with_nothing_remembered_says_so_instead_of_an_empty_list', () => {
    const tab = new MemoriesTab()
    tab.update(snapshot())
    expect(tab.textContent).toContain('Nothing remembered for this project yet.')
    expect(tab.textContent).toContain('Nothing remembered about you yet.')
  })

  it('opening_a_memory_posts_its_scope_and_file_to_the_host', () => {
    posted.length = 0
    const app = new SettingsApp()
    document.body.appendChild(app)
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'settings', snapshot: snapshot({ memories: { project: [{ title: 'Blue means clickable', file: 'blue.md', summary: 'say so' }], user: [] } }) },
      }),
    )
    const tab = (label: string) => [...app.querySelectorAll<HTMLButtonElement>('.tabs .tab')].find((t) => t.textContent === label)!
    tab('Memories').click()
    app.querySelector<HTMLButtonElement>('.project .memory button')!.click()
    expect(posted).toContainEqual({ type: 'open_memory', scope: 'project', file: 'blue.md' })
    app.remove()
  })

  it('forgetting_a_memory_posts_its_scope_and_title_to_the_host', () => {
    posted.length = 0
    const app = new SettingsApp()
    document.body.appendChild(app)
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'settings', snapshot: snapshot({ memories: { project: [], user: [{ title: 'Likes short replies', file: 'CLAUDE.md', summary: 'say less' }] } }) },
      }),
    )
    const tab = (label: string) => [...app.querySelectorAll<HTMLButtonElement>('.tabs .tab')].find((t) => t.textContent === label)!
    tab('Memories').click()
    app.querySelector<HTMLButtonElement>('.user .memory .remove')!.click()
    expect(posted).toContainEqual({ type: 'forget_memory', scope: 'user', title: 'Likes short replies' })
    app.remove()
  })
})

const pythonStyle: Bundle = { source: 'product', name: 'python-style', version: '1.0.0', target: { kind: 'any' }, text: 'Reproduce a bug before fixing it.' }

describe('BundlesTab', () => {
  it('available_and_applied_bundles_can_be_seen_and_managed_without_an_offer_pending', () => {
    const tab = new BundlesTab()
    tab.update(
      snapshot({
        bundles: {
          available: [pythonStyle],
          applied: [{ source: 'product', name: 'python-style', version: '1.0.0', scope: 'project' }],
          suggested: [],
          offerPending: false,
        },
      }),
    )
    expect(tab.querySelector('.bundle-offer')).toBeNull()
    expect(tab.querySelector('.applied .title')!.textContent).toBe('python-style')
    expect(tab.querySelector('.available .title')!.textContent).toBe('python-style')
  })

  it('nothing_applied_or_available_yet_says_so_instead_of_an_empty_list', () => {
    const tab = new BundlesTab()
    tab.update(snapshot({ bundles: { available: [], applied: [], suggested: [], offerPending: false } }))
    expect(tab.textContent).toContain('Nothing applied yet.')
    expect(tab.textContent).toContain('No bundles in the catalog yet.')
  })

  it('a_bundles_rule_text_is_hidden_until_shown_and_only_then_readable_before_it_is_applied', () => {
    const tab = new BundlesTab()
    tab.update(snapshot({ bundles: { available: [pythonStyle], applied: [], suggested: [], offerPending: false } }))
    expect(tab.textContent).not.toContain(pythonStyle.text)
    tab.querySelector<HTMLButtonElement>('.available button')!.click()
    expect(tab.textContent).toContain(pythonStyle.text)
  })

  it('the_offer_banner_names_what_matches_this_workspace_and_is_gone_once_nothing_is_pending', () => {
    const tab = new BundlesTab()
    tab.update(snapshot({ bundles: { available: [pythonStyle], applied: [], suggested: [pythonStyle], offerPending: true } }))
    expect(tab.querySelector('.bundle-offer')!.textContent).toContain('python-style')
    tab.update(snapshot({ bundles: { available: [pythonStyle], applied: [], suggested: [], offerPending: false } }))
    expect(tab.querySelector('.bundle-offer')).toBeNull()
  })

  it('dismissing_the_offer_posts_to_the_host_without_applying_anything', () => {
    posted.length = 0
    const app = new SettingsApp()
    document.body.appendChild(app)
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'settings', snapshot: snapshot({ bundles: { available: [pythonStyle], applied: [], suggested: [pythonStyle], offerPending: true } }) } }),
    )
    const tab = (label: string) => [...app.querySelectorAll<HTMLButtonElement>('.tabs .tab')].find((t) => t.textContent === label)!
    tab('Bundles').click()
    app.querySelector<HTMLButtonElement>('.bundle-offer button')!.click()
    expect(posted).toContainEqual({ type: 'dismiss_bundle_offer' })
    app.remove()
  })

  it('applying_a_bundle_posts_its_chosen_scope_with_the_whole_bundle_to_the_host', () => {
    posted.length = 0
    const app = new SettingsApp()
    document.body.appendChild(app)
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'settings', snapshot: snapshot({ bundles: { available: [pythonStyle], applied: [], suggested: [], offerPending: false } }) } }),
    )
    const tab = (label: string) => [...app.querySelectorAll<HTMLButtonElement>('.tabs .tab')].find((t) => t.textContent === label)!
    tab('Bundles').click()
    const scope = app.querySelector<HTMLSelectElement>('.available select[name=scope]')!
    change(scope, 'user')
    app.querySelector<HTMLButtonElement>('.available .controls button:last-child')!.click()
    expect(posted).toContainEqual({ type: 'apply_bundle', scope: 'user', bundle: pythonStyle })
    app.remove()
  })

  it('removing_a_bundle_posts_its_scope_source_and_name_to_the_host', () => {
    posted.length = 0
    const app = new SettingsApp()
    document.body.appendChild(app)
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'settings',
          snapshot: snapshot({ bundles: { available: [], applied: [{ source: 'product', name: 'python-style', version: '1.0.0', scope: 'project' }], suggested: [], offerPending: false } }),
        },
      }),
    )
    const tab = (label: string) => [...app.querySelectorAll<HTMLButtonElement>('.tabs .tab')].find((t) => t.textContent === label)!
    tab('Bundles').click()
    app.querySelector<HTMLButtonElement>('.applied .remove')!.click()
    expect(posted).toContainEqual({ type: 'remove_bundle', scope: 'project', source: 'product', name: 'python-style' })
    app.remove()
  })
})
