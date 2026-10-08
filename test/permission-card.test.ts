// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '../src/agent/session/code-session'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

// Test files share a worker, so the module registry is cleared first: what
// loads here is this file's own, bound to its stub and its document.
vi.resetModules()

const { PermissionCard } = await import('../src/chat/webview/permission-card')
const { ChatTranscript } = await import('../src/chat/webview/chat-transcript')
const { PermissionDecidedEvent } = await import('../src/chat/webview/events')

type Request = Extract<SessionEvent, { type: 'permission_request' }>
type Card = InstanceType<typeof PermissionCard>
type Decided = InstanceType<typeof PermissionDecidedEvent>

function shellRequest(): Request {
  return {
    type: 'permission_request',
    requestId: 'r1',
    toolName: 'Bash',
    title: 'Bash',
    input: { command: 'npm run build && npx vitest run && ls -la', description: 'Build and run the unit tests' },
    commands: [
      { text: 'npm run build', rule: 'Bash(npm run:*)' },
      { text: 'npx vitest run', rule: 'Bash(npx vitest:*)' },
      { text: 'ls -la', passes: 'read-only' },
    ],
  }
}

function card(request: Request): { card: Card; decisions: Decided[] } {
  const element = new PermissionCard()
  document.body.appendChild(element)
  const decisions: Decided[] = []
  element.addEventListener(PermissionDecidedEvent.type, (e) => decisions.push(e as Decided))
  element.show(request)
  return { card: element, decisions }
}

const rows = (c: Card) => [...c.querySelectorAll('li.command')]
const rowText = (row: Element) => row.querySelector('code')?.textContent
const buttons = (row: Element) => [...row.querySelectorAll('button')].map((b) => b.textContent)
const status = (row: Element) => row.querySelector('.line-status')?.textContent
const click = (row: Element, label: string) => {
  const button = [...row.querySelectorAll('button')].find((b) => b.textContent === label)
  if (!button) throw new Error(`No button "${label}" on "${rowText(row)}"`)
  button.click()
}

