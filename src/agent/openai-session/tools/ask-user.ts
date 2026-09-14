import { z } from 'zod'
import { answerText, requestProblem, UNANSWERED_RESULT, type UserQuestionRequest } from '../../session/user-question'
import { fail, ok, type Tool, type ToolOutput } from './tool'

/**
 * The question tool, written once and served to every engine, so a model's
 * behaviour does not change with the engine behind it. The call blocks until
 * the person answers or declines: there is no deadline and no default, because
 * an answer nobody gave is worse than a wait.
 */
const optionSchema = z.object({
  label: z.string().min(1).describe('The choice as the user reads it, a few words.'),
  explanation: z.string().optional().describe('One line on what choosing this means.'),
})

const questionSchema = z.object({
  header: z.string().min(1).describe('Short header for this question on the card, a few words.'),
  question: z.string().min(1).describe('The question itself, in the language the user uses.'),
  options: z.array(optionSchema).optional().describe('The choices you offer. Leave it out for a question only free text can answer.'),
  multiSelect: z.boolean().optional().describe('True when several options may be chosen together. Default: exactly one.'),
})

export const askUserSchema = z.object({
  questions: z.array(questionSchema).min(1).describe('One or more questions, shown together as one card and answered in one go.'),
})

export const ASK_USER_TOOL = 'AskUser'

export const askUserTool: Tool<typeof askUserSchema> = {
  name: ASK_USER_TOOL,
  description: [
    'Ask the person running this session a question you cannot answer yourself, and wait for their answer.',
    'Use it for a decision only they can make — what the feature should do, which of two ways to take, what their intent is — not for anything you can find out by reading the code or the docs.',
    'Offer the choices you see, each with a one-line explanation; the user may also answer in their own words, so never fabricate an answer when none comes.',
    'Put every question you have into one call: they are shown as one card and answered together.',
  ].join(' '),
  schema: askUserSchema,
  // Asking is not a change to anything; it is answered by the card, not by a permission prompt.
  readOnly: true,
  async execute(input, ctx): Promise<ToolOutput> {
    // The schema's optionals are absent, not undefined, in the request the card and the log see.
    const request: UserQuestionRequest = {
      questions: input.questions.map((q) => ({
        header: q.header,
        question: q.question,
        ...(q.options
          ? { options: q.options.map((o) => ({ label: o.label, ...(o.explanation === undefined ? {} : { explanation: o.explanation }) })) }
          : {}),
        ...(q.multiSelect === undefined ? {} : { multiSelect: q.multiSelect }),
      })),
    }
    const problem = requestProblem(request)
    if (problem) return fail(problem)
    if (!ctx.ask) {
      return fail(`${ASK_USER_TOOL} is not available in this session: nobody sees its output, so there is nobody to ask. Report what you could not settle in your result instead.`)
    }
    const outcome = await ctx.ask(request)
    return outcome.kind === 'answered' ? ok(answerText(request, outcome.answers)) : ok(UNANSWERED_RESULT)
  },
}
