import type { SessionEvent } from '../../agent/session/code-session'
import {
  answerText,
  canSubmit,
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
 * One card per question request: a group per question in the order the model
 * asked them, each with its offered choices and a free-text "Other", and one
 * Submit for the card as a whole, or Skip to give no answer at all. Nothing
 * is pre-selected and nothing is answered by time passing; once resolved the
 * card is the record of what was asked and what was answered, and takes no
 * further input.
 */
export class QuestionCard extends HTMLElement {
  private requestId = ''
  private request: UserQuestionRequest = { questions: [] }
  private answers: QuestionAnswer[] = []
  private resolved = false
  private body!: HTMLElement
  private submit!: HTMLButtonElement
  private skip!: HTMLButtonElement
  private hint!: HTMLElement
  private outcomeLine!: HTMLElement

  show(event: QuestionRequest): void {
    this.requestId = event.requestId
    this.request = event.request
    this.answers = event.request.questions.map(() => ({ chosen: [] }))
    this.render()
  }

  /** The request ended: the card keeps what was asked, shows what was answered, and closes. */
  resolve(outcome: QuestionOutcome): void {
    this.resolved = true
    for (const input of this.querySelectorAll('input, textarea')) {
      ;(input as HTMLInputElement | HTMLTextAreaElement).disabled = true
    }
    this.submit.remove()
    this.skip.remove()
    this.hint.remove()
    this.outcomeLine.textContent =
      outcome.kind === 'answered' ? answerText(this.request, outcome.answers) : `Not answered${outcome.reason ? ` (${outcome.reason.toLowerCase()})` : ''}.`
    this.outcomeLine.className = outcome.kind === 'answered' ? 'answered' : 'unanswered'
    this.outcomeLine.hidden = false
    if (outcome.kind === 'answered') this.showSubmitted(outcome.answers)
  }

  get isResolved(): boolean {
    return this.resolved
  }

  private render(): void {
    this.body = document.createElement('div')
    this.body.className = 'questions'
    this.request.questions.forEach((question, index) => this.body.appendChild(this.group(question, index)))
    const actions = document.createElement('div')
    actions.className = 'actions'
    this.submit = document.createElement('button')
    this.submit.type = 'button'
    this.submit.className = 'submit'
    this.submit.textContent = 'Submit'
    this.submit.addEventListener('click', () => this.answer())
    this.skip = document.createElement('button')
    this.skip.type = 'button'
    this.skip.className = 'skip'
    this.skip.textContent = 'Skip'
    this.skip.title = 'Give no answer; the model is told to ask again or work on something else.'
    this.skip.addEventListener('click', () => this.leaveUnanswered())
    this.hint = document.createElement('span')
    this.hint.className = 'missing'
    actions.append(this.submit, this.skip, this.hint)
    this.outcomeLine = document.createElement('p')
    this.outcomeLine.hidden = true
    this.replaceChildren(this.body, actions, this.outcomeLine)
    this.followAnswers()
  }

  private group(question: Question, index: number): HTMLElement {
    const group = document.createElement('section')
    group.className = 'question'
    const header = document.createElement('strong')
    header.className = 'header'
    header.textContent = question.header
    const text = document.createElement('p')
    text.className = 'ask'
    text.textContent = question.question
    group.append(header, text)
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
        const caption = document.createElement('span')
        caption.className = 'label'
        caption.textContent = option.label
        label.append(input, caption)
        item.appendChild(label)
        if (option.explanation) {
          const explanation = document.createElement('span')
          explanation.className = 'explanation'
          explanation.textContent = option.explanation
          item.appendChild(explanation)
        }
        list.appendChild(item)
      }
      group.appendChild(list)
    }
    // Every question takes an answer in the user's own words, whatever it offered.
    const other = document.createElement('label')
    other.className = 'other'
    const otherLabel = document.createElement('span')
    otherLabel.textContent = options.length > 0 ? `${OTHER_LABEL}:` : 'Your answer:'
    const field = document.createElement('textarea')
    field.rows = 2
    field.className = 'other-text'
    field.addEventListener('input', () => this.typed(question, index, field.value))
    other.append(otherLabel, field)
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
      for (const input of this.selectorsFor(index)) input.checked = false
    }
    this.followAnswers()
  }

  private selectorsFor(index: number): HTMLInputElement[] {
    return [...this.querySelectorAll<HTMLInputElement>(`input[name="${this.requestId}-${index}"]`)]
  }

  /** Submit is available only with every question answered, and says which are not. */
  private followAnswers(): void {
    const ready = canSubmit(this.request, this.answers)
    this.submit.disabled = !ready
    this.hint.textContent = missingAnswersMessage(this.request, this.answers)
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

  /** A replayed card shows the answers that were given, not an empty form. */
  private showSubmitted(answers: QuestionAnswer[]): void {
    this.request.questions.forEach((question, index) => {
      const answer = answers[index]
      if (!answer) return
      for (const input of this.selectorsFor(index)) input.checked = answer.chosen.includes(input.value)
      const field = this.body.children[index]?.querySelector('textarea')
      if (field) field.value = answer.other ?? ''
    })
  }
}

customElements.define('question-card', QuestionCard)
