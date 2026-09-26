// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import type { SessionEvent } from '../src/agent/session/code-session'
import type { QuestionOutcome } from '../src/agent/session/user-question'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { ChatTranscript } = await import('../src/chat/webview/chat-transcript')
const { QuestionCard } = await import('../src/chat/webview/question-card')
const { QuestionAnsweredEvent } = await import('../src/chat/webview/events')

type Transcript = InstanceType<typeof ChatTranscript>

function transcript(): Transcript {
  const view = new ChatTranscript()
  document.body.appendChild(view)
  return view
}

const cards = (view: Transcript) => [...view.querySelectorAll('question-card')] as InstanceType<typeof QuestionCard>[]
const headers = (card: Element) => [...card.querySelectorAll('.header')].map((h) => h.textContent)
const submit = (card: Element) => card.querySelector<HTMLButtonElement>('button.submit')

function ask(requestId: string, header: string): SessionEvent {
  return { type: 'question_request', requestId, request: { questions: [{ header, question: `${header}?`, options: [{ label: 'Yes' }, { label: 'No' }] }] } }
}

function answered(requestId: string, label: string): SessionEvent {
  const outcome: QuestionOutcome = { kind: 'answered', answers: [{ chosen: [label] }] }
  return { type: 'question_resolved', requestId, outcome }
}

/** The prompt a write raises and how the user answered it, carrying the change it asks about. */
function prompt(toolUseId: string, path: string, decision: 'allow' | 'deny'): SessionEvent[] {
  const change = { path, label: path, diffs: ['@@ -1 +1 @@\n-a\n+b'], omitted: 0 }
  return [
    { type: 'permission_request', requestId: `p-${toolUseId}`, toolUseId, toolName: 'Write', input: { file_path: path }, edit: change },
    { type: 'permission_resolved', requestId: `p-${toolUseId}`, decision },
  ]
}

/** What the card would send if it still took input. */
function submitted(card: Element): unknown {
  let sent: unknown
  card.addEventListener(QuestionAnsweredEvent.type, (e) => {
    sent = (e as InstanceType<typeof QuestionAnsweredEvent>).outcome
  })
  submit(card)?.click()
  return sent
}

describe('terminal output in the transcript', () => {
  const ESC = String.fromCharCode(27)

  it('a_tool_result_shows_ansi_colours_as_styled_text_without_the_control_characters', () => {
    const view = transcript()

    view.reset([
      { type: 'tool_call', toolUseId: 't1', name: 'Bash', input: { command: 'npm test' } },
      { type: 'tool_result', toolUseId: 't1', text: `${ESC}[41m${ESC}[1m FAIL ${ESC}[22m${ESC}[49m test/x.test.ts`, isError: true },
    ])

    const result = view.querySelector('pre.result')!
    expect(result.textContent).toBe(' FAIL  test/x.test.ts')
    expect(result.querySelector('span')?.className).toBe('ansi-bold ansi-bg-Red')
  })

  it('a_handoff_message_carrying_test_output_shows_it_coloured_too', () => {
    const view = transcript()

    view.reset([{ type: 'user_message', text: `The test run failed:\n${ESC}[31mFAIL${ESC}[39m test/x.test.ts` }])

    const message = view.querySelector('article.user')!
    expect(message.textContent).toBe('The test run failed:\nFAIL test/x.test.ts')
    expect(message.querySelector('span')?.className).toBe('ansi-fg-Red')
  })
})

describe('finished steps in the transcript', () => {
  const step = (view: Transcript) => view.querySelector<HTMLDetailsElement>('details.tool')!

  it('a_step_is_marked_done_only_once_its_result_arrives_so_a_running_one_stays_visible', () => {
    const view = transcript()

    view.apply({ type: 'tool_call', toolUseId: 't1', name: 'Bash', input: { command: 'npm test' } })
    expect(step(view).classList.contains('done')).toBe(false)
    view.apply({ type: 'tool_result', toolUseId: 't1', text: 'ok', isError: false })
    expect(step(view).classList.contains('done')).toBe(true)
  })

  it('a_failed_step_is_marked_failed_so_it_is_not_muted_with_the_steps_that_worked', () => {
    const view = transcript()

    view.reset([
      { type: 'tool_call', toolUseId: 't1', name: 'Bash', input: { command: 'npm test' } },
      { type: 'tool_result', toolUseId: 't1', text: 'boom', isError: true },
    ])

    expect(step(view).classList.contains('failed')).toBe(true)
  })
})

