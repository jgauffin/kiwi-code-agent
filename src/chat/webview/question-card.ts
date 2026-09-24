import type { SessionEvent } from '../../agent/session/code-session'
import {
  canSubmit,
  isAnswered,
  missingAnswersMessage,
  normalizeAnswer,
  OTHER_LABEL,
  type Question,
  type QuestionAnswer,
  type QuestionOutcome,
  type UserQuestionRequest,
} from '../../agent/session/user-question'
import { ASK_USER_TOOL } from '../../agent/openai-session/tools/ask-user'
import { QuestionAnsweredEvent } from './events'

type QuestionRequest = Extract<SessionEvent, { type: 'question_request' }>

/** The engine prefixes its own tools; the card answers for the question tool under either name. */
export const isQuestionTool = (name: string): boolean => name === ASK_USER_TOOL || name.endsWith(`__${ASK_USER_TOOL}`)

/**
 * One card per question request, asked one question at a time in the order
 * the model asked them: each with its offered choices and a free-text "Other",
 * Next once it is answered, Submit on the last, or Skip to give no answer at
 * all. Nothing is pre-selected and nothing is answered by time passing; once
 * resolved the form gives way to each question and its answer as text.
 */
export class QuestionCard extends HTMLElement {
  private requestId = ''
  private request: UserQuestionRequest = { questions: [] }
  private answers: QuestionAnswer[] = []
  private current = 0
  private resolved = false
  private groups: HTMLElement[] = []
  private step!: HTMLElement
  private back!: HTMLButtonElement
  private next!: HTMLButtonElement
  private submit!: HTMLButtonElement
  private hint!: HTMLElement

  show(event: QuestionRequest): void {
    this.requestId = event.requestId
    this.request = event.request
    this.answers = event.request.questions.map(() => ({ chosen: [] }))
    this.current = 0
    this.render()
  }

  /** The request ended: the card becomes the record of what was asked and what was answered. */
  resolve(outcome: QuestionOutcome): void {
    this.resolved = true
    const summary = document.createElement('div')
    summary.className = outcome.kind === 'answered' ? 'answered' : 'asked'
    this.request.questions.forEach((question, index) => {
      const row = document.createElement('section')
      row.className = 'question'
      row.append(text('strong', 'header', question.header), text('p', 'ask', question.question))
      if (outcome.kind === 'answered') row.appendChild(text('p', 'answer', answerLine(question, outcome.answers[index])))
      summary.appendChild(row)
    })
    if (outcome.kind === 'answered') return this.replaceChildren(summary)
    const reason = text('p', 'unanswered', `Not answered${outcome.reason ? ` (${outcome.reason.toLowerCase()})` : ''}.`)
    this.replaceChildren(summary, reason)
  }

  get isResolved(): boolean {
    return this.resolved
  }

  private render(): void {
    const body = document.createElement('div')
    body.className = 'questions'
    this.groups = this.request.questions.map((question, index) => this.group(question, index))
    body.append(...this.groups)
    const actions = document.createElement('div')
    actions.className = 'actions'
    this.step = text('span', 'step')
    this.back = button('back', 'Back', () => this.goTo(this.current - 1))
    this.next = button('next', 'Next', () => this.goTo(this.current + 1))
    this.submit = button('submit', 'Submit', () => this.answer())
    const skip = button('skip', 'Skip', () => this.leaveUnanswered())
    skip.title = 'Give no answer; the model is told to ask again or work on something else.'
    this.hint = text('span', 'missing')
    actions.append(this.back, this.next, this.submit, skip, this.hint)
    if (this.groups.length > 1) actions.prepend(this.step)
    this.replaceChildren(body, actions)
    this.goTo(0)
  }

  private goTo(index: number): void {
    if (index < 0 || index >= this.groups.length) return
    this.current = index
    this.groups.forEach((group, i) => (group.hidden = i !== index))
    this.step.textContent = `${index + 1} of ${this.groups.length}`
    this.followAnswers()
  }

