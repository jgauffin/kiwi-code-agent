import { z } from 'zod'
import type { SubAgentCatalogEntry } from '../../sub-agents/sub-agent-index'
import type { NestedEvent, TurnUsage } from '../../session/code-session'
import type { PermissionAsker } from '../../permissions/gate'
import { fail, ok, truncate, type SubAgentOutcome, type Tool } from './tool'

export const DELEGATE_TOOL = 'Delegate'

const schema = z.object({
  agent: z.string().optional().describe("One of the sub agents listed in this tool's description, by name."),
  define: z
    .object({
      name: z.string().describe('A short name for this one-off sub agent.'),
      description: z.string().describe('What it is for, as if it were listed here.'),
      instructions: z.string().describe('What it should do and how, as its own system prompt.'),
    })
    .optional()
    .describe('Defines a sub agent in the call itself, when none of the ones offered fits.'),
  task: z.string().describe('The task in full: what the sub agent should do.'),
  want: z
    .string()
    .optional()
    .describe(
      'What you want the report to contain or look like. Honored by a sub agent you `define` here; a named sub agent answers in its own fixed shape regardless of this.',
    ),
  budget: z
    .object({
      toolCalls: z.number().int().positive().optional().describe('Tool calls it may make before it must report back with what it has.'),
      tokens: z.number().int().positive().optional().describe('Tokens of its own conversation before it must report back with what it has.'),
    })
    .optional()
    .describe('What it may spend; going over either part reports a partial result rather than an error.'),
})

export type SubAgentBudget = { toolCalls?: number | undefined; tokens?: number | undefined }

/**
 * What the call hands the sub agent's run: its instructions, the tools it may
 * use (absent takes the caller's own), the task, what it may spend, and
 * where its own messages are shown and the tokens it spends are counted.
 * `agent` is the catalogue entry named, absent for one the call defines
 * itself, so the run can tell the two apart to pick the sub agent's model.
 */
export type DelegateRun = (
  agent: SubAgentCatalogEntry | undefined,
  prompt: string,
  tools: string[] | undefined,
  task: string,
  opts: {
    budget?: SubAgentBudget | undefined
    signal?: AbortSignal | undefined
    report: (event: NestedEvent) => void
    addUsage: (usage: TurnUsage) => void
    /** The caller's own permission prompt, for a sub agent's write the caller's hooks leave open. */
    ask?: PermissionAsker | undefined
  },
) => Promise<{ report: string; isError: boolean; outcome: SubAgentOutcome }>

/**
 * Hands a self-contained task to a sub agent and gets one report back. The
 * index of what is offered rides in the description, so the model picks one
 * itself when a task matches rather than being told which to use.
 */
export function delegateTool(offered: SubAgentCatalogEntry[], run: DelegateRun): Tool<typeof schema> {
  return {
    name: DELEGATE_TOOL,
    description: [
      'Hands a self-contained task to a sub agent and gets one report back, so looking something up or working through a side question never fills this conversation with the work it took.',
      offered.length ? 'Offered sub agents:' : 'No sub agent is offered here; `define` a one-off sub agent of your own when a task needs one.',
      ...offered.map((a) => `- ${a.name}: ${a.description}`),
      'Name one of the above with `agent`, or `define` a one-off sub agent when none fits.',
    ].join('\n'),
    schema,
    // Never read-only by itself: most delegations only read and run unasked (the permission rules say so,
    // never this flag), but the research sub agent reaches the open internet and needs its own permission.
    readOnly: false,
    async execute(input, ctx) {
      if (input.agent && input.define) return fail('Name an offered sub agent with `agent`, or `define` one of your own, not both.')
      const opts = { budget: input.budget, signal: ctx.signal, report: ctx.report ?? (() => {}), addUsage: ctx.addUsage ?? (() => {}), ask: ctx.askPermission }
      if (input.agent) {
        const entry = offered.find((a) => a.name === input.agent)
        if (!entry) return fail(`Unknown sub agent "${input.agent}". Offered: ${offered.map((a) => a.name).join(', ') || 'none'}`)
        // A named sub agent answers in its own shape; what the call wants back cannot loosen that.
        const { report, isError, outcome } = await run(entry, entry.prompt, entry.tools, input.task, opts)
        return isError ? fail(report) : { ...ok(statusLine(entry.name, outcome)), context: truncate(report), subAgent: outcome }
      }
      if (input.define) {
        // A sub agent the call defines answers in the shape the call asked for.
        const task = input.want ? `${input.task}\n\nReport back: ${input.want}` : input.task
        const { report, isError, outcome } = await run(undefined, input.define.instructions, undefined, task, opts)
        return isError ? fail(report) : { ...ok(statusLine(input.define.name, outcome)), context: truncate(report), subAgent: outcome }
      }
      return fail('Name an offered sub agent with `agent`, or describe one with `define`.')
    },
  }
}

function statusLine(name: string, outcome: SubAgentOutcome): string {
  const spend = `${outcome.toolCalls} tool call${outcome.toolCalls === 1 ? '' : 's'}, ${outcome.tokens} tokens`
  return outcome.status === 'partial'
    ? `Sub agent "${name}" ran out of budget and reported back a partial result (${spend}).`
    : `Sub agent "${name}" reported back (${spend}).`
}
