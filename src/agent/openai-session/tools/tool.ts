import { z } from 'zod'
import type { ToolDefinition } from '../chat-messages'
import type { ReadTracker } from './read-tracker'
import type { QuestionOutcome, UserQuestionRequest } from '../../session/user-question'
import type { FileEditChange } from '../../edits/file-edit-diff'

/**
 * How a tool reaches the person running the session. The engine supplies it;
 * the wait is open-ended, so the promise settles only when the request is
 * answered or goes unanswered. A session with no user to reach has no asker.
 */
export type QuestionAsker = (request: UserQuestionRequest) => Promise<QuestionOutcome>

export type ToolContext = {
  cwd: string
  signal: AbortSignal
  files: ReadTracker
  /** Absent in a session whose user never sees its transcript; the question tool then has nobody to ask. */
  ask?: QuestionAsker
  /** Runs another tool as if the model had called it: same permission gate, same result. Absent where tools cannot call tools. */
  call?: (name: string, input: unknown) => Promise<ToolOutput>
  /** The reason a call is refused outright, by a deny rule; undefined when nothing forbids it. Never asks the user. */
  authorize?: (name: string, input: unknown) => Promise<string | undefined>
  /** Puts changes to files to the user as one decision; true when they are to be applied. */
  review?: (title: string, edits: FileEditChange[]) => Promise<boolean>
}

export type ToolOutput = { text: string; isError: boolean }

export interface Tool<S extends z.ZodObject = z.ZodObject> {
  readonly name: string
  readonly description: string
  readonly schema: S
  /** The JSON schema handed to the model as is, for a tool whose schema was not written in zod (an MCP server's). */
  readonly parameters?: Record<string, unknown>
  /** Read-only tools run without asking. */
  readonly readOnly: boolean
  execute(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput>
}

export function toDefinition(tool: Tool): ToolDefinition {
  if (tool.parameters) return { name: tool.name, description: tool.description, parameters: tool.parameters }
  const { $schema: _, ...parameters } = z.toJSONSchema(tool.schema)
  return { name: tool.name, description: tool.description, parameters }
}

export const ok = (text: string): ToolOutput => ({ text, isError: false })
export const fail = (text: string): ToolOutput => ({ text, isError: true })

/** Tool output past this size is cut; the model can narrow its request. */
export const MAX_OUTPUT_CHARS = 30_000

export function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated at ${MAX_OUTPUT_CHARS} characters]`
}
