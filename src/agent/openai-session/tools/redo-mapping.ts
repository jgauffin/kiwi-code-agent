import { z } from 'zod'
import { ok, type Tool, type ToolOutput } from './tool'

/**
 * Lets the planner redo the mapping itself, for feedback about how it works
 * rather than about the spec: a level of detail, a scope, a house style. The
 * host runs it as a continuation of the mapping's own conversation, so the
 * code it already read is not re-read; touching the spec is still the
 * planner's own job, done by writing to it directly, not through this tool.
 */
const schema = z.object({
  note: z.string().optional().describe('What should be different this time — a style or scope instruction for the mapping itself. Leave out to just run it again.'),
})

export const REDO_MAPPING_TOOL = 'RedoMapping'

export const redoMappingTool: Tool<typeof schema> = {
  name: REDO_MAPPING_TOOL,
  description: [
    'Redo the mapping of the spec against the code — the check that writes the decisions and the tasks — continuing its own conversation rather than starting over.',
    'Use it when the user asks you to change how the mapping works or what it reports (less detail, a different scope, a house style), not for a change to the rules themselves: this tool never touches the spec.',
    'Refused while the spec is not a draft, and a no-op while a mapping is already running — if the plan bar shows one live, tell the user to stop it first.',
  ].join(' '),
  schema,
  // Starts a run elsewhere; it writes nothing itself, so it needs no permission of its own.
  readOnly: true,
  async execute(input): Promise<ToolOutput> {
    return ok(input.note ? `Redoing the mapping: ${input.note}` : 'Redoing the mapping.')
  },
}
