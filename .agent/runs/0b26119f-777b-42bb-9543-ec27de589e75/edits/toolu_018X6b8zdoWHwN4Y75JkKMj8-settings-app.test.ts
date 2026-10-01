// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { SettingsSnapshot } from '../src/settings/protocol'

const posted: unknown[] = []
// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => posted.push(m) })

const { SettingsApp } = await import('../src/settings/webview/settings-app')
const { PermissionsTab } = await import('../src/settings/webview/permissions-tab')
const { ProjectTab } = await import('../src/settings/webview/project-tab')
const { AdvancedTab } = await import('../src/settings/webview/advanced-tab')
const { MemoriesTab } = await import('../src/settings/webview/memories-tab')
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
    cleanup: { functionLines: 25, typeLines: 200, fileLines: 400, tests: ['**/*.test.*'], testFunctionLines: 60, testTypeLines: 600, testFileLines: 1200, ignore: [] },
    planIgnore: [],
    cutCoveredDocs: false,
    memories: { project: [], user: [] },
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
})
