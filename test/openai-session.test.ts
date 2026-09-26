import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { OpenAiSession } from '../src/agent/openai-session/openai-session'
import type { ChatCompletionClient, CompletionDelta, CompletionRequest } from '../src/agent/openai-session/chat-messages'
import type { Tool } from '../src/agent/openai-session/tools/tool'
import { askUserTool } from '../src/agent/openai-session/tools/ask-user'
import type { SessionEvent } from '../src/agent/session/code-session'
import type { McpConnector, McpToolInfo } from '../src/agent/mcp/mcp-connection'
import type { McpServers } from '../src/agent/mcp/mcp-config'
import { McpToolHost } from '../src/agent/mcp/mcp-tool-host'

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
    // The log tells the text that was not JSON apart from a parsed value, so a replay sends what the model wrote.
    expect(events.filter((e) => e.type === 'tool_call')).toEqual([
      { type: 'tool_call', toolUseId: 'c1', name: 'Echo', input: '{"value":', malformed: true },
      { type: 'tool_call', toolUseId: 'c2', name: 'Echo', input: { nope: 1 } },
    ])
    await s.dispose()
  })

  it('a_resumed_session_carries_its_conversation_on_and_reports_the_id_it_resumed', async () => {
    const model = new ScriptedModel(text('and more'))
    const s = new OpenAiSession({
      id: 's2',
      profile: { name: 'GLM', engine: 'openai-compatible', model: 'glm' },
      cwd: process.cwd(),
      client: model,
      tools: [echoTool as Tool],
      systemPrompt: 'sys',
      resume: {
        engineSessionId: 's1',
        history: [
          { role: 'user', content: 'earlier' },
          { role: 'assistant', content: 'noted', toolCalls: [] },
        ],
      },
    })
    s.send('now')
    const events = await untilTurnDone(s)
    expect(events[0]).toEqual({ type: 'session_started', engineSessionId: 's1', model: 'glm' })
    expect(model.requests[0]!.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'noted', toolCalls: [] },
      { role: 'user', content: 'now' },
    ])
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

  describe('asking the user', () => {
    const card = {
      questions: [
        { header: 'Scope', question: 'How far?', options: [{ label: 'Small' }, { label: 'Large' }] },
        { header: 'Engines', question: 'Which?', options: [{ label: 'Claude' }, { label: 'GLM' }], multiSelect: true },
      ],
    }
    const askCall = (id = 'q1') => toolCall(id, 'AskUser', JSON.stringify(card))
    const asking = (model: ChatCompletionClient) => session(model, [askUserTool as Tool])

    it('a_question_from_the_model_becomes_a_request_and_the_session_makes_no_further_progress_until_it_is_resolved', async () => {
      const model = new ScriptedModel(askCall(), text('thanks'))
      const s = asking(model)
      s.send('go')
      const events: SessionEvent[] = []
      for await (const e of s.events()) {
        events.push(e)
        if (e.type === 'question_request') break
      }
      expect(events.at(-1)).toEqual({ type: 'question_request', requestId: 'q1', request: card })
      await new Promise((r) => setTimeout(r, 20))
      // One completion so far: the loop holds the call open, so no result, no further call, no output.
      expect(model.requests).toHaveLength(1)
      expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(0)
      await s.dispose()
    })

    it('answers_to_every_question_of_one_request_come_back_at_once_as_that_tool_calls_own_result', async () => {
      const model = new ScriptedModel(askCall(), text('thanks'))
      const s = asking(model)
      s.send('go')
      const events: SessionEvent[] = []
      for await (const e of s.events()) {
        events.push(e)
        if (e.type === 'question_request') {
          s.respondToQuestion(e.requestId, {
            kind: 'answered',
            answers: [{ chosen: ['Large'] }, { chosen: ['Claude', 'GLM'], other: 'and Kimi' }],
          })
        }
        if (e.type === 'turn_done') break
      }
      const results = events.filter((e) => e.type === 'tool_result')
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ toolUseId: 'q1', isError: false })
      expect(results[0]!.text).toContain('Chose: Large')
      expect(results[0]!.text).toContain('Chose: Claude, GLM')
      expect(results[0]!.text).toContain('and Kimi')
      expect(events).toContainEqual({
        type: 'question_resolved',
        requestId: 'q1',
        outcome: { kind: 'answered', answers: [{ chosen: ['Large'] }, { chosen: ['Claude', 'GLM'], other: 'and Kimi' }] },
      })
      // The session carried on in the same turn: the model was asked again with the answer as the tool's result.
      expect(model.requests).toHaveLength(2)
      expect(model.requests[1]!.messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'q1' })
      expect(events.at(-1)).toMatchObject({ type: 'turn_done', isError: false })
      await s.dispose()
    })

    it('an_interrupted_question_is_resolved_unanswered_and_no_choice_is_invented', async () => {
      const model = new ScriptedModel(askCall(), text('after'))
      const s = asking(model)
      s.send('go')
      const events: SessionEvent[] = []
      for await (const e of s.events()) {
        events.push(e)
        if (e.type === 'question_request') void s.interrupt()
        if (e.type === 'turn_done') break
      }
      const resolved = events.filter((e) => e.type === 'question_resolved')
      expect(resolved).toHaveLength(1)
      expect(resolved[0]).toMatchObject({ requestId: 'q1', outcome: { kind: 'unanswered' } })
      expect(events.some((e) => e.type === 'tool_result' && e.text.includes('Chose'))).toBe(false)
      await s.dispose()
    })

    it('a_disposed_session_leaves_no_question_waiting_for_an_answer', async () => {
      const model = new ScriptedModel(askCall(), text('after'))
      const s = asking(model)
      s.send('go')
      const seen: SessionEvent[] = []
      const reading = (async () => {
        for await (const e of s.events()) seen.push(e)
      })()
      await new Promise((r) => setTimeout(r, 20))
      await s.dispose()
      await reading
      expect(seen.filter((e) => e.type === 'question_resolved')).toMatchObject([{ requestId: 'q1', outcome: { kind: 'unanswered' } }])
    })
  })

  describe('workspace MCP servers', () => {
    const echoInfo: McpToolInfo = { name: 'echo', description: 'Echoes', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }
    const docs = { type: 'stdio' as const, command: 'x' }

    /** Every server has one `echo` tool; `broken` cannot be reached. */
    const connector: McpConnector = async (name) => {
      if (name === 'broken') throw new Error('spawn nope ENOENT')
      return {
        listTools: async () => [echoInfo],
        callTool: async (tool, args) => ({ text: `${name}:${tool}:${JSON.stringify(args)}`, isError: false }),
        close: async () => undefined,
      }
    }

    function mcpSession(model: ChatCompletionClient, servers: McpServers = { docs }) {
      return new OpenAiSession({
        id: 's1',
        profile: { name: 'GLM', engine: 'openai-compatible', model: 'glm' },
        cwd: process.cwd(),
        client: model,
        tools: [echoTool as Tool],
        systemPrompt: 'sys',
        mcp: { host: new McpToolHost(connector), servers },
      })
    }

    it('an_mcp_tool_call_asks_first_and_then_runs_through_the_connection', async () => {
      const model = new ScriptedModel(toolCall('c1', 'mcp__docs__echo', '{"value":"x"}'), text('done'))
      const s = mcpSession(model)
      s.send('go')
      const events: SessionEvent[] = []
      for await (const e of s.events()) {
        events.push(e)
        if (e.type === 'permission_request') s.respondToPermission(e.requestId, { kind: 'allow' })
        if (e.type === 'turn_done') break
      }
      expect(events).toContainEqual({ type: 'mcp_servers', servers: [{ name: 'docs', status: 'connected' }] })
      expect(events).toContainEqual({ type: 'permission_request', requestId: 'c1', toolUseId: 'c1', toolName: 'mcp__docs__echo', input: { value: 'x' } })
      expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'c1', text: 'docs:echo:{"value":"x"}', isError: false })
      expect(model.requests[0]!.tools.map((t) => t.name)).toEqual(['Echo', 'mcp__docs__echo'])
      expect(model.requests[0]!.tools[1]).toEqual({ name: 'mcp__docs__echo', description: 'Echoes', parameters: echoInfo.inputSchema })
      await s.dispose()
    })

    it('the_tools_offered_to_the_model_follow_a_reload_and_a_failed_server_is_reported_not_thrown', async () => {
      const model = new ScriptedModel(text('one'), text('two'))
      const s = mcpSession(model)
      const events: SessionEvent[] = []
      const reading = (async () => {
        for await (const e of s.events()) {
          events.push(e)
          if (events.filter((x) => x.type === 'turn_done').length === 2) break
        }
      })()
      s.send('a')
      await s.mcp!.reload({ other: docs, broken: docs })
      s.send('b')
      await reading
      await s.dispose()
      expect(model.requests[0]!.tools.map((t) => t.name)).toEqual(['Echo', 'mcp__docs__echo'])
      expect(model.requests[1]!.tools.map((t) => t.name)).toEqual(['Echo', 'mcp__other__echo'])
      expect(events.filter((e) => e.type === 'mcp_servers')).toEqual([
        { type: 'mcp_servers', servers: [{ name: 'docs', status: 'connected' }] },
        {
          type: 'mcp_servers',
          servers: [
            { name: 'other', status: 'connected' },
            { name: 'broken', status: 'failed', error: 'spawn nope ENOENT' },
          ],
        },
      ])
    })

    it('a_session_without_servers_has_no_control', async () => {
      const s = session(new ScriptedModel())
      expect(s.mcp).toBeUndefined()
      await s.dispose()
    })
  })
})
