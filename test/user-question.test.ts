import { describe, expect, it } from 'vitest'
import {
  answerText,
  canSubmit,
  isAnswerable,
  missingAnswersMessage,
  normalizeAnswer,
  outcomeText,
  requestProblem,
  UNANSWERED_RESULT,
  type Question,
  type UserQuestionRequest,
} from '../src/agent/session/user-question'

const single: Question = {
  header: 'Storage',
  question: 'Where do answers live?',
  options: [
    { label: 'In the run log', explanation: 'Replayed with the transcript.' },
    { label: 'In memory only' },
  ],
}

const multi: Question = {
  header: 'Engines',
  question: 'Which engines get the tool?',
  options: [{ label: 'Claude' }, { label: 'GLM' }, { label: 'Kimi' }],
  multiSelect: true,
}

const freeTextOnly: Question = { header: 'Name', question: 'What should it be called?' }

const request = (...questions: Question[]): UserQuestionRequest => ({ questions })

describe('user question contract', () => {
  it('a_question_carries_a_header_text_and_options_of_label_and_explanation', () => {
    expect(requestProblem(request(single))).toBeUndefined()
    expect(single.options![0]).toEqual({ label: 'In the run log', explanation: 'Replayed with the transcript.' })
    expect(requestProblem(request({ ...single, header: ' ' }))).toContain('header')
    expect(requestProblem(request({ ...single, question: '' }))).toContain('question text')
    expect(requestProblem({ questions: [] })).toContain('at least one question')
    expect(isAnswerable(request(single, multi))).toBe(true)
  })

  it('a_single_select_question_takes_one_answer_and_a_multi_select_question_takes_several', () => {
    expect(normalizeAnswer(single, { chosen: ['In the run log', 'In memory only'] })).toEqual({ chosen: ['In the run log'] })
    expect(normalizeAnswer(multi, { chosen: ['Claude', 'Kimi'] })).toEqual({ chosen: ['Claude', 'Kimi'] })
    expect(normalizeAnswer(multi, { chosen: ['Claude', 'Perl'] })).toEqual({ chosen: ['Claude'] })
  })

  it('free_text_answers_a_question_whatever_options_it_offered', () => {
    expect(canSubmit(request(single), [{ chosen: [], other: 'Somewhere else' }])).toBe(true)
    expect(canSubmit(request(multi), [{ chosen: [], other: 'None of them' }])).toBe(true)
    expect(answerText(request(single), [{ chosen: [], other: 'Somewhere else' }])).toContain("Other (the user's own words): Somewhere else")
  })

  it('a_multi_select_answer_returns_every_chosen_option_and_the_free_text_together', () => {
    const text = answerText(request(multi), [{ chosen: ['Claude', 'GLM'], other: 'and any engine added later' }])
    expect(text).toContain('Chose: Claude, GLM')
    expect(text).toContain("Other (the user's own words): and any engine added later")
  })

  it('free_text_on_a_single_select_question_is_the_answer_and_no_option_is_reported_as_chosen', () => {
    const answer = normalizeAnswer(single, { chosen: ['In the run log'], other: 'On disk, next to the spec' })
    expect(answer).toEqual({ chosen: [], other: 'On disk, next to the spec' })
    const text = answerText(request(single), [{ chosen: ['In the run log'], other: 'On disk, next to the spec' }])
    expect(text).not.toContain('Chose:')
    expect(text).toContain("Other (the user's own words): On disk, next to the spec")
  })

  it('a_question_with_no_options_is_free_text_only_and_needs_non_empty_text_to_submit', () => {
    expect(requestProblem(request(freeTextOnly))).toBeUndefined()
    expect(freeTextOnly.options).toBeUndefined()
    expect(canSubmit(request(freeTextOnly), [{ chosen: [], other: '   ' }])).toBe(false)
    expect(canSubmit(request(freeTextOnly), [{ chosen: [], other: 'Ask User' }])).toBe(true)
  })

  it('submit_needs_an_answer_to_every_question_and_says_which_are_missing', () => {
    const card = request(single, multi, freeTextOnly)
    expect(canSubmit(card, [{ chosen: ['In the run log'] }, { chosen: [] }, { chosen: [] }])).toBe(false)
    expect(missingAnswersMessage(card, [{ chosen: ['In the run log'] }, { chosen: [] }, { chosen: [] }])).toBe(
      'Answer Engines, Name to submit.',
    )
    const full = [{ chosen: ['In the run log'] }, { chosen: ['GLM'] }, { chosen: [], other: 'Ask User' }]
    expect(canSubmit(card, full)).toBe(true)
    expect(missingAnswersMessage(card, full)).toBe('')
  })

  it('nothing_is_answered_on_the_users_behalf_and_an_unanswered_request_says_so', () => {
    expect(canSubmit(request(single), [{ chosen: [] }])).toBe(false)
    expect(normalizeAnswer(single, { chosen: [] })).toEqual({ chosen: [] })
    expect(outcomeText(request(single), { kind: 'unanswered' })).toBe(UNANSWERED_RESULT)
    expect(UNANSWERED_RESULT).toContain('none may be assumed')
  })
})
