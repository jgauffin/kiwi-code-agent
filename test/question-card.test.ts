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
const visible = (card: QuestionCard) => groups(card).filter((g) => !g.hidden).map((g) => g.querySelector('.header')?.textContent)
const shown = (card: QuestionCard) => [...card.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.hidden).map((b) => b.textContent)
const button = (card: QuestionCard, className: string) => card.querySelector<HTMLButtonElement>(`button.${className}`)!

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
  const twoQuestions: UserQuestionRequest = {
    questions: [
      { header: 'Storage', question: 'Where do orders live?', options: [{ label: 'SQL', explanation: 'One database' }, { label: 'Files' }] },
      { header: 'Naming', question: 'What do we call it?', options: [{ label: 'Order' }, { label: 'Ticket' }], multiSelect: true },
    ],
  }

  it('several_questions_are_asked_one_at_a_time_in_the_order_asked', () => {
    const card = cardFor(twoQuestions)

    const [first, second] = groups(card)
    expect(visible(card)).toEqual(['Storage'])
    expect(card.querySelector('.step')?.textContent).toBe('1 of 2')
    expect(first?.querySelector('.ask')?.textContent).toBe('Where do orders live?')
    expect([...(first?.querySelectorAll('.label') ?? [])].map((l) => l.textContent)).toEqual(['SQL', 'Files'])
    expect(first?.querySelector('.explanation')?.textContent).toBe('One database')
    // Single-select takes one answer, multi-select several; every question also takes words of the user's own.
    expect(first?.querySelector('input')?.type).toBe('radio')
    expect(second?.querySelector('input')?.type).toBe('checkbox')
    expect(groups(card).every((g) => g.querySelector('textarea') !== null)).toBe(true)
    expect(shown(card)).toEqual(['Next', 'Skip'])
  })

  it('next_needs_the_current_question_answered_and_back_keeps_what_was_answered', () => {
    const card = cardFor(twoQuestions)

    // Nothing is chosen for the user, so there is no moving on yet.
    expect(button(card, 'next').disabled).toBe(true)
    choose(card, 0, 'SQL')
    expect(button(card, 'next').disabled).toBe(false)

    button(card, 'next').click()
    expect(visible(card)).toEqual(['Naming'])
    expect(card.querySelector('.step')?.textContent).toBe('2 of 2')
    expect(shown(card)).toEqual(['Back', 'Submit', 'Skip'])
    expect(submitButton(card)?.disabled).toBe(true)

    button(card, 'back').click()
    expect(visible(card)).toEqual(['Storage'])
    expect(groups(card)[0]?.querySelector<HTMLInputElement>('input[value="SQL"]')?.checked).toBe(true)

    button(card, 'next').click()
    choose(card, 1, 'Order')
    expect(submitted(card)).toEqual({ kind: 'answered', answers: [{ chosen: ['SQL'] }, { chosen: ['Order'] }] })
  })

  it('a_single_question_has_no_steps_only_submit_and_skip', () => {
    const card = cardFor({ questions: [{ header: 'Storage', question: 'Where?', options: [{ label: 'SQL' }] }] })

    expect(card.querySelector('.step')).toBeNull()
    expect(shown(card)).toEqual(['Submit', 'Skip'])
    expect(submitButton(card)?.disabled).toBe(true)
    choose(card, 0, 'SQL')
    expect(submitButton(card)?.disabled).toBe(false)
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

  it('a_resolved_card_is_replaced_by_each_question_and_its_answer_as_text', () => {
    const request: UserQuestionRequest = {
      questions: [
        { header: 'Storage', question: 'Where?', options: [{ label: 'SQL' }, { label: 'Files' }] },
        { header: 'Engines', question: 'Which?', options: [{ label: 'Claude' }, { label: 'GLM' }], multiSelect: true },
      ],
    }
    const answered = cardFor(request)

    answered.resolve({ kind: 'answered', answers: [{ chosen: ['SQL'] }, { chosen: ['Claude', 'GLM'], other: 'and Kimi' }] })

    expect(answered.isResolved).toBe(true)
    expect(answered.querySelectorAll('input, textarea, button')).toHaveLength(0)
    expect(submitted(answered)).toBeUndefined()
    const rows = [...answered.querySelectorAll('.answered .question')].map((q) => [
      q.querySelector('.header')?.textContent,
      q.querySelector('.ask')?.textContent,
      q.querySelector('.answer')?.textContent,
    ])
    expect(rows).toEqual([
      ['Storage', 'Where?', 'SQL'],
      ['Engines', 'Which?', 'Claude, GLM, and Kimi'],
    ])

    const cancelled = cardFor(request, 'r2')
    cancelled.resolve({ kind: 'unanswered', reason: 'Interrupted' })

    expect(cancelled.querySelector('.unanswered')?.textContent).toBe('Not answered (interrupted).')
    expect([...cancelled.querySelectorAll('.ask')].map((a) => a.textContent)).toEqual(['Where?', 'Which?'])
    expect(cancelled.querySelectorAll('input, textarea, button')).toHaveLength(0)
  })
})
