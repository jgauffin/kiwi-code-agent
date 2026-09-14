// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { QuestionCard } from '../src/chat/webview/question-card'
import { QuestionAnsweredEvent } from '../src/chat/webview/events'
import type { SessionEvent } from '../src/agent/session/code-session'
import type { QuestionOutcome, UserQuestionRequest } from '../src/agent/session/user-question'

type QuestionRequest = Extract<SessionEvent, { type: 'question_request' }>

function cardFor(request: UserQuestionRequest, requestId = 'r1'): QuestionCard {
  const card = new QuestionCard()
  document.body.appendChild(card)
  card.show({ type: 'question_request', requestId, request } as QuestionRequest)
  return card
}

/** What the card would send if Submit were pressed, or undefined when it refuses. */
function submitted(card: QuestionCard): QuestionOutcome | undefined {
  let outcome: QuestionOutcome | undefined
  card.addEventListener(QuestionAnsweredEvent.type, (e) => {
    outcome = (e as QuestionAnsweredEvent).outcome
  })
  submitButton(card)?.click()
  return outcome
}

const submitButton = (card: QuestionCard) => card.querySelector<HTMLButtonElement>('button.submit')
const groups = (card: QuestionCard) => [...card.querySelectorAll<HTMLElement>('section.question')]
const hint = (card: QuestionCard) => card.querySelector<HTMLElement>('.missing')?.textContent ?? ''

function choose(card: QuestionCard, group: number, label: string): void {
  const input = [...(groups(card)[group]?.querySelectorAll<HTMLInputElement>('input') ?? [])].find((i) => i.value === label)
  if (!input) throw new Error(`No option ${label}`)
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function type(card: QuestionCard, group: number, text: string): void {
  const field = groups(card)[group]?.querySelector('textarea')
  if (!field) throw new Error('No free-text field')
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('the question card', () => {
  it('one_card_per_request_shows_a_group_per_question_in_the_order_asked_under_one_submit', () => {
    const card = cardFor({
      questions: [
        { header: 'Storage', question: 'Where do orders live?', options: [{ label: 'SQL', explanation: 'One database' }, { label: 'Files' }] },
        { header: 'Naming', question: 'What do we call it?', options: [{ label: 'Order' }, { label: 'Ticket' }], multiSelect: true },
      ],
    })

    const [first, second] = groups(card)
    expect(groups(card)).toHaveLength(2)
    expect(first?.querySelector('.header')?.textContent).toBe('Storage')
    expect(first?.querySelector('.ask')?.textContent).toBe('Where do orders live?')
    expect([...(first?.querySelectorAll('.label') ?? [])].map((l) => l.textContent)).toEqual(['SQL', 'Files'])
    expect(first?.querySelector('.explanation')?.textContent).toBe('One database')
    expect(second?.querySelector('.header')?.textContent).toBe('Naming')
    // Single-select takes one answer, multi-select several; every question also takes words of the user's own.
    expect(first?.querySelector('input')?.type).toBe('radio')
    expect(second?.querySelector('input')?.type).toBe('checkbox')
    expect(groups(card).every((g) => g.querySelector('textarea') !== null)).toBe(true)
    expect(card.querySelectorAll('button.submit')).toHaveLength(1)
  })

  it('submit_needs_an_answer_to_every_question_and_says_which_are_missing', () => {
    const card = cardFor({
      questions: [
        { header: 'Storage', question: 'Where?', options: [{ label: 'SQL' }] },
        { header: 'Naming', question: 'What?', options: [{ label: 'Order' }] },
      ],
    })

    // Nothing is chosen for the user, so nothing can be submitted yet.
    expect(submitButton(card)?.disabled).toBe(true)
    expect(hint(card)).toBe('Answer Storage, Naming to submit.')
    expect(submitted(card)).toBeUndefined()

    choose(card, 0, 'SQL')
    expect(submitButton(card)?.disabled).toBe(true)
    expect(hint(card)).toBe('Answer Naming to submit.')

    choose(card, 1, 'Order')
    expect(submitButton(card)?.disabled).toBe(false)
    expect(hint(card)).toBe('')
  })

  it('a_multi_select_answer_submits_every_chosen_option_and_the_free_text_together', () => {
    const card = cardFor({
      questions: [{ header: 'Engines', question: 'Which?', options: [{ label: 'Claude' }, { label: 'GLM' }, { label: 'Kimi' }], multiSelect: true }],
    })

    choose(card, 0, 'Claude')
    choose(card, 0, 'Kimi')
    type(card, 0, 'and whatever Berget adds')

    expect(submitted(card)).toEqual({
      kind: 'answered',
      answers: [{ chosen: ['Claude', 'Kimi'], other: 'and whatever Berget adds' }],
    })
  })

  it('free_text_on_a_single_select_question_is_the_answer_and_no_option_is_reported_as_chosen', () => {
    const card = cardFor({ questions: [{ header: 'Storage', question: 'Where?', options: [{ label: 'SQL' }, { label: 'Files' }] }] })

    choose(card, 0, 'SQL')
    type(card, 0, 'In the run log')

    expect(submitted(card)).toEqual({ kind: 'answered', answers: [{ chosen: [], other: 'In the run log' }] })
    expect([...card.querySelectorAll<HTMLInputElement>('input')].some((i) => i.checked)).toBe(false)
  })

  it('a_question_with_no_options_is_free_text_only_and_needs_non_empty_text_to_submit', () => {
    const card = cardFor({ questions: [{ header: 'Name', question: 'What should it be called?' }] })

    expect(card.querySelectorAll('input')).toHaveLength(0)
    expect(card.querySelector('textarea')).not.toBeNull()
    expect(submitButton(card)?.disabled).toBe(true)

    type(card, 0, '   ')
    expect(submitButton(card)?.disabled).toBe(true)

    type(card, 0, 'KiwiAgent')
    expect(submitButton(card)?.disabled).toBe(false)
    expect(submitted(card)).toEqual({ kind: 'answered', answers: [{ chosen: [], other: 'KiwiAgent' }] })
  })

  it('a_resolved_card_keeps_what_was_asked_and_answered_and_takes_no_further_input', () => {
    const request: UserQuestionRequest = {
      questions: [{ header: 'Storage', question: 'Where?', options: [{ label: 'SQL' }, { label: 'Files' }] }],
    }
    const answered = cardFor(request)

    answered.resolve({ kind: 'answered', answers: [{ chosen: ['SQL'] }] })

    expect(answered.isResolved).toBe(true)
    expect(submitButton(answered)).toBeNull()
    expect(submitted(answered)).toBeUndefined()
    expect(answered.querySelector('.header')?.textContent).toBe('Storage')
    expect(answered.querySelector('.answered')?.textContent).toContain('SQL')
    expect([...answered.querySelectorAll<HTMLInputElement>('input')].every((i) => i.disabled)).toBe(true)
    expect([...answered.querySelectorAll<HTMLInputElement>('input')].find((i) => i.value === 'SQL')?.checked).toBe(true)

    const cancelled = cardFor(request, 'r2')
    cancelled.resolve({ kind: 'unanswered', reason: 'Interrupted' })

    expect(cancelled.querySelector('.unanswered')?.textContent).toBe('Not answered.')
    expect(submitted(cancelled)).toBeUndefined()
    expect([...cancelled.querySelectorAll<HTMLTextAreaElement>('textarea')].every((f) => f.disabled)).toBe(true)
  })
})
