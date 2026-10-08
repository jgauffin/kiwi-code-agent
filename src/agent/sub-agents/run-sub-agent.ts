import { homedir } from 'node:os'
import { OpenAiSession } from '../openai-session/openai-session'
import type { ChatCompletionClient } from '../openai-session/chat-messages'
import type { SubAgentOutcome, Tool } from '../openai-session/tools/tool'
import type { SubAgentBudget } from '../openai-session/tools/delegate'
import type { ModelProfile } from '../session/model-profile'
import type { NestedEvent, SessionEvent, TurnUsage } from '../session/code-session'
import type { SessionHooks } from '../session/hooks'
import type { PermissionAsker } from '../permissions/gate'
import { withInstructionFiles } from '../instructions/instruction-files'
import { withMemories } from '../memory/session-context'

export type SubAgentReport = { report: string; isError: boolean; outcome: SubAgentOutcome }

/** Events from inside a sub agent's own run that nest in the transcript under the call that spawned it. */
const NESTABLE: ReadonlySet<SessionEvent['type']> = new Set(['assistant_text', 'assistant_thinking', 'assistant_message', 'reply_usage', 'tool_call', 'tool_result'])

/** What stands in for a sub agent's report when the caller was interrupted before it could give one: its findings are abandoned, not handed on. */
const CALLER_INTERRUPTED = '[interrupted before the sub agent could report back]'

/**
 * Runs a sub agent's own turn, on a session of its own, to completion and
 * hands back its report alone: nothing of its own messages or tool calls
 * reaches the caller's context beyond this, though `report` may still show
 * them in the transcript, nested under the call that spawned them.
 *
 * A budget it runs out of ends the turn early and still reports what it has,
 * as a partial result rather than an error; the caller's own `signal` ending
 * does the same but the result is discarded rather than handed back at all.
 */
export async function runSubAgent(opts: {
  id: string
  client: ChatCompletionClient
  profile: ModelProfile
  cwd: string
  tools: Tool[]
  prompt: string
  task: string
  budget?: SubAgentBudget | undefined
  /** The caller's own turn ending: what the sub agent had found is abandoned rather than reported. */
  signal?: AbortSignal | undefined
  report?: (event: NestedEvent) => void
  /** What this run spends counts toward the caller's own totals, not a session of its own. */
  addUsage?: (usage: TurnUsage) => void
  /**
   * The caller's own rules: a deny rule blocks the sub agent exactly as it
   * would the caller, and a write it leaves open is still recorded under the
   * session that called it rather than the sub agent's own run.
   */
  hooks?: SessionHooks | undefined
  /** Puts a write the hooks leave open to the person through the ordinary permission prompt, exactly as the caller's own write would be; absent, a write is never asked about. */
  ask?: PermissionAsker | undefined
  /** The calling session's own mode, so the sub agent carries the instruction files and memories that mode carries; absent carries neither. */
  mode?: string | undefined
  home?: string | undefined
}): Promise<SubAgentReport> {
  const systemPrompt = opts.mode ? await carriedPrompt(opts.mode, opts.cwd, opts.prompt, opts.home ?? homedir()) : opts.prompt
  const sub = new OpenAiSession({
    id: opts.id,
    profile: opts.profile,
    cwd: opts.cwd,
    client: opts.client,
    tools: opts.tools,
    systemPrompt,
    ...(opts.hooks ? { hooks: opts.hooks } : {}),
    ...(opts.ask ? { ask: opts.ask } : {}),
  })
  let report = ''
  let isError = false
  let toolCalls = 0
  let tokens = 0
  let budgetExceeded = false
  let callerInterrupted = false
  const onAbort = (): void => {
    callerInterrupted = true
    void sub.interrupt()
  }
  opts.signal?.addEventListener('abort', onAbort)
  sub.send(opts.task)
  for await (const event of sub.events()) {
    if (NESTABLE.has(event.type)) opts.report?.(event as NestedEvent)
    if (event.type === 'tool_call') {
      toolCalls++
      if (!budgetExceeded && opts.budget?.toolCalls !== undefined && toolCalls >= opts.budget.toolCalls) {
        budgetExceeded = true
        void sub.interrupt()
      }
    } else if (event.type === 'context_usage') {
      tokens = event.usedTokens
      if (!budgetExceeded && opts.budget?.tokens !== undefined && tokens >= opts.budget.tokens) {
        budgetExceeded = true
        void sub.interrupt()
      }
    } else if (event.type === 'assistant_message') {
      report = event.text
    } else if (event.type === 'turn_done') {
      if (event.usage) opts.addUsage?.(event.usage)
      if (callerInterrupted) {
        report = CALLER_INTERRUPTED
        isError = true
      } else if (budgetExceeded) {
        isError = false
        if (!report) report = 'Stopped before reporting: its budget ran out.'
      } else {
        isError = event.isError
        if (isError && event.errors.length) report = event.errors.join('; ')
      }
      break
    }
  }
  opts.signal?.removeEventListener('abort', onAbort)
  await sub.dispose()
  return { report, isError, outcome: { status: budgetExceeded ? 'partial' : 'complete', toolCalls, tokens } }
}

/**
 * A sub agent's tools are what its definition or the call asks for, by name,
 * narrowed to what the calling session is itself offered, so a delegation
 * never reaches past its caller; asking for none takes every read-only tool
 * it has, since most a definition never names. The delegating tool itself is
 * always left out, so a delegation is one level deep.
 *
 * `extra` joins the pool beside the caller's own tools, for the one case
 * where a shipped sub agent's tools reach past what its caller was ever
 * offered: the research lookup's searching and fetching, named by the caller
 * only through which sub agent it ran, never through its own tool set.
 */
export function subAgentTools(callerTools: readonly Tool[], names: string[] | undefined, extra: readonly Tool[] = []): Tool[] {
  const pool = [...callerTools.filter((t) => t.name !== 'Delegate'), ...extra]
  return names ? pool.filter((t) => names.includes(t.name)) : pool.filter((t) => t.readOnly)
}

/**
 * The caller's own instruction files and memories, exactly as its own mode
 * would carry them, appended after the sub agent's own instructions: it
 * works in the same code, so it carries the same rules. A mode that carries
 * neither (the blind planner, blind by construction) leaves the prompt as is.
 */
async function carriedPrompt(mode: string, cwd: string, prompt: string, home: string): Promise<string> {
  const withMem = await withMemories(mode, prompt, cwd, home)
  return withInstructionFiles(mode, withMem, cwd, home)
}
