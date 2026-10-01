import { z } from 'zod'
import type { ToolDefinition } from '../chat-messages'
import type { ReadTracker } from './read-tracker'
import type { FileLedger } from '../file-ledger'
import type { QuestionOutcome, UserQuestionRequest } from '../../session/user-question'
import type { FileEditChange } from '../../edits/file-edit-diff'
import type { PermissionDecision } from '../../session/code-session'

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
  /**
   * Where the session has been in the workspace; survives the compaction that
   * folds the reads away. Absent on an engine that compacts for itself and has
   * no use for one.
   */
  ledger?: FileLedger
  /** Absent in a session whose user never sees its transcript; the question tool then has nobody to ask. */
  ask?: QuestionAsker
  /** Runs another tool as if the model had called it: same permission gate, same result. Absent where tools cannot call tools. */
  call?: (name: string, input: unknown) => Promise<ToolOutput>
  /** The reason a call is refused outright, by a deny rule; undefined when nothing forbids it. Never asks the user. */
  authorize?: (name: string, input: unknown) => Promise<string | undefined>
  /** The reason a call is refused, asking the user when the rules leave it open; undefined when it may go ahead. */
  confirm?: (name: string, input: unknown) => Promise<string | undefined>
  /** Puts changes to files to the user as one decision. */
  review?: (title: string, edits: FileEditChange[]) => Promise<PermissionDecision>
}

/** `items`: the whole result, uncut, as plain JSON values for a script to work through; the model reads `text`. */
export type ToolOutput = { text: string; isError: boolean; items?: unknown[] }

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

export const ok = (text: string, items?: unknown[]): ToolOutput => ({ text, isError: false, ...(items ? { items } : {}) })
export const fail = (text: string): ToolOutput => ({ text, isError: true })

/** Tool output past this size is cut; the model can narrow its request. */
export const MAX_OUTPUT_CHARS = 30_000

/** One rendering of the same content at a level of detail, and the note saying what it leaves out. */
export type Detail = { body: () => string; note: string }

/** The most detailed rendering that fits the budget, or the least detailed when none does. */
export function mostDetailFitting(levels: Detail[], budget: number): { body: string; note: string } {
  let chosen = { body: '', note: '' }
  for (const level of levels) {
    chosen = { body: level.body(), note: level.note }
    if (chosen.body.length <= budget) break
  }
  return chosen
}

export function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated at ${MAX_OUTPUT_CHARS} characters]`
}