describe('a shell call on the permission card', () => {
  it('is_titled_by_its_description_and_lists_one_command_per_line_with_no_raw_arguments', () => {
    const { card: c } = card(shellRequest())

    expect(c.querySelector('strong')?.textContent).toBe('Build and run the unit tests')
    expect(c.textContent).not.toContain('Bash')
    expect(c.querySelector('pre.input')).toBeNull()
    expect(rows(c).map(rowText)).toEqual(['npm run build', 'npx vitest run', 'ls -la'])
  })

  it('a_command_that_needs_an_answer_offers_allow_session_project_and_deny_and_one_that_passes_says_why', () => {
    const { card: c } = card(shellRequest())
    const [build, test, list] = rows(c)

    expect(buttons(build!)).toEqual([
      'Allow', 'Allow npm run for session', 'Allow npm run for project', 'Deny', 'Deny npm run for session', 'Deny npm run for project',
    ])
    expect(buttons(test!)).toEqual([
      'Allow', 'Allow npx vitest for session', 'Allow npx vitest for project', 'Deny', 'Deny npx vitest for session', 'Deny npx vitest for project',
    ])
    expect(buttons(list!)).toEqual([])
    expect(status(list!)).toBe('read-only')
  })

  it('a_rule_naming_ground_outside_the_project_offers_for_me_in_place_of_for_project', () => {
    const request = shellRequest()
    request.commands = [{ text: 'cd D:/data', rule: 'Bash(cd D:/data)', scope: 'person' }]
    const { card: c, decisions } = card(request)

    expect(buttons(rows(c)[0]!)).toEqual([
      'Allow', 'Allow cd D:/data for session', 'Allow cd D:/data for me', 'Deny', 'Deny cd D:/data for session', 'Deny cd D:/data for me',
    ])
    click(rows(c)[0]!, 'Allow cd D:/data for me')
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow', remember: { session: [], project: [], person: ['Bash(cd D:/data)'] } }])
  })

  it('a_change_of_directory_keeps_its_answer_for_the_place_picked_from_its_path', () => {
    const request = shellRequest()
    const place = (directory: string) => ({ directory, rule: `Bash(cd ${directory})` })
    const places = [place('D:/data/crates/v8'), place('D:/data/crates'), place('D:/data')]
    request.commands = [{ text: 'cd D:/data/crates/v8', rule: places[0]!.rule, places, scope: 'person' }]
    const { card: c, decisions } = card(request)
    const parts = () => [...rows(c)[0]!.querySelectorAll('.places button')]

    // Shallowest first; the directory itself is what the answer is kept for until another part is picked.
    expect(parts().map((p) => p.textContent)).toEqual(['D:/data', '/crates', '/v8'])
    expect(parts().map((p) => p.classList.contains('covered'))).toEqual([true, true, true])
    click(rows(c)[0]!, '/crates')
    expect(parts().map((p) => p.classList.contains('covered'))).toEqual([true, true, false])
    click(rows(c)[0]!, 'Allow directory for me')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow', remember: { session: [], project: [], person: ['Bash(cd D:/data/crates)'] } }])
  })

  it('a_change_of_directory_is_denied_for_the_place_picked', () => {
    const request = shellRequest()
    const places = [{ directory: 'D:/data/x', rule: 'Bash(cd D:/data/x)' }, { directory: 'D:/data', rule: 'Bash(cd D:/data)' }]
    request.commands = [{ text: 'cd D:/data/x', rule: places[0]!.rule, places, scope: 'person' }]
    const { card: c, decisions } = card(request)

    click(rows(c)[0]!, 'D:/data')
    click(rows(c)[0]!, 'Deny directory for session')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'deny', denyRemember: { session: ['Bash(cd D:/data)'], project: [], person: [] } }])
  })

  it('the_plain_allow_beside_the_remembered_scopes_is_what_is_pre_selected', () => {
    const { card: c } = card(shellRequest())
    const [build] = rows(c)

    const allow = [...build!.querySelectorAll('button')].find((b) => b.textContent === 'Allow')!
    expect(allow.hasAttribute('autofocus')).toBe(true)
  })

  it('allowing_a_ruled_line_for_this_call_only_leaves_it_unremembered', () => {
    const { card: c, decisions } = card(shellRequest())

    click(rows(c)[0]!, 'Allow')
    click(rows(c)[1]!, 'Allow')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })

  it('a_line_that_reads_and_writes_names_each_place_and_marks_the_write_as_why_it_asks', () => {
    const request = shellRequest()
    request.commands = [
      {
        text: 'cp a.txt /tmp/b.txt',
        rule: 'Bash(cp:*)',
        effects: [
          { kind: 'reads', path: 'a.txt', asked: false },
          { kind: 'writes', path: '/tmp/b.txt', asked: true },
        ],
      },
    ]
    const { card: c } = card(request)

    const effects = [...rows(c)[0]!.querySelectorAll('.effects li')]
    expect(effects.map((e) => e.textContent)).toEqual(['reads a.txt', 'writes /tmp/b.txt'])
    expect(effects.map((e) => e.classList.contains('asked'))).toEqual([false, true])
  })

  it('the_call_is_allowed_once_every_command_is_and_the_answers_are_remembered_by_scope', () => {
    const { card: c, decisions } = card(shellRequest())

    click(rows(c)[0]!, 'Allow npm run for session')
    expect(decisions).toHaveLength(0)
    expect(status(rows(c)[0]!)).toBe('allowed for session: npm run')
    expect(buttons(rows(c)[1]!)).toHaveLength(6)

    click(rows(c)[1]!, 'Allow npx vitest for project')
    expect(decisions).toHaveLength(1)
    expect(decisions[0]!.requestId).toBe('r1')
    expect(decisions[0]!.decision).toEqual({ kind: 'allow', remember: { session: ['Bash(npm run:*)'], project: ['Bash(npx vitest:*)'], person: [] } })
  })

  it('a_denial_may_be_kept_the_same_three_ways_an_allow_may', () => {
    const { card: c, decisions } = card(shellRequest())

    click(rows(c)[0]!, 'Deny npm run for project')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'deny', denyRemember: { session: [], project: ['Bash(npm run:*)'], person: [] } }])
  })

  it('a_rule_naming_ground_outside_the_project_may_be_denied_for_me_in_place_of_for_project', () => {
    const request = shellRequest()
    request.commands = [{ text: 'cd D:/data', rule: 'Bash(cd D:/data)', scope: 'person' }]
    const { card: c, decisions } = card(request)

    click(rows(c)[0]!, 'Deny cd D:/data for me')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'deny', denyRemember: { session: [], project: [], person: ['Bash(cd D:/data)'] } }])
  })

  it('one_denied_command_denies_the_call_and_the_others_keep_what_they_were_answered', () => {
    const { card: c, decisions } = card(shellRequest())

    click(rows(c)[0]!, 'Allow npm run for project')
    click(rows(c)[1]!, 'Deny')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'deny', remember: { session: [], project: ['Bash(npm run:*)'], person: [] } }])
    c.resolve('deny')
    expect(status(rows(c)[0]!)).toBe('allowed for project: npm run')
    expect(status(rows(c)[1]!)).toBe('denied')
    expect(c.querySelectorAll('button')).toHaveLength(0)
    expect(c.querySelector('.decision')?.textContent).toBe('Denied')
  })

  it('one_rule_answers_every_command_it_covers', () => {
    const request = shellRequest()
    request.commands = [
      { text: 'npm run build', rule: 'Bash(npm run:*)' },
      { text: 'npm run lint', rule: 'Bash(npm run:*)' },
    ]
    const { card: c, decisions } = card(request)

    click(rows(c)[0]!, 'Allow npm run for session')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow', remember: { session: ['Bash(npm run:*)'], project: [], person: [] } }])
  })

  it('a_command_no_rule_can_stand_for_is_allowed_for_this_call_only', () => {
    const request = shellRequest()
    request.commands = [{ text: 'echo $(ls)' }]
    const { card: c, decisions } = card(request)

    expect(buttons(rows(c)[0]!)).toEqual(['Allow', 'Deny'])
    click(rows(c)[0]!, 'Allow')
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })

  it('a_call_the_engine_asks_about_though_every_command_passes_is_answered_as_a_whole_and_says_why', () => {
    const request = shellRequest()
    request.commands = [
      { text: 'cp a /tmp/b', passes: 'Bash(cp:*)' },
      { text: 'ls -la', passes: 'read-only' },
    ]
    request.reason = 'Writes outside the working directory'
    const { card: c, decisions } = card(request)

    expect(rows(c).flatMap(buttons)).toEqual([])
    expect(c.querySelector('.reason')?.textContent).toBe('Writes outside the working directory')
    const allow = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Allow')
    expect([...c.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Allow', 'Deny'])
    allow!.click()
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })

  it('an_allowed_call_leaves_only_the_complete_command_and_takes_no_more_input', () => {
    const { card: c, decisions } = card(shellRequest())

    c.resolve('allow')

    expect(c.isResolved).toBe(true)
    expect(c.classList.contains('allowed')).toBe(true)
    expect(c.querySelector('pre.command')?.textContent).toBe('npm run build && npx vitest run && ls -la')
    expect(rows(c)).toHaveLength(0)
    expect(c.querySelectorAll('button')).toHaveLength(0)
    expect(c.querySelector('.decision')).toBeNull()
    expect(decisions).toHaveLength(0)
  })
})

