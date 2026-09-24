// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../src/agent/session/code-session'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

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

  it('a_command_that_needs_an_answer_offers_session_project_and_deny_and_one_that_passes_says_why', () => {
    const { card: c } = card(shellRequest())
    const [build, test, list] = rows(c)

    expect(buttons(build!)).toEqual(['Allow npm run for session', 'Allow npm run for project', 'Deny'])
    expect(buttons(test!)).toEqual(['Allow npx vitest for session', 'Allow npx vitest for project', 'Deny'])
    expect(buttons(list!)).toEqual([])
    expect(status(list!)).toBe('read-only')
  })

  it('the_call_is_allowed_once_every_command_is_and_the_answers_are_remembered_by_scope', () => {
    const { card: c, decisions } = card(shellRequest())

    click(rows(c)[0]!, 'Allow npm run for session')
    expect(decisions).toHaveLength(0)
    expect(status(rows(c)[0]!)).toBe('allowed for session: npm run')
    expect(buttons(rows(c)[1]!)).toHaveLength(3)

    click(rows(c)[1]!, 'Allow npx vitest for project')
    expect(decisions).toHaveLength(1)
    expect(decisions[0]!.requestId).toBe('r1')
    expect(decisions[0]!.decision).toEqual({ kind: 'allow', remember: { session: ['Bash(npm run:*)'], project: ['Bash(npx vitest:*)'] } })
  })

  it('one_denied_command_denies_the_call_and_the_others_keep_what_they_were_answered', () => {
    const { card: c, decisions } = card(shellRequest())

    click(rows(c)[0]!, 'Allow npm run for project')
    click(rows(c)[1]!, 'Deny')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'deny', remember: { session: [], project: ['Bash(npm run:*)'] } }])
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

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow', remember: { session: ['Bash(npm run:*)'], project: [] } }])
  })

  it('a_command_no_rule_can_stand_for_is_allowed_for_this_call_only', () => {
    const request = shellRequest()
    request.commands = [{ text: 'echo $(ls)' }]
    const { card: c, decisions } = card(request)

    expect(buttons(rows(c)[0]!)).toEqual(['Allow', 'Deny'])
    click(rows(c)[0]!, 'Allow')
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })

  it('a_resolved_card_shows_the_outcome_and_takes_no_more_input', () => {
    const { card: c, decisions } = card(shellRequest())

    c.resolve('allow')

    expect(c.isResolved).toBe(true)
    expect(c.querySelectorAll('button')).toHaveLength(0)
    expect(c.querySelector('.decision')?.textContent).toBe('Allowed')
    expect(status(rows(c)[2]!)).toBe('read-only')
    expect(() => click(rows(c)[0]!, 'Allow npm run for session')).toThrow()
    expect(decisions).toHaveLength(0)
  })
})

describe('a call that is not a shell command', () => {
  const mcpRequest = (): Request => ({ type: 'permission_request', requestId: 'm1', toolName: 'mcp__docs__search', input: { query: 'x' } })
  const labels = (c: Card) => [...c.querySelectorAll('button')].map((b) => b.textContent)
  const press = (c: Card, label: string) => [...c.querySelectorAll('button')].find((b) => b.textContent === label)!.click()

  it('is_allowed_for_the_tool_whatever_its_arguments_for_the_session_or_the_project', () => {
    const { card: c } = card(mcpRequest())

    expect(labels(c)).toEqual(['Allow mcp__docs__search for session', 'Allow mcp__docs__search for project', 'Deny'])
  })

  it('allowing_for_the_session_remembers_the_tool_as_a_rule_without_arguments', () => {
    const { card: c, decisions } = card(mcpRequest())

    press(c, 'Allow mcp__docs__search for session')

    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow', remember: { session: ['mcp__docs__search'], project: [] } }])
  })

  it('a_file_write_is_allowed_per_call_since_the_session_switch_covers_the_rest', () => {
    const { card: c } = card({ type: 'permission_request', requestId: 'e1', toolName: 'Edit', input: { file_path: 'a.ts' } })

    expect(labels(c)).toEqual(['Allow', 'Deny'])
  })

  it('an_allowed_edit_leaves_its_diff_to_the_edit_step_so_it_is_shown_once', () => {
    const change = { path: 'a.ts', label: 'a.ts', diffs: ['@@ -1 +1 @@\n-a\n+b'], omitted: 0 }
    const { card: c } = card({ type: 'permission_request', requestId: 'e1', toolName: 'Edit', input: { file_path: 'a.ts' }, edit: change })
    expect(c.querySelector('.edit')).not.toBeNull()

    c.resolve('allow')

    expect(c.querySelector('.edit')).toBeNull()
    expect(c.querySelector('.decision')?.textContent).toBe('Allowed')
  })
})

describe('a shell step in the transcript', () => {
  it('is_named_by_its_description_and_shows_its_commands_one_per_line', () => {
    const view = new ChatTranscript()
    document.body.appendChild(view)

    view.reset([{ type: 'tool_call', toolUseId: 't1', name: 'Bash', input: { command: 'npm run build && npx vitest run', description: 'Build, then test' } }])

    const step = view.querySelector('details.tool')!
    expect(step.querySelector('summary')?.textContent).toBe('Build, then test')
    expect(step.querySelector('pre.input')?.textContent).toBe('npm run build\nnpx vitest run')
    expect(step.textContent).not.toContain('Bash')
    expect(step.textContent).not.toContain('{')
  })
})