describe('file edits in the transcript', () => {
  const edit = (path: string) => ({ path, label: path, diffs: ['@@ -1 +1 @@\n-a\n+b'], omitted: 0 })
  const write = (id: string, path: string, isError = false): SessionEvent[] => [
    { type: 'tool_call', toolUseId: id, name: 'Write', input: { file_path: path } },
    { type: 'tool_result', toolUseId: id, text: isError ? 'Permission denied' : `File written: ${path}`, isError, ...(isError ? {} : { edit: edit(path) }) },
  ]
  const steps = (view: Transcript) => [...view.querySelectorAll<HTMLDetailsElement>('details.tool')]

  it('a_successful_edit_shows_its_diff_without_the_tools_confirmation_text', () => {
    const view = transcript()

    view.reset(write('t1', 'src/a.ts'))

    expect(steps(view)[0]?.querySelector('.edit')).not.toBeNull()
    expect(view.querySelectorAll('pre.result')).toHaveLength(0)
  })

  it('a_failed_edit_still_shows_why_it_failed', () => {
    const view = transcript()

    view.reset(write('t1', 'src/a.ts', true))

    expect(view.querySelector('pre.result')?.textContent).toBe('Permission denied')
  })

  it('only_the_latest_successful_edit_stays_open', () => {
    const view = transcript()

    view.reset([...write('t1', 'src/a.ts'), ...write('t2', 'src/b.ts')])
    view.apply(write('t3', 'src/c.ts')[0]!)
    view.apply(write('t3', 'src/c.ts')[1]!)

    expect(steps(view).map((s) => s.open)).toEqual([false, false, true])
  })

  it('an_edit_the_user_allowed_at_a_prompt_is_collapsed_since_they_have_read_it', () => {
    const view = transcript()
    const [call, result] = write('t1', 'src/a.ts')

    view.reset([call!, ...prompt('t1', 'src/a.ts', 'allow'), result!])

    expect(steps(view)[0]?.open).toBe(false)
    expect(steps(view)[0]?.querySelector('.edit')).not.toBeNull()
  })

  it('an_edit_allowed_at_a_prompt_leaves_an_earlier_unread_edit_open', () => {
    const view = transcript()
    const [call, result] = write('t2', 'src/b.ts')

    view.reset([...write('t1', 'src/a.ts'), call!, ...prompt('t2', 'src/b.ts', 'allow'), result!])

    expect(steps(view).map((s) => s.open)).toEqual([true, false])
  })
})

describe('a permission prompt in the transcript', () => {
  const edit = (path: string) => ({ path, label: path, diffs: ['@@ -1 +1 @@\n-a\n+b'], omitted: 0 })
  const cards = (view: Transcript) => [...view.querySelectorAll('permission-card')]

  it('goes_once_the_call_it_allowed_reports_what_it_did_so_the_call_is_shown_once', () => {
    const view = transcript()

    view.reset([
      { type: 'tool_call', toolUseId: 't1', name: 'Write', input: { file_path: 'src/a.ts' } },
      ...prompt('t1', 'src/a.ts', 'allow'),
      { type: 'tool_result', toolUseId: 't1', text: 'File written', isError: false, edit: edit('src/a.ts') },
    ])

    expect(cards(view)).toHaveLength(0)
    expect(view.querySelectorAll('.edit')).toHaveLength(1)
  })

  it('stays_when_the_call_was_denied_since_nothing_else_records_the_refusal', () => {
    const view = transcript()

    view.reset([
      { type: 'tool_call', toolUseId: 't1', name: 'Write', input: { file_path: 'src/a.ts' } },
      ...prompt('t1', 'src/a.ts', 'deny'),
      { type: 'tool_result', toolUseId: 't1', text: 'Denied by user', isError: true },
    ])

    expect(cards(view)).toHaveLength(1)
    expect(cards(view)[0]?.querySelector('.edit')).not.toBeNull()
  })
})