describe('a call that is not a shell command', () => {
  const mcpRequest = (): Request => ({ type: 'permission_request', requestId: 'm1', toolName: 'mcp__docs__search', input: { query: 'x' } })
  const labels = (c: Card) => [...c.querySelectorAll('button')].map((b) => b.textContent)
  const press = (c: Card, label: string) => [...c.querySelectorAll('button')].find((b) => b.textContent === label)!.click()

  it('is_allowed_for_the_tool_whatever_its_arguments_for_the_session_or_the_project', () => {
    const { card: c } = card(mcpRequest())

    expect(labels(c)).toEqual(['Allow', 'Allow mcp__docs__search for session', 'Allow mcp__docs__search for project', 'Deny'])
  })

  it('a_call_naming_neither_a_file_nor_a_command_is_led_by_the_tool_name_and_what_it_was_asked_to_do', () => {
    const { card: c } = card(mcpRequest())

    expect(c.querySelector('strong')?.textContent).toBe('mcp__docs__search')
    expect(c.querySelector('pre.input')?.textContent).toBe(JSON.stringify({ query: 'x' }, null, 2))
  })

  it('a_call_naming_a_file_leads_with_what_it_would_do_and_where', () => {
    const { card: c } = card({ type: 'permission_request', requestId: 'e1', toolName: 'Edit', input: { file_path: 'a.ts' }, title: 'Claude wants to edit a.ts' })

    expect(c.querySelector('strong')?.textContent).toBe('Claude wants to edit a.ts')
  })

  it('allowing_for_the_session_remembers_the_tool_as_a_rule_without_arguments', () => {
    const { card: c, decisions } = card(mcpRequest())

    press(c, 'Allow mcp__docs__search for session')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow', remember: { session: ['mcp__docs__search'], project: [], person: [] } }])
  })

  it('pressing_the_plain_allow_beside_a_remembered_rule_allows_this_call_alone', () => {
    const { card: c, decisions } = card(mcpRequest())

    press(c, 'Allow')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })

  it('a_file_write_is_allowed_per_call_since_the_session_switch_covers_the_rest', () => {
    const { card: c } = card({ type: 'permission_request', requestId: 'e1', toolName: 'Edit', input: { file_path: 'a.ts' } })

    expect(labels(c)).toEqual(['Allow', 'Deny'])
  })

  it('an_answered_edit_keeps_showing_the_change_it_asked_about_never_its_raw_arguments', () => {
    const change = { path: 'a.ts', label: 'a.ts', diffs: ['@@ -1 +1 @@\n-a\n+b'], omitted: 0 }
    const { card: c } = card({ type: 'permission_request', requestId: 'e1', toolName: 'Edit', input: { file_path: 'a.ts' }, edit: change })
    expect(c.querySelector('.edit')).not.toBeNull()

    c.resolve('allow')

    expect(c.querySelector('.edit')).not.toBeNull()
    expect(c.querySelector('pre.input')).toBeNull()
    expect(c.querySelector('.decision')?.textContent).toBe('Allowed')
  })

  it('a_scripts_changes_are_listed_per_file_and_answered_once_without_a_remembered_rule', () => {
    const edits = ['a.ts', 'b.ts'].map((label) => ({ path: label, label, diffs: ['@@ -1 +1 @@\n-a\n+b'], omitted: 0 }))
    const { card: c, decisions } = card({ type: 'permission_request', requestId: 's1', toolName: 'RunScript', input: {}, title: 'Apply changes to 2 files', edits })

    expect(c.querySelectorAll('.change').length).toBe(2)
    expect(labels(c)).toEqual(['a.ts', 'b.ts', 'Allow', 'Deny'])

    press(c, 'Allow')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })
})

