// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '../src/agent/session/code-session'
import { judgeCall, type CallContext } from '../src/agent/permissions/judge-call'
import type { KeptGrant } from '../src/agent/permissions/grants'

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

const R = process.platform === 'win32' ? 'E:' : ''
const WS = `${R}/ws`
const HOME = `${R}/home/me`

const context = (grants: KeptGrant[] = []): CallContext => ({
  grants,
  ground: { workspace: WS, readable: [], writesAllowed: false, ignored: () => false, recoverable: () => false, trusted: () => false, denyGitWrites: false, home: HOME },
  home: HOME,
  exists: () => undefined,
  tools: { readOnly: () => false },
})

/** A prompt as the host shows it: the call, with the rows the rules make of it. */
function request(toolName: string, input: unknown, grants: KeptGrant[] = [], extra: Partial<Request> = {}): Request {
  return { type: 'permission_request', requestId: 'r1', toolName, input, rows: judgeCall(toolName, input, WS, context(grants)).rows, ...extra }
}

const bash = (command: string, grants: KeptGrant[] = [], description?: string) => request('Bash', { command, ...(description ? { description } : {}) }, grants)

function card(r: Request): { card: Card; decisions: Decided[] } {
  const element = new PermissionCard()
  document.body.appendChild(element)
  const decisions: Decided[] = []
  element.addEventListener(PermissionDecidedEvent.type, (e) => decisions.push(e as Decided))
  element.show(r)
  return { card: element, decisions }
}

