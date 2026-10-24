import type { SessionEvent, TurnUsage } from '../session/code-session'
import type { SessionHooks, ToolUse } from '../session/hooks'
import { confirmReason, denyReason, gateCall, noteCall, reviewEdits, type AskPermission, type PermissionAsker } from '../permissions/gate'
import type { ToolCall } from './chat-messages'
import type { FileLedger } from './file-ledger'
import type { PromptBroker } from './prompt-broker'
import type { ReadTracker } from './tools/read-tracker'
import { folded, type Tool, type ToolContext, type ToolOutput } from './tools/tool'
import { parseArguments } from './tool-arguments'
import { errorMessage } from '../../error-message'

export type ToolRunnerOptions = {
  cwd: string
  hooks: SessionHooks | undefined
  /** Asks the user as the session's own prompt would; absent where the session's own prompt is used. */
  ask: PermissionAsker | undefined
  /** The tools as they stand now; the set changes when the MCP servers do. */
  tools: () => Tool[]
  files: ReadTracker
  ledger: FileLedger
  prompts: PromptBroker
}

/** Runs the tool calls of a session: validates them, passes the permission gate, executes, and gathers what the hooks add. */
export class ToolRunner {
  constructor(
    private readonly options: ToolRunnerOptions,
    private readonly emit: (event: SessionEvent) => void,
  ) {}

  async run(call: ToolCall, signal: AbortSignal, usage: TurnUsage): Promise<ToolOutput> {
    const tool = this.options.tools().find((t) => t.name === call.name)
    if (!tool) return { text: `Unknown tool: ${call.name}`, isError: true }
    const raw = parseArguments(call.arguments)
    if (raw === undefined) return { text: `Tool arguments are not valid JSON: ${call.arguments.slice(0, 200)}`, isError: true }
    const parsed = tool.schema.safeParse(raw)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      return { text: `Invalid arguments for ${tool.name}: ${issues}`, isError: true }
    }
    const use = { toolName: tool.name, input: parsed.data, toolUseId: call.id }
    const gate = await this.gate(tool, use, signal)
    if (gate.refused) return gate.refused
    const pre = gate.pre
    let output: ToolOutput
    try {
      output = await tool.execute(parsed.data, this.contextFor(call.id, signal, usage))
    } catch (error) {
      output = { text: `${tool.name} failed: ${errorMessage(error)}`, isError: true }
    }
    const post = await this.options.hooks?.postToolUse?.({ ...use, output: output.text, isError: output.isError })
    // Kept apart from the text: the model reads it, the chat does not show it.
    const context = [output.context, pre?.additionalContext, post?.additionalContext].filter((c): c is string => !!c)
    return context.length ? { ...output, context: context.join('\n\n') } : output
  }

  /** The permission decision every call passes, whether the model or a running script makes it. */
  private gate(tool: Tool, use: ToolUse, signal: AbortSignal) {
    const ask: AskPermission = this.options.ask
      ? (_id, name, input, shown) => this.options.ask!(name, input, shown)
      : (id, name, input, shown) => this.options.prompts.askPermission(id, name, input, signal, shown)
    return gateCall(this.options.hooks, ask, tool, use)
  }

  /** What a tool gets to work with; a script's calls back into other tools take the same gate as the model's own. */
  private contextFor(callId: string, signal: AbortSignal, usage: TurnUsage): ToolContext {
    let nested = 0
    const nextId = () => `${callId}/${++nested}`
    const { hooks, prompts } = this.options
    const askPermission: AskPermission = (id, n, v, shown) => prompts.askPermission(id, n, v, signal, shown)
    return {
      cwd: this.options.cwd,
      signal,
      files: this.options.files,
      ledger: this.options.ledger,
      ask: (request) => prompts.askUser(callId, request),
      call: async (name, input) => folded(await this.run({ id: nextId(), name, arguments: JSON.stringify(input) }, signal, usage)),
      authorize: (name, input) => denyReason(hooks, { toolName: name, input, toolUseId: nextId() }),
      confirm: (name, input) => confirmReason(hooks, askPermission, { toolName: name, input, toolUseId: nextId() }),
      review: (title, edits) =>
        reviewEdits(hooks, askPermission, { toolName: 'RunScript', input: { files: edits.map((e) => e.label) }, toolUseId: nextId() }, { title, edits }),
      observed: (name, input) => noteCall(hooks, { toolName: name, input, toolUseId: nextId() }),
      askPermission: (toolName, input, shown) => prompts.askPermission(nextId(), toolName, input, signal, shown),
      // A delegated run's spend is the caller's own, so it folds into this turn's total rather than one of its own.
      addUsage: (added) => {
        usage.inputTokens += added.inputTokens
        usage.outputTokens += added.outputTokens
        usage.cacheReadTokens += added.cacheReadTokens
        usage.cacheWriteTokens += added.cacheWriteTokens
        if (added.costUsd) usage.costUsd = (usage.costUsd ?? 0) + added.costUsd
      },
      report: (event) => this.emit({ ...event, parentToolUseId: callId } as SessionEvent),
    }
  }
}