describe('a plan the model asks to leave planning with', () => {
  const planRequest = (): Request => ({
    type: 'permission_request',
    requestId: 'p1',
    toolName: 'ExitPlanMode',
    title: 'ExitPlanMode',
    input: { plan: '## Steps\n\n- Read `a.ts`\n- Write the test' },
  })
  const labels = (c: Card) => [...c.querySelectorAll('button')].map((b) => b.textContent)

  it('is_shown_as_the_markdown_it_was_written_in_never_as_the_raw_arguments', () => {
    const { card: c } = card(planRequest())

    expect(c.querySelector('pre.input')).toBeNull()
    expect(c.querySelector('strong')?.textContent).toBe('Proceed with this plan?')
    const plan = c.querySelector('.plan')
    expect(plan?.querySelector('h2')?.textContent).toBe('Steps')
    expect([...plan!.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['Read a.ts', 'Write the test'])
  })

  it('is_answered_for_this_plan_alone_so_no_remembered_rule_waves_the_next_one_through', () => {
    const { card: c, decisions } = card(planRequest())

    expect(labels(c)).toEqual(['Allow', 'Deny'])
    ;[...c.querySelectorAll('button')].find((b) => b.textContent === 'Allow')!.click()

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })
})

describe('the reason for a denial', () => {
  const editRequest = (): Request => ({ type: 'permission_request', requestId: 'e1', toolName: 'Edit', input: { file_path: 'a.ts' } })
  const reason = (c: Card) => c.querySelector<HTMLInputElement>('input.deny-reason')
  const type = (c: Card, text: string) => {
    const input = reason(c)!
    input.value = text
    input.dispatchEvent(new Event('input'))
  }
  const press = (c: Card, label: string) => [...c.querySelectorAll('button')].find((b) => b.textContent === label)!.click()

  it('goes_to_the_model_with_the_denial', () => {
    const { card: c, decisions } = card(editRequest())

    type(c, 'use the existing helper')
    press(c, 'Deny')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'deny', message: 'use the existing helper' }])
  })

  it('left_blank_denies_without_a_message', () => {
    const { card: c, decisions } = card(editRequest())

    type(c, '   ')
    press(c, 'Deny')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'deny' }])
  })

  it('is_not_sent_when_the_call_is_allowed', () => {
    const { card: c, decisions } = card(editRequest())

    type(c, 'changed my mind')
    press(c, 'Allow')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })

  it('typed_before_a_shell_line_is_answered_survives_and_rides_on_a_later_lines_denial', () => {
    const { card: c, decisions } = card(shellRequest())

    type(c, 'run the narrow test')
    click(rows(c)[0]!, 'Allow npm run for session')
    expect(reason(c)?.value).toBe('run the narrow test')
    click(rows(c)[1]!, 'Deny')

    expect(decisions.map((d) => d.decision)).toEqual([
      { kind: 'deny', message: 'run the narrow test', remember: { session: ['Bash(npm run:*)'], project: [], person: [] } },
    ])
  })

  it('is_shown_on_the_denied_card_in_place_of_the_field', () => {
    const { card: c } = card(editRequest())

    c.resolve('deny', 'use the existing helper')

    expect(reason(c)).toBeNull()
    expect(c.querySelector('.decision')?.textContent).toBe('Denied: use the existing helper')
  })
})

