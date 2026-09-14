import type {
  HookCallback,
  HookJSONOutput,
  Options,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { CodeSession, PermissionDecision, SessionEvent } from '../session/code-session'
import type { SessionHooks } from '../session/hooks'
import type { ModelProfile } from '../session/model-profile'
import { AsyncQueue } from '../session/async-queue'
import { SdkEventMapper } from './sdk-event-mapper'
import { spawnWithRuntime, type NodeRuntime } from './node-runtime'

type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => Query

export type SdkSessionOptions = {
  id: string
  profile: ModelProfile
  cwd: string
  /** Absolute path to the SDK's cli.js. */
  cliPath: string
  runtime: NodeRuntime
  /** Engine session id from an earlier `session_started`, to continue that conversation. */
  resumeEngineSessionId?: string
  /** Extra environment for the engine process, on top of the host's. */
  env?: Record<string, string>
  hooks?: SessionHooks
  /** Replaces Claude Code's own system prompt; phases use this. */
  systemPrompt?: string
  /** Restricts the built-in tools to these names. */
  tools?: string[]
  query: QueryFn
  onStderr?: (chunk: string) => void
}

type PendingPermission = {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
  suggestions: PermissionUpdate[] | undefined
}

/**
 * Claude through the Agent SDK. One `query()` in streaming-input mode per
 * session, so one engine process serves every turn of the conversation.
 */
export class SdkSession implements CodeSession {
  readonly id: string
  readonly profile: ModelProfile
  private readonly input = new AsyncQueue<SDKUserMessage>()
  private readonly output = new AsyncQueue<SessionEvent>()
  private readonly pending = new Map<string, PendingPermission>()
  private readonly mapper = new SdkEventMapper()
  private readonly abort = new AbortController()
  private readonly query: Query
  private readonly pumping: Promise<void>
  private engineSessionId: string | undefined

  constructor(private readonly options: SdkSessionOptions) {
    this.id = options.id
    this.profile = options.profile
    this.engineSessionId = options.resumeEngineSessionId
    this.query = options.query({ prompt: this.input, options: this.buildOptions() })
    this.pumping = this.pump()
  }

  /** Engine-side id, known after `session_started`. Needed to resume after a reload. */
  get engineSession(): string | undefined {
    return this.engineSessionId
  }

  send(text: string): void {
    this.output.push({ type: 'user_message', text })
    this.input.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    })
  }

  events(): AsyncIterable<SessionEvent> {
    return this.output
  }

  respondToPermission(requestId: string, decision: PermissionDecision): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    this.output.push({ type: 'permission_resolved', requestId, decision: decision.kind })
    pending.resolve(toPermissionResult(decision, pending.input, pending.suggestions))
  }

  async interrupt(): Promise<void> {
    await this.query.interrupt()
  }

  async dispose(): Promise<void> {
    this.denyAllPending('Session closed')
    this.input.end()
    this.abort.abort()
    this.query.close()
    // The engine stream normally completes once the process is gone; the
    // timeout covers a process that will not die.
    await Promise.race([this.pumping, new Promise((r) => setTimeout(r, 2000))])
    this.finish()
  }

  private buildOptions(): Options {
    const { profile } = this.options
    const options: Options = {
      abortController: this.abort,
      cwd: this.options.cwd,
      model: profile.model,
      permissionMode: 'default',
      includePartialMessages: true,
      // Project settings so the workspace's .claude/ and CLAUDE.md apply; not
      // the user's global settings, which belong to this machine, not the repo.
      settingSources: ['project', 'local'],
      executable: 'node',
      pathToClaudeCodeExecutable: this.options.cliPath,
      spawnClaudeCodeProcess: spawnWithRuntime(this.options.runtime, this.options.onStderr ?? (() => {})),
      canUseTool: (toolName, input, ctx) => this.requestPermission(toolName, input, ctx),
      env: this.options.env ?? {},
    }
    if (profile.effort) options.effort = profile.effort
    if (this.options.resumeEngineSessionId) options.resume = this.options.resumeEngineSessionId
    if (this.options.hooks) options.hooks = this.sdkHooks(this.options.hooks)
    if (this.options.systemPrompt !== undefined) options.systemPrompt = this.options.systemPrompt
    if (this.options.tools) options.tools = this.options.tools
    return options
  }

  /** Maps the engine-agnostic hooks onto the SDK's hook protocol. */
  private sdkHooks(hooks: SessionHooks): NonNullable<Options['hooks']> {
    const registered: NonNullable<Options['hooks']> = {}
    if (hooks.preToolUse) {
      const pre = hooks.preToolUse.bind(hooks)
      const callback: HookCallback = async (input): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== 'PreToolUse') return {}
        const outcome = await pre({ toolName: input.tool_name, input: input.tool_input, toolUseId: input.tool_use_id })
        if (outcome && 'deny' in outcome) {
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: outcome.deny } }
        }
        if (outcome?.additionalContext) {
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: outcome.additionalContext } }
        }
        return {}
      }
      registered.PreToolUse = [{ hooks: [callback] }]
    }
    if (hooks.postToolUse) {
      const post = hooks.postToolUse.bind(hooks)
      const callback: HookCallback = async (input): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== 'PostToolUse') return {}
        const output = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response)
        const outcome = await post({
          toolName: input.tool_name,
          input: input.tool_input,
          toolUseId: input.tool_use_id,
          output,
          isError: false,
        })
        if (outcome?.additionalContext) {
          return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: outcome.additionalContext } }
        }
        return {}
      }
      registered.PostToolUse = [{ hooks: [callback] }]
    }
    if (hooks.stop) {
      const stop = hooks.stop.bind(hooks)
      const callback: HookCallback = async (input): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== 'Stop') return {}
        this.output.push({ type: 'status', status: 'verifying' })
        const outcome = await stop((started) => this.output.push({ type: 'verification_started', ...started }))
        for (const v of outcome?.verifications ?? []) this.output.push({ type: 'verification', ...v })
        return outcome?.block ? { decision: 'block', reason: outcome.block } : {}
      }
      // Builds can take a while; the SDK's default hook timeout would cut them off.
      registered.Stop = [{ hooks: [callback], timeout: 900 }]
    }
    return registered
  }

  private requestPermission(
    toolName: string,
    input: Record<string, unknown>,
    ctx: Parameters<NonNullable<Options['canUseTool']>>[2],
  ): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const requestId = ctx.toolUseID
      this.pending.set(requestId, { resolve, input, suggestions: ctx.suggestions })
      ctx.signal.addEventListener('abort', () => {
        if (this.pending.delete(requestId)) resolve({ behavior: 'deny', message: 'Cancelled' })
      })
      this.output.push({
        type: 'permission_request',
        requestId,
        toolName,
        input,
        ...(ctx.title ? { title: ctx.title } : {}),
        ...(ctx.description ? { description: ctx.description } : {}),
        canAllowAlways: (ctx.suggestions?.length ?? 0) > 0,
      })
    })
  }

  private denyAllPending(message: string): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.resolve({ behavior: 'deny', message })
    }
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.query) {
        for (const event of this.mapper.map(message)) {
          if (event.type === 'session_started') this.engineSessionId = event.engineSessionId
          this.output.push(event)
        }
      }
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.output.push({ type: 'error', message: errorMessage(error), fatal: true })
      }
    } finally {
      this.denyAllPending('Session ended')
      this.finish()
    }
  }

  private finish(): void {
    if (this.output.isEnded) return
    this.output.push({ type: 'ended' })
    this.output.end()
  }
}

/**
 * The engine validates an allow as `{ updatedInput: record }`, so the
 * unchanged input is echoed back; the typings mark it optional but the
 * CLI does not.
 */
function toPermissionResult(
  decision: PermissionDecision,
  input: Record<string, unknown>,
  suggestions: PermissionUpdate[] | undefined,
): PermissionResult {
  switch (decision.kind) {
    case 'allow':
      return { behavior: 'allow', updatedInput: input, decisionClassification: 'user_temporary' }
    case 'allow_always':
      return suggestions
        ? { behavior: 'allow', updatedInput: input, updatedPermissions: suggestions, decisionClassification: 'user_permanent' }
        : { behavior: 'allow', updatedInput: input, decisionClassification: 'user_temporary' }
    case 'deny':
      return { behavior: 'deny', message: decision.message ?? 'Denied by user', decisionClassification: 'user_reject' }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
