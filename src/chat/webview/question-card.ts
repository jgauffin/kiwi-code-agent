import { compileTemplate } from '@relax.js/core/html'
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

type OptionRow = { label: string; explanation: string; checked: boolean }

type QuestionRow = {
  index: number
  header: string
  ask: string
  hidden: boolean
  hasOptions: boolean
  inputType: string
  name: string
  otherLabel: string
  options: OptionRow[]
}

type SummaryRow = { header: string; ask: string; answer: string; answered: boolean }

/**
 * One card per question request, asked one question at a time in the order
 * the model asked them: each with its offered choices and a free-text "Other",
 * Next once it is answered, Submit on the last, or Skip to give no answer at
 * all. Nothing is pre-selected and nothing is answered by time passing; once
 * resolved the form gives way to each question and its answer as text.
 */
export class QuestionCard extends HTMLElement {
  /**
   * The free-text fields carry no `value` binding: a render would write the
   * property back and move the caret of the field being typed in. Their text
   * lives in `answers` instead, read from the DOM only as it is typed.
   */
  private readonly template = compileTemplate(`
    <div class="questions">
      <section loop="q in questions" class="question" hidden="{{q.hidden}}">
        <strong class="header">{{q.header}}</strong>
        <p class="ask">{{q.ask}}</p>
        <ul class="options" if="q.hasOptions">
          <li loop="o in q.options">
            <label>
              <input type="{{q.inputType}}" name="{{q.name}}" value="{{o.label}}" checked="{{o.checked}}" r-change="chose(q, o, event)">
              <span class="label">{{o.label}}</span>
            </label>
            <span class="explanation" if="o.explanation">{{o.explanation}}</span>
          </li>
        </ul>
        <label class="other">
          <span>{{q.otherLabel}}</span>
          <textarea rows="2" class="other-text" r-input="typed(q, event)"></textarea>
        </label>
      </section>
    </div>
    <div class="actions">
      <span class="step" if="multi">{{step}}</span>
      <button type="button" class="back" hidden="{{backHidden}}" r-click="back()">Back</button>
      <button type="button" class="next" hidden="{{nextHidden}}" disabled="{{nextDisabled}}" r-click="next()">Next</button>
      <button type="button" class="submit" hidden="{{submitHidden}}" disabled="{{submitDisabled}}" r-click="answer()">Submit</button>
      <button type="button" class="skip" title="Give no answer; the model is told to ask again or work on something else." r-click="skip()">Skip</button>
      <span class="missing">{{missing}}</span>
    </div>
  `)
  private requestId = ''
  private request: UserQuestionRequest = { questions: [] }
  private answers: QuestionAnswer[] = []
  private current = 0
  private resolved = false

  show(event: QuestionRequest): void {
    this.requestId = event.requestId
    this.request = event.request
    this.answers = event.request.questions.map(() => ({ chosen: [] }))
    this.current = 0
    if (this.childElementCount === 0) this.appendChild(this.template.content)
    this.render()
  }

  /** The request ended: the card becomes the record of what was asked and what was answered. */
  resolve(outcome: QuestionOutcome): void {
    this.resolved = true
    const summary = compileTemplate(`
      <div class="{{kind}}">
        <section loop="r in rows" class="question">
          <strong class="header">{{r.header}}</strong>
          <p class="ask">{{r.ask}}</p>
          <p class="answer" if="r.answered">{{r.answer}}</p>
        </section>
      </div>
      <p class="unanswered" if="unanswered">{{unansweredText}}</p>
    `)
    const answered = outcome.kind === 'answered'
    const rows: SummaryRow[] = this.request.questions.map((question, index) => ({
      header: question.header,
      ask: question.question,
      answer: answered ? answerLine(question, outcome.answers[index]) : '',
      answered,
    }))
    const reason = !answered && outcome.reason ? ` (${outcome.reason.toLowerCase()})` : ''
    summary.render({
      kind: answered ? 'answered' : 'asked',
      rows,
      unanswered: !answered,
      unansweredText: `Not answered${reason}.`,
    })
    this.replaceChildren(summary.content)
  }

  get isResolved(): boolean {
    return this.resolved
  }

  private render(): void {
    const questions: QuestionRow[] = this.request.questions.map((question, index) => {
      const options = question.options ?? []
      const chosen = this.answers[index]?.chosen ?? []
      return {
        index,
        header: question.header,
        ask: question.question,
        hidden: index !== this.current,
        hasOptions: options.length > 0,
        inputType: question.multiSelect ? 'checkbox' : 'radio',
        name: `${this.requestId}-${index}`,
        otherLabel: options.length > 0 ? `${OTHER_LABEL}:` : 'Your answer:',
        options: options.map((option) => ({
          label: option.label,
          explanation: option.explanation ?? '',
          checked: chosen.includes(option.label),
        })),
      }
    })
    const count = questions.length
    const last = this.current === count - 1
    this.template.render(
      {
        questions,
        multi: count > 1,
        step: `${this.current + 1} of ${count}`,
        backHidden: this.current === 0,
        nextHidden: last,
        nextDisabled: !isAnswered(this.answers[this.current]),
        submitHidden: !last,
        submitDisabled: !canSubmit(this.request, this.answers),
        missing: last ? missingAnswersMessage(this.request, this.answers) : '',
      },
      {
        chose: (q: QuestionRow, o: OptionRow, event: Event) => this.chose(q.index, o.label, (event.target as HTMLInputElement).checked),
        typed: (q: QuestionRow, event: Event) => this.typed(q.index, (event.target as HTMLTextAreaElement).value),
        back: () => this.goTo(this.current - 1),
        next: () => this.goTo(this.current + 1),
        answer: () => this.answer(),
        skip: () => this.leaveUnanswered(),
      },
    )
  }

  private goTo(index: number): void {
    if (index < 0 || index >= this.request.questions.length) return
    this.current = index
    this.render()
  }

  private chose(index: number, label: string, checked: boolean): void {
    const question = this.request.questions[index]
    if (!question) return
    const answer = this.answers[index] ?? { chosen: [] }
    const chosen = question.multiSelect
      ? checked
        ? [...answer.chosen, label]
        : answer.chosen.filter((c) => c !== label)
      : [label]
    this.answers[index] = { ...answer, chosen }
    this.render()
  }

  private typed(index: number, text: string): void {
    const question = this.request.questions[index]
    if (!question) return
    const answer = this.answers[index] ?? { chosen: [] }
    this.answers[index] = { ...answer, other: text }
    // On a question that takes one answer, words of the user's own replace the choice they were offered.
    if (!question.multiSelect && text.trim() !== '' && answer.chosen.length > 0) this.answers[index] = { chosen: [], other: text }
    this.render()
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

customElements.define('question-card', QuestionCard)
