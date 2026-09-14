import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { OpenAiSession } from '../src/agent/openai-session/openai-session'
import type { ChatCompletionClient, CompletionDelta, CompletionRequest } from '../src/agent/openai-session/chat-messages'
import type { Tool } from '../src/agent/openai-session/tools/tool'
import type { SessionEvent } from '../src/agent/session/code-session'

/** A scripted model: each call to stream() plays the next scripted reply. */
class ScriptedModel implements ChatCompletionClient {
  readonly requests: CompletionRequest[] = []
  private readonly replies: CompletionDelta[][]
  constructor(...replies: CompletionDelta[][]) {
    this.replies = replies
  }
  async *stream(request: CompletionRequest): AsyncIterable<CompletionDelta> {
    // The session keeps mutating its message array; snapshot what this call saw.
    this.requests.push({ ...request, messages: structuredClone(request.messages) })
    const reply = this.replies.shift()
    if (!reply) throw new Error('no scripted reply left')
    for (const d of reply) {
      if (request.signal.aborted) throw new DOMException('aborted', 'AbortError')
      yield d
    }
  }
}

const text = (t: string, usage = { promptTokens: 10, completionTokens: 2, cachedTokens: 4 }): CompletionDelta[] => [
  { type: 'text', text: t },
  { type: 'done', finishReason: 'stop', usage },
]

const toolCall = (id: string, name: string, args: string): CompletionDelta[] => [
  { type: 'tool_call_start', index: 0, id, name },
  { type: 'tool_call_arguments', index: 0, text: args },
  { type: 'done', finishReason: 'tool_calls', usage: { promptTokens: 5, completionTokens: 1, cachedTokens: 0 } },
]

const echoSchema = z.object({ value: z.string() })
const echoTool: Tool<typeof echoSchema> = {
  name: 'Echo',
  description: 'echo',
  schema: echoSchema,
  readOnly: true,
  async execute(input) {
    return { text: `echo:${input.value}`, isError: false }
  },
}
const dangerTool: Tool<typeof echoSchema> = { ...echoTool, name: 'Danger', readOnly: false }

function session(model: ChatCompletionClient, tools: Tool[] = [echoTool as Tool, dangerTool as Tool]) {
  return new OpenAiSession({
    id: 's1',
    profile: { name: 'GLM', engine: 'openai-compatible', model: 'glm' },
    cwd: process.cwd(),
    client: model,
    tools,
    systemPrompt: 'sys',
  })
}

async function untilTurnDone(s: OpenAiSession): Promise<SessionEvent[]> {
  const out: SessionEvent[] = []
  for await (const e of s.events()) {
    out.push(e)
    if (e.type === 'turn_done') break
  }
  return out
}

