import { z } from 'zod'
import type { ToolDefinition } from '../chat-messages'
import type { ReadTracker } from './read-tracker'

export type ToolContext = {
  cwd: string
  signal: AbortSignal
  files: ReadTracker
}

export type ToolOutput = { text: string; isError: boolean }

export interface Tool<S extends z.ZodObject = z.ZodObject> {
  readonly name: string
  readonly description: string
  readonly schema: S
  /** Read-only tools run without asking. */
  readonly readOnly: boolean
  execute(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput>
}

export function toDefinition(tool: Tool): ToolDefinition {
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
