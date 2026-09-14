/**
 * A question a session puts to the person running it, in domain terms: the
 * request the model makes, the answer the person gives, and the pure rules
 * both the card and the engines need. Nothing here knows about a tool, an
 * engine or the DOM, so the card and both engines agree on what an answered
 * question is.
 */

/** One offered choice. The explanation is a single line shown under the label. */
export type QuestionOption = { label: string; explanation?: string }

export type Question = {
  /** Short header for the card, a few words. */
  header: string
  /** The question itself, as the user reads it. */
  question: string
  /** Offered choices; a question with none is free text only. */
  options?: QuestionOption[]
  /** One or more answers may be chosen; a question without this takes exactly one. */
  multiSelect?: boolean
}

/** One call of the question tool: one card, one or more questions. */
export type UserQuestionRequest = { questions: Question[] }

/** What the user submitted for one question: the options chosen, plus free text under "Other". */
export type QuestionAnswer = { chosen: string[]; other?: string }

/** How a request ended. A request has exactly one outcome and never none. */
export type QuestionOutcome = { kind: 'answered'; answers: QuestionAnswer[] } | { kind: 'unanswered'; reason?: string }

/** What the model is told when the user did not answer; never a choice made for them. */
export const UNANSWERED_RESULT =
  'The user did not answer the question. No answer was given, and none may be assumed: say what you need and stop, or work on something that does not depend on it.'

/** The free text is reported as its own answer, so an invented choice is never mistaken for an offered one. */
export const OTHER_LABEL = 'Other'

/** Why the request cannot be put to the user, or nothing when it can. */
export function requestProblem(request: UserQuestionRequest): string | undefined {
  const questions = request.questions
  if (!Array.isArray(questions) || questions.length === 0) return 'A question request needs at least one question.'
  for (const [index, question] of questions.entries()) {
    const at = `Question ${index + 1}`
    if (!question.header?.trim()) return `${at} has no header.`
    if (!question.question?.trim()) return `${at} has no question text.`
    for (const option of question.options ?? []) {
      if (!option.label?.trim()) return `${at} has an option without a label.`
    }
  }
  return undefined
}

export const isAnswerable = (request: UserQuestionRequest): boolean => requestProblem(request) === undefined

/** A question is answered by a chosen option or by non-empty free text; nothing is answered on the user's behalf. */
export function isAnswered(answer: QuestionAnswer | undefined): boolean {
  if (!answer) return false
  return answer.chosen.some((c) => c.trim() !== '') || (answer.other ?? '').trim() !== ''
}

/**
 * Cleans one answer to what the question allows: labels the question never
 * offered are dropped, and a single-select question takes one answer — free
 * text when it was typed, else the first option chosen.
 */
export function normalizeAnswer(question: Question, answer: QuestionAnswer): QuestionAnswer {
  const offered = new Set((question.options ?? []).map((o) => o.label))
  const chosen = answer.chosen.filter((label) => offered.has(label))
  const other = (answer.other ?? '').trim()
  if (question.multiSelect) return other ? { chosen, other } : { chosen }
  if (other) return { chosen: [], other }
  return { chosen: chosen.slice(0, 1) }
}

/** The headers of the questions still without an answer, in order; empty means the card may be submitted. */
export function unansweredQuestions(request: UserQuestionRequest, answers: QuestionAnswer[]): string[] {
  return request.questions.filter((_, i) => !isAnswered(answers[i])).map((q) => q.header)
}

/** B16: Submit is possible only when every question has an answer. */
export const canSubmit = (request: UserQuestionRequest, answers: QuestionAnswer[]): boolean =>
  unansweredQuestions(request, answers).length === 0

/** What is still missing, for the card to say why Submit is not available. */
export function missingAnswersMessage(request: UserQuestionRequest, answers: QuestionAnswer[]): string {
  const missing = unansweredQuestions(request, answers)
  if (missing.length === 0) return ''
  return `Answer ${missing.join(', ')} to submit.`
}

/**
 * The answers as the model reads them: one block per question, the options the
 * user chose named as they were offered and free text named as the user's own,
 * so an invented answer is never taken for an offered one.
 */
export function answerText(request: UserQuestionRequest, answers: QuestionAnswer[]): string {
  return request.questions
    .map((question, index) => {
      const answer = normalizeAnswer(question, answers[index] ?? { chosen: [] })
      const lines = [`${question.header}: ${question.question}`]
      if (answer.chosen.length > 0) lines.push(`Chose: ${answer.chosen.join(', ')}`)
      const other = (answer.other ?? '').trim()
      if (other) lines.push(`${OTHER_LABEL} (the user's own words): ${other}`)
      if (answer.chosen.length === 0 && !other) lines.push('Not answered.')
      return lines.join('\n')
    })
    .join('\n\n')
}

/** The outcome as the model reads it, whichever of the two it is. */
export const outcomeText = (request: UserQuestionRequest, outcome: QuestionOutcome): string =>
  outcome.kind === 'answered' ? answerText(request, outcome.answers) : UNANSWERED_RESULT