describe('the activity row', () => {
  const activity = (view: Transcript) => view.querySelector('.working')?.textContent ?? null
  /** The row marked as stalled on the user, which the stylesheet colours as a warning. */
  const waitsOnUser = (view: Transcript) => view.querySelector('.working')?.classList.contains('needs-user') ?? false

  it('a_sent_prompt_waits_on_the_model_until_it_starts_thinking_or_writing', () => {
    const view = transcript()

    view.apply({ type: 'user_message', text: 'go' })
    expect(activity(view)).toBe('Waiting on model…')
    view.apply({ type: 'assistant_thinking', messageId: 'm1', delta: 'hm' })
    expect(activity(view)).toBe('Thinking…')
    view.apply({ type: 'assistant_text', messageId: 'm1', delta: 'Sure' })
    expect(activity(view)).toBe('Writing…')
  })

  it('a_session_being_brought_up_says_so_until_its_engine_reports_in', () => {
    const view = transcript()

    view.apply({ type: 'user_message', text: 'go' })
    view.apply({ type: 'status', status: 'starting' })
    expect(activity(view)).toBe('Starting the session…')
    view.apply({ type: 'session_started', engineSessionId: 'e1', model: 'opus' })
    expect(activity(view)).toBe('Waiting on model…')
  })

  it('a_tool_call_without_a_result_names_the_step_that_runs_and_its_result_hands_back_to_the_model', () => {
    const view = transcript()

    view.apply({ type: 'user_message', text: 'go' })
    view.apply({ type: 'tool_call', toolUseId: 't1', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } })
    expect(activity(view)).toBe('Running Run the tests…')
    view.apply({ type: 'tool_call', toolUseId: 't2', name: 'Read', input: { file_path: 'src/x.ts' } })
    expect(activity(view)).toBe('Running Read src/x.ts…')
    view.apply({ type: 'tool_result', toolUseId: 't2', text: '', isError: false })
    expect(activity(view)).toBe('Running Run the tests…')
    view.apply({ type: 'tool_result', toolUseId: 't1', text: '', isError: false })
    expect(activity(view)).toBe('Waiting on model…')
  })

  it('compaction_is_named_while_it_runs_and_the_turn_end_clears_the_row', () => {
    const view = transcript()

    view.apply({ type: 'user_message', text: 'go' })
    view.apply({ type: 'status', status: 'compacting' })
    expect(activity(view)).toBe('Compacting context…')
    view.apply({ type: 'status', status: 'idle' })
    expect(activity(view)).toBe('Compacting context…')
    view.apply({ type: 'turn_done', isError: false, errors: [] })
    expect(activity(view)).toBeNull()
  })

  it('a_granted_permission_resumes_the_step_it_held_up', () => {
    const view = transcript()

    view.apply({ type: 'user_message', text: 'go' })
    view.apply({ type: 'tool_call', toolUseId: 't1', name: 'Write', input: { file_path: 'src/x.ts' } })
    view.apply({ type: 'permission_request', requestId: 'p1', toolName: 'Write', input: { file_path: 'src/x.ts' } })
    view.apply({ type: 'permission_resolved', requestId: 'p1', decision: 'allow' })
    expect(activity(view)).toBe('Running Write src/x.ts…')
    expect(waitsOnUser(view)).toBe(false)
  })

  it('a_pending_permission_says_the_turn_is_stalled_on_the_user_rather_than_reading_as_progress', () => {
    const view = transcript()

    view.apply({ type: 'user_message', text: 'go' })
    view.apply({ type: 'tool_call', toolUseId: 't1', name: 'Write', input: { file_path: 'src/x.ts' } })
    view.apply({ type: 'permission_request', requestId: 'p1', toolName: 'Write', input: { file_path: 'src/x.ts' } })

    expect(activity(view)).toBe('Waiting for you to allow or deny…')
    expect(waitsOnUser(view)).toBe(true)
  })

  it('answering_one_of_two_open_permissions_keeps_the_row_on_the_one_still_open', () => {
    const view = transcript()

    view.apply({ type: 'user_message', text: 'go' })
    view.apply({ type: 'permission_request', requestId: 'p1', toolName: 'Write', input: { file_path: 'src/x.ts' } })
    view.apply({ type: 'permission_request', requestId: 'p2', toolName: 'Write', input: { file_path: 'src/y.ts' } })
    view.apply({ type: 'permission_resolved', requestId: 'p1', decision: 'allow' })

    expect(waitsOnUser(view)).toBe(true)
    view.apply({ type: 'permission_resolved', requestId: 'p2', decision: 'allow' })
    expect(waitsOnUser(view)).toBe(false)
  })

  it('an_open_question_says_the_answer_is_the_users_to_give', () => {
    const view = transcript()

    view.apply({ type: 'user_message', text: 'go' })
    view.apply(ask('r1', 'Storage'))
    expect(activity(view)).toBe('Waiting for your answer…')
    expect(waitsOnUser(view)).toBe(true)

    view.apply(answered('r1', 'Yes'))
    expect(activity(view)).toBe('Waiting on model…')
    expect(waitsOnUser(view)).toBe(false)
  })
})