const rows = (c: Card) => [...c.querySelectorAll('li.row')]
const does = (c: Card) => rows(c).map((row) => row.querySelector('.what')?.textContent)
/** A row's kept answers wait behind its Keep… link, so it is opened first; the row is redrawn, so it is found again by its place in the list. */
const open = (row: Element): Element => {
  const list = row.parentElement!
  const at = [...list.children].indexOf(row)
  row.querySelector<HTMLButtonElement>('button.keep')?.click()
  return list.children[at]!
}
const choose = (row: Element, label: string) => {
  const opened = row.querySelector('.choices') ? row : open(row)
  const option = [...opened.querySelectorAll('label')].find((l) => l.textContent?.trim() === label)
  if (!option) throw new Error(`No choice "${label}"`)
  const radio = option.querySelector('input')!
  radio.checked = true
  radio.dispatchEvent(new Event('change'))
}
const choices = (row: Element) => [...row.querySelectorAll('.choices label')].map((l) => l.textContent?.trim())
const sentence = (row: Element) => row.querySelector('.sentence')?.textContent
const confirm = (c: Card) => c.querySelector<HTMLButtonElement>('button.confirm')!
const deny = (c: Card) => c.querySelector<HTMLButtonElement>('button.deny')!
const fields = (c: Card) => [...c.querySelectorAll('dl.fields dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent])
const pick = (row: Element, index: number, value: string) => {
  const select = row.querySelectorAll('select')[index] as HTMLSelectElement
  select.value = value
  select.dispatchEvent(new Event('change'))
}

describe('a call on the permission card', () => {
  it('is_titled_by_its_description_and_lists_what_it_would_do_one_row_per_effect', () => {
    const { card: c } = card(bash(`ls && cat ${HOME}/data/raw.csv`, [], 'Look at the data'))
    expect(c.querySelector('strong')?.textContent).toBe('Look at the data')
    expect(c.querySelector('pre.input')).toBeNull()
    expect(does(c)).toEqual([`Reads ${WS}`, `Reads ${HOME}/data/raw.csv`])
  })

  it('a_row_that_already_passes_says_what_lets_it_through_and_takes_no_answer', () => {
    const { card: c } = card(bash(`ls && cat ${HOME}/data/raw.csv`))
    const [passing, asked] = rows(c)
    expect(passing!.classList.contains('passes')).toBe(true)
    expect(passing!.querySelector('.why')?.textContent).toBe('✓ reading in the workspace')
    expect(passing!.querySelector('button.keep')).toBeNull()
    expect(asked!.querySelector('button.keep')).not.toBeNull()
  })

  it('an_asked_row_is_one_line_answered_for_this_call_alone_by_the_cards_buttons', () => {
    const { card: c, decisions } = card(bash(`cat ${HOME}/data/raw.csv`))
    const [row] = rows(c)
    expect(row!.querySelector('.why')?.textContent).toBe('outside the workspace')
    expect(row!.querySelector('.choices')).toBeNull()
    expect(sentence(row!)).toBeUndefined()
    expect([...c.querySelectorAll('.actions button')].map((b) => b.textContent)).toEqual(['Allow', 'Deny'])
    confirm(c).click()
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })

  it('keep_opens_the_rows_answer_and_dont_keep_closes_it_again', () => {
    const { card: c } = card(bash(`cat ${HOME}/data/raw.csv`))
    const opened = open(rows(c)[0]!)
    expect(choices(opened)).toEqual(['Allow and keep', 'Deny and keep', "Don't keep"])
    expect(opened.querySelector<HTMLInputElement>('.choices input:checked')?.parentElement?.textContent?.trim()).toBe('Allow and keep')
    choose(opened, "Don't keep")
    expect(rows(c)[0]!.querySelector('.choices')).toBeNull()
    expect(confirm(c).textContent).toBe('Allow')
  })

  it('keeping_an_answer_shows_the_sentence_it_will_be_kept_as_and_follows_the_parts_picked', () => {
    const { card: c } = card(bash(`cat ${HOME}/data/raw.csv`))
    expect(rows(c)[0]!.querySelector('button.keep')?.textContent).toBe('Allow reads in this folder…')
    choose(rows(c)[0]!, 'Allow and keep')
    expect(sentence(rows(c)[0]!)).toBe(`From now on: This session may read files in ${HOME}/data (not the folders below it) without asking.`)
    pick(rows(c)[0]!, 0, '0')
    expect(sentence(rows(c)[0]!)).toBe(`From now on: This session may read files on ${HOME}/data/raw.csv without asking.`)
    pick(rows(c)[0]!, 0, '1')
    pick(rows(c)[0]!, 1, 'tree')
    pick(rows(c)[0]!, 2, 'person')
    expect(sentence(rows(c)[0]!)).toBe(`From now on: Every session in every workspace may read files in ${HOME}/data and every folder below it without asking.`)
    expect(confirm(c).textContent).toBe('Allow and keep')
  })

  it('the_kept_answer_goes_out_with_the_decision_as_the_grant_the_sentence_read', () => {
    const { card: c, decisions } = card(bash(`cat ${HOME}/data/raw.csv`))
    choose(rows(c)[0]!, 'Allow and keep')
    pick(rows(c)[0]!, 0, '1')
    pick(rows(c)[0]!, 1, 'tree')
    pick(rows(c)[0]!, 2, 'person')
    confirm(c).click()
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow', keep: [{ verdict: 'allow', action: 'read', place: `${HOME}/data`, reach: 'tree', scope: 'person' }] }])
  })

  it('only_the_scopes_the_place_allows_are_offered', () => {
    const outside = card(bash(`cat ${HOME}/data/raw.csv`)).card
    choose(rows(outside)[0]!, 'Allow and keep')
    expect([...rows(outside)[0]!.querySelectorAll('select')[2]!.querySelectorAll('option')].map((o) => o.value)).toEqual(['session', 'workspace', 'person'])
    const inside = card(bash('rm -rf build')).card
    choose(rows(inside)[0]!, 'Deny and keep')
    expect([...rows(inside)[0]!.querySelectorAll('select')[2]!.querySelectorAll('option')].map((o) => o.value)).toEqual(['session', 'workspace'])
  })

  it('a_command_run_in_the_workspace_is_answered_once_for_the_session_or_for_the_workspace_with_plain_buttons', () => {
    const { card: c, decisions } = card(bash('cargo test --lib && npx tsc --noEmit'))
    expect([...c.querySelectorAll('.actions button')].map((b) => b.textContent)).toEqual(['Allow once', 'Allow for this session', 'Allow for this workspace', 'Deny'])
    expect(c.querySelector('button.keep')).toBeNull()
    expect(c.querySelector<HTMLButtonElement>('button.keep-workspace')!.title).toBe(
      `Every session in this workspace may run \`cargo test\`, with any flags, in ${WS} and every folder below it without asking. Every session in this workspace may run \`npx tsc\`, with any flags, in ${WS} and every folder below it without asking.`,
    )
    c.querySelector<HTMLButtonElement>('button.keep-workspace')!.click()
    expect(decisions[0]!.decision).toEqual({
      kind: 'allow',
      keep: [
        { verdict: 'allow', command: ['cargo', 'test'], place: WS, reach: 'tree', scope: 'workspace' },
        { verdict: 'allow', command: ['npx', 'tsc'], place: WS, reach: 'tree', scope: 'workspace' },
      ],
    })
  })

  it('allow_once_keeps_nothing_and_a_command_run_from_a_subfolder_is_kept_for_the_whole_workspace', () => {
    const once = card(bash('cargo test'))
    confirm(once.card).click()
    expect(once.decisions[0]!.decision).toEqual({ kind: 'allow' })
    const sub = card(bash('cd crates/x && cargo test'))
    sub.card.querySelector<HTMLButtonElement>('button.keep-session')!.click()
    expect(sub.decisions[0]!.decision).toMatchObject({ keep: [{ command: ['cargo', 'test'], place: WS, reach: 'tree', scope: 'session' }] })
  })

  it('an_effect_no_allow_may_be_kept_for_offers_no_allow_and_keep_and_says_why_in_one_line', () => {
    const { card: c } = card(bash('rm -rf build'))
    const row = open(rows(c)[0]!)
    expect(choices(row)).toEqual(['Deny and keep', "Don't keep"])
    expect(row.querySelector('.never')?.textContent).toBe('Deletes or replaces content: always asked.')
  })

  it('a_place_the_line_does_not_settle_says_so_and_can_be_allowed_for_this_call_only', () => {
    const { card: c } = card(bash('grep -rn "pub enum" $T'))
    const row = rows(c).find((r) => r.classList.contains('asked'))!
    expect(row.querySelector('.what')?.textContent).toContain('$T (unknown place)')
    expect(choices(open(row))).toEqual(['Deny and keep', "Don't keep"])
  })

  it('a_denial_kept_with_flags_refuses_only_calls_carrying_them_and_the_sentence_names_them', () => {
    const { card: c, decisions } = card(bash('git push --force origin main'))
    const row = rows(c).find((r) => r.querySelector('.what')?.textContent?.startsWith('Reaches a remote'))!
    choose(row, 'Deny and keep')
    const again = rows(c).find((r) => r.querySelector('.what')?.textContent?.startsWith('Reaches a remote'))!
    const force = [...again.querySelectorAll<HTMLInputElement>('.flags input')][0]!
    force.checked = true
    force.dispatchEvent(new Event('change'))
    const shown = rows(c).find((r) => r.querySelector('.what')?.textContent?.startsWith('Reaches a remote'))!
    expect(sentence(shown)).toBe(`From now on: Every session in this workspace is refused when it would run \`git push --force\` in ${WS} and every folder below it.`)
    confirm(c).click()
    expect(decisions[0]!.decision).toMatchObject({ kind: 'deny', keep: [{ verdict: 'deny', command: ['git', 'push'], flags: ['--force'], scope: 'workspace' }] })
  })

  it('a_row_kept_as_a_denial_refuses_the_line_and_the_confirm_says_so', () => {
    const { card: c, decisions } = card(bash(`cat ${HOME}/data/a.csv && frobnicate`))
    choose(rows(c)[1]!, 'Deny and keep')
    expect(confirm(c).textContent).toBe('Refuse the line')
    expect(c.querySelector('button.deny')).toBeNull()
    confirm(c).click()
    expect(decisions[0]!.decision).toMatchObject({ kind: 'deny', keep: [{ verdict: 'deny', command: ['frobnicate'] }] })
  })

  it('denying_the_line_still_saves_the_answers_kept_on_its_rows', () => {
    const { card: c, decisions } = card(bash(`cat ${HOME}/data/a.csv && frobnicate`))
    choose(rows(c)[0]!, 'Allow and keep')
    deny(c).click()
    expect(decisions[0]!.decision).toMatchObject({ kind: 'deny', keep: [{ verdict: 'allow', action: 'read' }] })
  })

  it('a_call_the_engine_asks_about_though_every_row_passes_is_answered_as_a_whole', () => {
    const { card: c, decisions } = card(bash('ls'))
    expect(rows(c).every((r) => r.classList.contains('passes'))).toBe(true)
    expect([...c.querySelectorAll('.actions button')].map((b) => b.textContent)).toEqual(['Allow', 'Deny'])
    confirm(c).click()
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })

  it('an_allowed_shell_call_leaves_only_the_complete_command_and_takes_no_more_input', () => {
    const { card: c } = card(bash('ls -la'))
    c.resolve('allow')
    expect(c.querySelector('pre.command')?.textContent).toBe('ls -la')
    expect(c.querySelector('.choices')).toBeNull()
  })

  it('the_kept_answers_read_back_as_their_sentences_once_answered', () => {
    // A shell call that is allowed settles to its command alone, so another tool shows what was kept.
    const { card: c } = card(request('Read', { file_path: `${HOME}/data/raw.csv` }))
    choose(rows(c)[0]!, 'Allow and keep')
    confirm(c).click()
    c.resolve('allow')
    expect(c.querySelector('.decision')?.textContent).toBe(`Allowed. Kept: This session may read files in ${HOME}/data (not the folders below it) without asking.`)
  })
})

describe('a call that is not a shell command', () => {
  it('a_call_naming_neither_a_file_nor_a_command_is_led_by_the_tool_name_and_what_it_was_asked_to_do', () => {
    const { card: c } = card(request('mcp__docs__search', { query: 'x' }))
    expect(c.querySelector('strong')?.textContent).toBe('mcp__docs__search')
    expect(fields(c)).toEqual([['query', 'x']])
    expect(does(c)).toEqual([`Runs mcp__docs__search in ${WS}`])
  })

  it('flat_arguments_read_as_labelled_fields_and_a_description_cut_from_one_is_not_repeated', () => {
    const input = { pattern: '(?i)\\b(pric|licen[cs]e)\\b', path: `${HOME}/suite`, glob: '{a,b}/docs/**/*.md', head_limit: 40 }
    const { card: c } = card(request('Grep', input, [], { description: '(?i)\\b(pric|lic...' }))
    expect(fields(c)).toEqual([['pattern', input.pattern], ['path', input.path], ['glob', input.glob], ['head limit', '40']])
    expect(c.querySelector('.description')).toBeNull()
    expect(c.querySelector('pre.input')).toBeNull()
  })

  it('an_answered_edit_keeps_showing_the_change_it_asked_about_never_its_raw_arguments', () => {
    const change = { path: 'a.ts', label: 'a.ts', diffs: ['@@ -1 +1 @@\n-a\n+b'], omitted: 0 }
    const { card: c } = card(request('Edit', { file_path: `${WS}/a.ts` }, [], { edit: change }))
    expect(c.querySelector('.edit')).not.toBeNull()
    c.resolve('allow')
    expect(c.querySelector('.edit')).not.toBeNull()
    expect(c.querySelector('pre.input')).toBeNull()
    expect(c.querySelector('.decision')?.textContent).toBe('Allowed')
  })

  it('a_write_in_the_workspace_says_it_follows_allow_writes_and_keeps_nothing', () => {
    const { card: c } = card(request('Edit', { file_path: `${WS}/a.ts` }))
    const [row] = rows(c)
    expect(row!.querySelector('.never')?.textContent).toBe('Writes in the workspace follow the Allow writes switch.')
    expect(row!.querySelector('button.keep')).toBeNull()
  })

  it('a_scripts_changes_are_listed_per_file_and_answered_once', () => {
    const edits = ['a.ts', 'b.ts'].map((label) => ({ path: label, label, diffs: ['@@ -1 +1 @@\n-a\n+b'], omitted: 0 }))
    const { card: c, decisions } = card({ type: 'permission_request', requestId: 's1', toolName: 'RunScript', input: {}, title: 'Apply changes to 2 files', edits })
    expect(c.querySelectorAll('.change').length).toBe(2)
    confirm(c).click()
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })
})

describe('a plan the model asks to leave planning with', () => {
  const planRequest = (): Request => ({ type: 'permission_request', requestId: 'p1', toolName: 'ExitPlanMode', title: 'ExitPlanMode', input: { plan: '## Steps\n\n- Read `a.ts`\n- Write the test' } })

  it('is_shown_as_the_markdown_it_was_written_in_and_answered_for_this_plan_alone', () => {
    const { card: c, decisions } = card(planRequest())
    expect(c.querySelector('pre.input')).toBeNull()
    expect(c.querySelector('strong')?.textContent).toBe('Proceed with this plan?')
    expect([...c.querySelector('.plan')!.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['Read a.ts', 'Write the test'])
    expect([...c.querySelectorAll('.actions button')].map((b) => b.textContent)).toEqual(['Allow', 'Deny'])
    confirm(c).click()
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })
})

describe('the reason for a denial', () => {
  const reason = (c: Card) => c.querySelector<HTMLInputElement>('input.deny-reason')
  const type = (c: Card, text: string) => {
    reason(c)!.value = text
  }

  it('goes_to_the_model_with_the_denial', () => {
    const { card: c, decisions } = card(request('Edit', { file_path: `${WS}/a.ts` }))
    type(c, 'use the existing helper')
    deny(c).click()
    expect(decisions.map((d) => d.decision)).toEqual([{ kind: 'deny', message: 'use the existing helper' }])
  })

  it('left_blank_denies_without_a_message_and_is_not_sent_with_an_allow', () => {
    const blank = card(request('Edit', { file_path: `${WS}/a.ts` }))
    type(blank.card, '   ')
    deny(blank.card).click()
    expect(blank.decisions.map((d) => d.decision)).toEqual([{ kind: 'deny' }])
    const allowed = card(request('Edit', { file_path: `${WS}/a.ts` }))
    type(allowed.card, 'changed my mind')
    confirm(allowed.card).click()
    expect(allowed.decisions.map((d) => d.decision)).toEqual([{ kind: 'allow' }])
  })

  it('typed_before_a_row_is_answered_survives_the_card_redrawing', () => {
    const { card: c } = card(bash(`cat ${HOME}/a.csv`))
    type(c, 'run the narrow test')
    choose(rows(c)[0]!, 'Allow and keep')
    expect(reason(c)?.value).toBe('run the narrow test')
  })

  it('is_shown_on_the_denied_card_in_place_of_the_field', () => {
    const { card: c } = card(request('Edit', { file_path: `${WS}/a.ts` }))
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

describe('a prompt in the conversation', () => {
  const prompt = (id: string): Request => ({ ...bash(`cat ${HOME}/${id}.csv`), requestId: id, toolUseId: id })
  const call = (id: string): SessionEvent => ({ type: 'tool_call', toolUseId: id, name: 'Read', input: { file_path: `${WS}/${id}.ts` } })

  it('stays_below_the_calls_made_alongside_it_until_it_is_answered', () => {
    const view = new ChatTranscript()
    document.body.appendChild(view)
    view.reset([call('a'), prompt('a'), call('b'), call('c')], true)
    const order = () => [...view.children].filter((c) => c.matches('details.tool, permission-card')).map((c) => c.tagName === 'PERMISSION-CARD' ? 'prompt' : 'call')
    expect(order()).toEqual(['call', 'call', 'call', 'prompt'])
    view.apply({ type: 'permission_resolved', requestId: 'a', decision: 'deny' })
    view.apply(call('d'))
    expect(order()).toEqual(['call', 'call', 'call', 'prompt', 'call'])
  })

  it('a_prompt_raised_inside_a_subagent_unfolds_its_step', () => {
    const view = new ChatTranscript()
    document.body.appendChild(view)
    const spawn: SessionEvent = { type: 'tool_call', toolUseId: 'agent', name: 'Agent', input: { description: 'Evaluate', prompt: 'x' } }
    const inside: SessionEvent = { type: 'tool_call', toolUseId: 'w', name: 'Write', input: { file_path: `${WS}/a.json` }, parentToolUseId: 'agent' }
    view.reset([spawn, inside, prompt('w')], true)
    const card = view.querySelector('permission-card')!
    const step = card.closest('details')
    expect(step).not.toBeNull()
    expect(step!.open).toBe(true)
  })

  it('a_prompt_left_open_when_the_engine_stopped_stays_answerable_but_nothing_waits_on_it', () => {
    const view = new ChatTranscript()
    document.body.appendChild(view)
    view.reset([call('a'), prompt('a'), { type: 'ended' }, { type: 'user_message', text: 'carry on' }, call('b')], true)
    expect(view.querySelector('p.working')?.textContent).not.toContain('Waiting for you')
    const card = view.querySelector('permission-card')!
    expect(card.querySelector('.late-note')?.textContent).toContain('next message')
    expect(card.querySelector('button.confirm')).not.toBeNull()
  })

  it('the_waiting_row_brings_the_open_prompt_into_view', () => {
    const view = new ChatTranscript()
    document.body.appendChild(view)
    view.reset([call('a'), prompt('a')], true)
    const card = view.querySelector('permission-card')!
    const seen = vi.fn()
    card.scrollIntoView = seen
    view.querySelector<HTMLElement>('p.working.needs-user')!.click()
    expect(seen).toHaveBeenCalled()
  })
})