describe('OpenAiSession', () => {
  it('a_text_reply_ends_the_turn_with_usage', async () => {
    const model = new ScriptedModel(text('Hello there'))
    const s = session(model)
    s.send('hi')
    const events = await untilTurnDone(s)
    expect(events.map((e) => e.type)).toEqual([
      'session_started',
      'user_message',
      'status',
      'assistant_text',
      'assistant_message',
      'status',
      'turn_done',
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'turn_done',
      isError: false,
      usage: { inputTokens: 6, cacheReadTokens: 4, outputTokens: 2 },
    })
    expect(model.requests[0]!.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ])
    await s.dispose()
  })

  it('tool_calls_are_executed_and_their_results_fed_back_until_the_model_answers', async () => {
    const model = new ScriptedModel(toolCall('c1', 'Echo', '{"value":"x"}'), text('done'))
    const s = session(model)
    s.send('go')
    const events = await untilTurnDone(s)
    expect(events).toContainEqual({ type: 'tool_call', toolUseId: 'c1', name: 'Echo', input: { value: 'x' } })
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'c1', text: 'echo:x', isError: false })
    const second = model.requests[1]!.messages
    expect(second.at(-2)).toEqual({ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'Echo', arguments: '{"value":"x"}' }] })
    expect(second.at(-1)).toEqual({ role: 'tool', toolCallId: 'c1', content: 'echo:x' })
    await s.dispose()
  })

  it('malformed_or_invalid_arguments_become_tool_errors_the_model_can_retry_on', async () => {
    const model = new ScriptedModel(toolCall('c1', 'Echo', '{"value":'), toolCall('c2', 'Echo', '{"nope":1}'), text('ok'))
    const s = session(model)
    s.send('go')
    const events = await untilTurnDone(s)
    const results = events.filter((e) => e.type === 'tool_result')
    expect(results[0]).toMatchObject({ isError: true, text: expect.stringContaining('not valid JSON') })
    expect(results[1]).toMatchObject({ isError: true, text: expect.stringContaining('value') })
    await s.dispose()
  })

  it('unknown_tool_is_reported_not_thrown', async () => {
    const model = new ScriptedModel(toolCall('c1', 'Nope', '{}'), text('ok'))
    const s = session(model)
    s.send('go')
    const events = await untilTurnDone(s)
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'c1', text: 'Unknown tool: Nope', isError: true })
    await s.dispose()
  })

  it('every_writing_call_waits_for_permission_because_remembering_is_the_host_policy_not_the_engine', async () => {
    const model = new ScriptedModel(
      toolCall('c1', 'Danger', '{"value":"a"}'),
      toolCall('c2', 'Danger', '{"value":"b"}'),
      text('ok'),
    )
    const s = session(model)
    s.send('go')
    const events: SessionEvent[] = []
    for await (const e of s.events()) {
      events.push(e)
      if (e.type === 'permission_request') s.respondToPermission(e.requestId, { kind: 'allow' })
      if (e.type === 'turn_done') break
    }
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2)
    expect(events.filter((e) => e.type === 'tool_result')).toEqual([
      { type: 'tool_result', toolUseId: 'c1', text: 'echo:a', isError: false },
      { type: 'tool_result', toolUseId: 'c2', text: 'echo:b', isError: false },
    ])
    await s.dispose()
  })

  it('denied_permission_is_returned_to_the_model_as_an_error_result', async () => {
    const model = new ScriptedModel(toolCall('c1', 'Danger', '{"value":"a"}'), text('fine'))
    const s = session(model)
    s.send('go')
    const events: SessionEvent[] = []
    for await (const e of s.events()) {
      events.push(e)
      if (e.type === 'permission_request') s.respondToPermission(e.requestId, { kind: 'deny', message: 'no' })
      if (e.type === 'turn_done') break
    }
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'c1', text: 'Denied by user: no', isError: true })
    await s.dispose()
  })

  it('interrupt_during_a_pending_permission_ends_the_turn_and_keeps_history_consistent', async () => {
    const model = new ScriptedModel(toolCall('c1', 'Danger', '{"value":"a"}'), text('after'))
    const s = session(model)
    s.send('go')
    const events: SessionEvent[] = []
    for await (const e of s.events()) {
      events.push(e)
      if (e.type === 'permission_request') void s.interrupt()
      if (e.type === 'turn_done') break
    }
    expect(events.at(-1)).toMatchObject({ type: 'turn_done', isError: true, errors: ['interrupted'] })
    s.send('next')
    await untilTurnDone(s)
    const history = model.requests[1]!.messages
    expect(history.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user'])
    expect(history[3]).toMatchObject({ role: 'tool', toolCallId: 'c1' })
    await s.dispose()
  })

  it('a_runaway_tool_loop_is_stopped_at_the_round_budget', async () => {
    const replies = Array.from({ length: 5 }, (_, i) => toolCall(`c${i}`, 'Echo', '{"value":"x"}'))
    const model = new ScriptedModel(...replies)
    const s = new OpenAiSession({
      id: 's1',
      profile: { name: 'GLM', engine: 'openai-compatible', model: 'glm' },
      cwd: process.cwd(),
      client: model,
      tools: [echoTool as Tool],
      systemPrompt: 'sys',
      maxRoundsPerTurn: 3,
    })
    s.send('go')
    const events = await untilTurnDone(s)
    expect(model.requests).toHaveLength(3)
    expect(events.at(-1)).toMatchObject({ type: 'turn_done', isError: true, errors: ['max tool rounds'] })
    await s.dispose()
  })

  it('api_failure_is_an_error_event_and_the_turn_ends', async () => {
    const failing: ChatCompletionClient = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('API error 429: slow down')
      },
    }
    const s = session(failing)
    s.send('go')
    const events = await untilTurnDone(s)
    expect(events).toContainEqual({ type: 'error', message: 'API error 429: slow down', fatal: false })
    expect(events.at(-1)).toMatchObject({ type: 'turn_done', isError: true })
    await s.dispose()
  })

  it('a_writing_tool_the_pre_hook_allows_runs_without_a_permission_prompt', async () => {
    const model = new ScriptedModel(toolCall('c1', 'Danger', '{"value":"a"}'), text('ok'))
    const s = new OpenAiSession({
      id: 's1',
      profile: { name: 'GLM', engine: 'openai-compatible', model: 'glm' },
      cwd: process.cwd(),
      client: model,
      tools: [dangerTool as Tool],
      systemPrompt: 'sys',
      hooks: { async preToolUse() { return { allow: true } } },
    })
    s.send('go')
    const events = await untilTurnDone(s)
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'c1', text: 'echo:a', isError: false })
    await s.dispose()
  })

  it('pre_hook_can_deny_a_tool_and_post_hook_context_is_appended_to_the_result', async () => {
    const model = new ScriptedModel(toolCall('c1', 'Echo', '{"value":"a"}'), toolCall('c2', 'Echo', '{"value":"b"}'), text('ok'))
    const s = new OpenAiSession({
      id: 's1',
      profile: { name: 'GLM', engine: 'openai-compatible', model: 'glm' },
      cwd: process.cwd(),
      client: model,
      tools: [echoTool as Tool],
      systemPrompt: 'sys',
      hooks: {
        async preToolUse(tool) {
          return (tool.input as { value: string }).value === 'a' ? { deny: 'not a' } : undefined
        },
        async postToolUse(tool) {
          return { additionalContext: `seen ${tool.toolUseId}` }
        },
      },
    })
    s.send('go')
    const events = await untilTurnDone(s)
    expect(events.filter((e) => e.type === 'tool_result')).toEqual([
      { type: 'tool_result', toolUseId: 'c1', text: 'Blocked: not a', isError: true },
      { type: 'tool_result', toolUseId: 'c2', text: 'echo:b\n\nseen c2', isError: false },
    ])
    await s.dispose()
  })
})