describe('questions in a replayed transcript', () => {
  beforeAll(() => {
    // The card's own custom element registers when its module loads; the transcript needs it defined.
    expect(customElements.get('question-card')).toBeDefined()
  })

  it('a_replayed_request_shows_its_card_with_the_recorded_answers_read_only_and_unsubmittable', () => {
    const view = transcript()

    view.reset([
      { type: 'tool_call', toolUseId: 't1', name: 'mcp__kiwi__AskUser', input: { questions: [] } },
      ask('r1', 'Storage'),
      answered('r1', 'Yes'),
      { type: 'tool_result', toolUseId: 't1', text: 'Chose: Yes', isError: false },
    ])

    const [card] = cards(view)
    expect(cards(view)).toHaveLength(1)
    expect(headers(card!)).toEqual(['Storage'])
    expect(card?.isResolved).toBe(true)
    expect(card?.querySelector('.answered')?.textContent).toContain('Yes')
    expect(submit(card!)).toBeNull()
    expect(submitted(card!)).toBeUndefined()
    // The card is the question; the tool call and its result say nothing it does not.
    expect(view.querySelectorAll('details.tool')).toHaveLength(0)
    expect(view.querySelectorAll('pre.result')).toHaveLength(0)
  })

  it('a_request_left_open_in_the_log_replays_still_pending_and_still_answerable', () => {
    const view = transcript()

    view.reset([{ type: 'user_message', text: 'go' }, ask('r1', 'Storage')])

    const [card] = cards(view)
    expect(card?.isResolved).toBe(false)
    expect(submit(card!)).not.toBeNull()
    const option = [...card!.querySelectorAll<HTMLInputElement>('input')].find((i) => i.value === 'No')!
    option.checked = true
    option.dispatchEvent(new Event('change', { bubbles: true }))
    expect(submitted(card!)).toEqual({ kind: 'answered', answers: [{ chosen: ['No'] }] })
    // A replayed session that stopped on a question still says so.
    expect(view.querySelector('.working')?.textContent).toBe('Waiting for your answer…')
  })

  it('skipping_a_card_leaves_the_question_unanswered_rather_than_choosing_for_the_user', () => {
    const view = transcript()

    view.reset([{ type: 'user_message', text: 'go' }, ask('r1', 'Storage')])

    const [card] = cards(view)
    let sent: unknown
    card!.addEventListener(QuestionAnsweredEvent.type, (e) => {
      sent = (e as InstanceType<typeof QuestionAnsweredEvent>).outcome
    })
    card!.querySelector<HTMLButtonElement>('button.skip')!.click()
    expect(sent).toEqual({ kind: 'unanswered', reason: 'Skipped by the user' })
  })

  it('the_transcript_reports_an_open_question_until_it_is_resolved', () => {
    const view = transcript()

    view.reset([{ type: 'user_message', text: 'go' }, ask('r1', 'Storage')])
    expect(view.hasOpenQuestion).toBe(true)
    view.apply({ type: 'question_resolved', requestId: 'r1', outcome: { kind: 'unanswered', reason: 'Skipped by the user' } })
    expect(view.hasOpenQuestion).toBe(false)
    expect(cards(view)[0]?.querySelector('.unanswered')?.textContent).toBe('Not answered (skipped by the user).')
    expect(cards(view)[0]?.querySelector('button.skip')).toBeNull()
  })

  it('two_requests_replay_as_two_cards_in_arrival_order_each_answered_on_its_own', () => {
    const view = transcript()

    view.reset([ask('r1', 'Storage'), ask('r2', 'Naming'), answered('r2', 'Yes')])

    const [first, second] = cards(view)
    expect(cards(view).map((c) => headers(c)[0])).toEqual(['Storage', 'Naming'])
    expect(first?.isResolved).toBe(false)
    expect(second?.isResolved).toBe(true)
    expect(second?.querySelector('.answered')?.textContent).toContain('Yes')
    expect(submit(first!)).not.toBeNull()
  })

  it('a_transcript_shown_again_rebuilds_every_card_from_the_log', () => {
    const view = transcript()
    const events: SessionEvent[] = [ask('r1', 'Storage'), answered('r1', 'Yes'), ask('r2', 'Naming')]

    view.reset(events)
    // A tab switch, or a reopened view, replays the same log into the same element.
    view.reset(events)

    expect(cards(view).map((c) => headers(c)[0])).toEqual(['Storage', 'Naming'])
    expect(cards(view).map((c) => c.isResolved)).toEqual([true, false])
  })
})