describe('a shell step in the transcript', () => {
  it('is_named_by_its_description_and_shows_its_commands_one_per_line', () => {
    const view = new ChatTranscript()
    document.body.appendChild(view)

    view.reset([{ type: 'tool_call', toolUseId: 't1', name: 'Bash', input: { command: 'npm run build && npx vitest run', description: 'Build, then test' } }], true)

    const step = view.querySelector('details.tool')!
    expect(step.querySelector('summary')?.textContent).toBe('Build, then test')
    expect(step.querySelector('pre.input')?.textContent).toBe('npm run build\nnpx vitest run')
    expect(step.textContent).not.toContain('Bash')
    expect(step.textContent).not.toContain('{')
  })
})

describe('a read or a write outside the project on the permission card', () => {
  const place = (verb: string, directory: string) => ({ directory, rule: `Bash(${verb} ${directory})` })
  const accessOf = (row: Element) => row.querySelector('.access')?.textContent

  it('says_whether_it_reads_or_writes_and_the_whole_directory', () => {
    const request = shellRequest()
    request.commands = [
      { text: 'cat D:/data/a/f.txt', access: { kind: 'reads', directory: 'D:/data/a' }, rule: 'Bash(read D:/data/a)', places: [place('read', 'D:/data/a'), place('read', 'D:/data')], scope: 'person' },
      { text: 'rm D:/x/f.txt', access: { kind: 'writes', directory: 'D:/x' }, rule: 'Bash(write D:/x)', places: [place('write', 'D:/x')], scope: 'person' },
    ]
    const { card: c } = card(request)

    expect(rows(c).map(accessOf)).toEqual(['Reads in D:/data/a', 'Writes to D:/x'])
  })

  it('a_path_that_names_no_place_is_allowed_for_this_call_only', () => {
    const request = shellRequest()
    request.commands = [{ text: 'cat $FILE', access: { kind: 'reads' } }]
    const { card: c, decisions } = card(request)

    expect(accessOf(rows(c)[0]!)).toBe('Reads in a place this call decides when it runs')
    expect(buttons(rows(c)[0]!)).toEqual(['Allow', 'Deny'])
    click(rows(c)[0]!, 'Allow')
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })

  it('each_missing_grant_is_answered_in_turn_and_denying_any_one_refuses_the_whole_call', () => {
    const request = shellRequest()
    request.commands = [
      { text: 'cp D:/a/x D:/b/y', access: { kind: 'reads', directory: 'D:/a' }, rule: 'Bash(read D:/a)', places: [place('read', 'D:/a')], scope: 'person' },
      { text: 'cp D:/a/x D:/b/y', access: { kind: 'writes', directory: 'D:/b' }, rule: 'Bash(write D:/b)', places: [place('write', 'D:/b')], scope: 'person' },
    ]
    const { card: c, decisions } = card(request)

    click(rows(c)[0]!, 'Allow')
    expect(decisions).toHaveLength(0)
    click(rows(c)[1]!, 'Deny')
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'deny' }])
  })

  it('a_directory_grant_is_offered_for_the_session_and_the_person_never_the_workspace_and_reads_back_the_place', () => {
    const request = shellRequest()
    const places = [place('write', 'D:/x/a.ts'), place('write', 'D:/x')]
    request.commands = [
      { text: 'rm D:/x/a.ts', access: { kind: 'writes', directory: 'D:/x' }, rule: places[0]!.rule, places, scope: 'person' },
      { text: 'cat D:/y/b', access: { kind: 'reads', directory: 'D:/y' }, rule: 'Bash(read D:/y)', places: [place('read', 'D:/y')], scope: 'person' },
    ]
    const { card: c, decisions } = card(request)

    expect(buttons(rows(c)[0]!).filter((b) => b?.includes('project'))).toEqual([])
    expect(buttons(rows(c)[0]!)).toContain('Allow directory for session')
    click(rows(c)[0]!, 'D:/x')
    click(rows(c)[0]!, 'Allow directory for session')
    expect(status(rows(c)[0]!)).toBe('allowed for session: write D:/x')
    click(rows(c)[1]!, 'Deny directory for me')
    expect(decisions.map((d) => d.decision)).toEqual([
      { kind: 'deny', remember: { session: ['Bash(write D:/x)'], project: [], person: [] }, denyRemember: { session: [], project: [], person: ['Bash(read D:/y)'] } },
    ])
  })

  it('a_file_write_still_shows_its_change_beside_the_choice_of_place_to_keep', () => {
    const change = { path: 'D:/x/a.ts', label: 'a.ts', diffs: ['@@ -1 +1 @@\n-a\n+b'], omitted: 0 }
    const { card: c, decisions } = card({
      type: 'permission_request',
      requestId: 'e1',
      toolName: 'Edit',
      input: { file_path: 'D:/x/a.ts' },
      edit: change,
      commands: [{ text: 'Edit D:/x', access: { kind: 'writes', directory: 'D:/x' }, rule: 'Edit(write D:/x)', places: [{ directory: 'D:/x', rule: 'Edit(write D:/x)' }], scope: 'person' }],
    })

    expect(c.querySelector('.edit')).not.toBeNull()
    expect(accessOf(rows(c)[0]!)).toBe('Writes to D:/x')
    click(rows(c)[0]!, 'Allow directory for me')
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow', remember: { session: [], project: [], person: ['Edit(write D:/x)'] } }])
  })
})
