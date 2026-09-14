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
    // Nobody is working while the card waits, so no clock runs.
    expect(view.querySelector('.working')).toBeNull()
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