  private group(question: Question, index: number): HTMLElement {
    const group = document.createElement('section')
    group.className = 'question'
    group.append(text('strong', 'header', question.header), text('p', 'ask', question.question))
    const options = question.options ?? []
    if (options.length > 0) {
      const list = document.createElement('ul')
      list.className = 'options'
      for (const option of options) {
        const item = document.createElement('li')
        const label = document.createElement('label')
        const input = document.createElement('input')
        input.type = question.multiSelect ? 'checkbox' : 'radio'
        input.name = `${this.requestId}-${index}`
        input.value = option.label
        input.addEventListener('change', () => this.chose(question, index, option.label, input.checked))
        label.append(input, text('span', 'label', option.label))
        item.appendChild(label)
        if (option.explanation) item.appendChild(text('span', 'explanation', option.explanation))
        list.appendChild(item)
      }
      group.appendChild(list)
    }
    // Every question takes an answer in the user's own words, whatever it offered.
    const other = document.createElement('label')
    other.className = 'other'
    const field = document.createElement('textarea')
    field.rows = 2
    field.className = 'other-text'
    field.addEventListener('input', () => this.typed(question, index, field.value))
    other.append(text('span', '', options.length > 0 ? `${OTHER_LABEL}:` : 'Your answer:'), field)
    group.appendChild(other)
    return group
  }

  private chose(question: Question, index: number, label: string, checked: boolean): void {
    const answer = this.answers[index] ?? { chosen: [] }
    const chosen = question.multiSelect
      ? checked
        ? [...answer.chosen, label]
        : answer.chosen.filter((c) => c !== label)
      : [label]
    this.answers[index] = { ...answer, chosen }
    this.followAnswers()
  }

  private typed(question: Question, index: number, text: string): void {
    const answer = this.answers[index] ?? { chosen: [] }
    this.answers[index] = { ...answer, other: text }
    // On a question that takes one answer, words of the user's own replace the choice they were offered.
    if (!question.multiSelect && text.trim() !== '' && answer.chosen.length > 0) {
      this.answers[index] = { chosen: [], other: text }
      for (const input of this.groups[index]?.querySelectorAll('input') ?? []) input.checked = false
    }
    this.followAnswers()
  }

  /** Next waits for the question on screen; Submit, on the last, for every question, and says which are not. */
  private followAnswers(): void {
    const last = this.current === this.groups.length - 1
    this.back.hidden = this.current === 0
    this.next.hidden = last
    this.next.disabled = !isAnswered(this.answers[this.current])
    this.submit.hidden = !last
    this.submit.disabled = !canSubmit(this.request, this.answers)
    this.hint.textContent = last ? missingAnswersMessage(this.request, this.answers) : ''
  }

  private answer(): void {
    if (this.resolved || !canSubmit(this.request, this.answers)) return
    const answers = this.request.questions.map((q, i) => normalizeAnswer(q, this.answers[i] ?? { chosen: [] }))
    this.dispatchEvent(new QuestionAnsweredEvent(this.requestId, { kind: 'answered', answers }))
  }

  private leaveUnanswered(): void {
    if (this.resolved) return
    this.dispatchEvent(new QuestionAnsweredEvent(this.requestId, { kind: 'unanswered', reason: 'Skipped by the user' }))
  }
}

/** One answer as a line: the options chosen, then the user's own words. */
function answerLine(question: Question, answer: QuestionAnswer | undefined): string {
  const { chosen, other } = normalizeAnswer(question, answer ?? { chosen: [] })
  const parts = [...chosen, ...(other ? [other] : [])]
  return parts.length ? parts.join(', ') : 'Not answered.'
}

function text(tag: string, className: string, content?: string): HTMLElement {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (content !== undefined) element.textContent = content
  return element
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.textContent = label
  element.addEventListener('click', onClick)
  return element
}

customElements.define('question-card', QuestionCard)
