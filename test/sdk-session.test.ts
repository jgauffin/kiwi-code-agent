import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { runScriptTool } from '../src/agent/openai-session/tools/run-script'
import { SdkSession } from '../src/agent/sdk-session/sdk-session'
import { TOOL_SERVER_NAME } from '../src/agent/sdk-session/tool-server'
import { jsonQueryTool } from '../src/agent/openai-session/tools/json'
import { askUserTool } from '../src/agent/openai-session/tools/ask-user'
import type { Tool } from '../src/agent/openai-session/tools/tool'
import type { SessionEvent } from '../src/agent/session/code-session'
import type { McpServers } from '../src/agent/mcp/mcp-config'
import { COMPACT_COMMAND } from '../src/agent/sdk-session/compaction'
import { assistantMessage, compactionMessages, compactionRefusedMessages, fakeQuery, initMessage, interruptedResult, promptTooLongMessages, resultMessage } from './fake-query'

const profile = { name: 'Claude', engine: 'claude-sdk' as const, model: 'opus' }

function createSession(fake: ReturnType<typeof fakeQuery>, resume?: string) {
  return new SdkSession({
    id: 'sess-1',
    profile,
    cwd: '/w',
    cliPath: '/ext/dist/cli.js',
    runtime: { command: 'node', args: [], env: {} },
    ...(resume ? { resumeEngineSessionId: resume } : {}),
    query: fake.query,
  })
}

/** Collects events until `count` have arrived. */
async function take(session: SdkSession, count: number): Promise<SessionEvent[]> {
  const out: SessionEvent[] = []
  for await (const e of session.events()) {
    out.push(e)
    if (out.length === count) break
  }
  return out
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('SdkSession', () => {
  it('a_prompt_is_forwarded_to_the_engine_and_not_echoed_as_an_event', async () => {
    const fake = fakeQuery()
    const session = createSession(fake)
    session.send('fix the bug')
    await tick()
    expect(fake.received).toEqual([
      { type: 'user', message: { role: 'user', content: 'fix the bug' }, parent_tool_use_id: null },
    ])
    fake.emit(resultMessage())
    // The host echoes the prompt before the engine exists; an echo here would show it twice.
    expect((await take(session, 1)).map((e) => e.type)).toEqual(['turn_done'])
    await session.dispose()
  })

  it('engine_messages_are_mapped_and_the_engine_session_id_is_remembered', async () => {
    const fake = fakeQuery()
    const session = createSession(fake)
    fake.emit(initMessage('engine-42'))
    fake.emit(resultMessage())
    const events = await take(session, 2)
    expect(events[0]).toMatchObject({ type: 'session_started', engineSessionId: 'engine-42' })
    expect(events[1]).toMatchObject({ type: 'turn_done', isError: false })
    expect(session.engineSession).toBe('engine-42')
    await session.dispose()
  })

  it('permission_request_blocks_the_tool_until_the_user_allows', async () => {
    const fake = fakeQuery()
    const session = createSession(fake)
    const resultPromise = fake.options!.canUseTool!('Bash', { command: 'ls' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu_9',
      suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' }],
    })
    const [request] = await take(session, 1)
    expect(request).toEqual({
      type: 'permission_request',
      requestId: 'tu_9',
      toolUseId: 'tu_9',
      toolName: 'Bash',
      input: { command: 'ls' },
    })
    session.respondToPermission('tu_9', { kind: 'allow' })
    const result: PermissionResult = await resultPromise
    expect(result).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' }, decisionClassification: 'user_temporary' })
    const [resolved] = await take(session, 1)
    expect(resolved).toEqual({ type: 'permission_resolved', requestId: 'tu_9', decision: 'allow' })
    await session.dispose()
  })

  it('a_call_the_engine_asks_about_on_its_own_account_carries_the_engines_reason', async () => {
    const fake = fakeQuery()
    const session = createSession(fake)
    void fake.options!.canUseTool!('Bash', { command: 'cp a /tmp/b' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu_5',
      decisionReason: 'Writes outside the working directory',
      blockedPath: '/tmp/b',
    })
    const [request] = await take(session, 1)
    expect(request).toMatchObject({ type: 'permission_request', reason: 'Writes outside the working directory' })
    await session.dispose()
  })

  it('without_a_reason_the_engine_names_the_blocked_path', async () => {
    const fake = fakeQuery()
    const session = createSession(fake)
    void fake.options!.canUseTool!('Bash', { command: 'cp a /tmp/b' }, { signal: new AbortController().signal, toolUseID: 'tu_6', blockedPath: '/tmp/b' })
    const [request] = await take(session, 1)
    expect(request).toMatchObject({ type: 'permission_request', reason: 'Touches /tmp/b' })
    await session.dispose()
  })

  it('deny_carries_the_user_message_back_to_the_model', async () => {
    const fake = fakeQuery()
    const session = createSession(fake)
    const resultPromise = fake.options!.canUseTool!('Bash', { command: 'rm -rf /' }, { signal: new AbortController().signal, toolUseID: 'tu_2' })
    await take(session, 1)
    session.respondToPermission('tu_2', { kind: 'deny', message: 'not that' })
    expect(await resultPromise).toEqual({ behavior: 'deny', message: 'Denied by user: not that', decisionClassification: 'user_reject' })
    const [resolved] = await take(session, 1)
    expect(resolved).toEqual({ type: 'permission_resolved', requestId: 'tu_2', decision: 'deny', message: 'not that' })
    await session.dispose()
  })

  it('disposing_denies_pending_permissions_and_ends_the_event_stream', async () => {
    const fake = fakeQuery()
    const session = createSession(fake)
    const resultPromise = fake.options!.canUseTool!('Bash', {}, { signal: new AbortController().signal, toolUseID: 'tu_3' })
    await take(session, 1)
    await session.dispose()
    expect(await resultPromise).toMatchObject({ behavior: 'deny' })
    expect(fake.closed).toBe(1)
    const rest: SessionEvent[] = []
    for await (const e of session.events()) rest.push(e)
    expect(rest.map((e) => e.type)).toEqual(['ended'])
  })

  it('engine_stream_failure_surfaces_as_fatal_error_then_ended', async () => {
    const fake = fakeQuery()
    const session = createSession(fake)
    fake.failStream(new Error('process exited with code 1'))
    const events = await take(session, 2)
    expect(events).toEqual([
      { type: 'error', message: 'process exited with code 1', fatal: true },
      { type: 'ended' },
    ])
  })

  it('trace_gets_one_line_per_engine_message_naming_its_kind', async () => {
    const fake = fakeQuery()
    const lines: string[] = []
    const session = new SdkSession({
      id: 'sess-1',
      profile,
      cwd: '/w',
      cliPath: '/ext/dist/cli.js',
      runtime: { command: 'node', args: [], env: {} },
      query: fake.query,
      trace: (line) => lines.push(line),
    })
    fake.emit(initMessage('e1'))
    fake.emit({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } },
      parent_tool_use_id: null,
      uuid: 'u',
      session_id: 's',
    } as never)
    fake.emit(resultMessage())
    await take(session, 2)
    expect(lines).toEqual(['system init', 'stream_event content_block_delta thinking_delta', 'result success 1200ms'])
    await session.dispose()
  })

  it('resume_and_model_and_cli_path_are_passed_to_the_engine', () => {
    const fake = fakeQuery()
    createSession(fake, 'engine-old')
    expect(fake.options).toMatchObject({
      resume: 'engine-old',
      model: 'opus',
      pathToClaudeCodeExecutable: '/ext/dist/cli.js',
      executable: 'node',
      permissionMode: 'default',
      includePartialMessages: true,
      settingSources: ['project', 'local'],
    })
  })

  it('a_session_without_a_prompt_of_its_own_appends_to_the_engines_default_prompt', () => {
    const fake = fakeQuery()
    const base = { id: 's', profile, cwd: '/w', cliPath: '/c', runtime: { command: 'node', args: [], env: {} }, query: fake.query }
    new SdkSession({ ...base, appendSystemPrompt: 'Find before you read.' })
    expect(fake.options!.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'Find before you read.' })
  })

  it('a_phase_prompt_replaces_the_default_and_the_append_is_not_used', () => {
    const fake = fakeQuery()
    const base = { id: 's', profile, cwd: '/w', cliPath: '/c', runtime: { command: 'node', args: [], env: {} }, query: fake.query }
    new SdkSession({ ...base, systemPrompt: 'You are planning.', appendSystemPrompt: 'Find before you read.' })
    expect(fake.options!.systemPrompt).toBe('You are planning.')
  })

  it('the_engines_built_in_question_tool_is_withheld_so_questions_take_the_own_tool_and_its_card', () => {
    const fake = fakeQuery()
    createSession(fake)
    expect(fake.options).toMatchObject({ disallowedTools: ['AskUserQuestion'] })
  })

  it('own_tools_are_served_in_process_and_reach_hooks_and_prompts_under_their_bare_name', async () => {
    const fake = fakeQuery()
    const seen: string[] = []
    const session = new SdkSession({
      id: 'sess-1',
      profile,
      cwd: '/w',
      cliPath: '/ext/dist/cli.js',
      runtime: { command: 'node', args: [], env: {} },
      query: fake.query,
      ownTools: [jsonQueryTool],
      hooks: {
        async preToolUse(tool) {
          seen.push(tool.toolName)
          return undefined
        },
      },
    })
    expect(Object.keys(fake.options!.mcpServers!)).toEqual([TOOL_SERVER_NAME])
    expect(fake.options!.mcpServers![TOOL_SERVER_NAME]).toMatchObject({ type: 'sdk', name: TOOL_SERVER_NAME })

    const base = { session_id: 's', transcript_path: '', cwd: '/w' }
    await fake.options!.hooks!.PreToolUse![0]!.hooks[0]!(
      { ...base, hook_event_name: 'PreToolUse', tool_name: `mcp__${TOOL_SERVER_NAME}__JsonQuery`, tool_input: {}, tool_use_id: 't1' },
      't1',
      { signal: new AbortController().signal },
    )
    expect(seen).toEqual(['JsonQuery'])

    void fake.options!.canUseTool!(`mcp__${TOOL_SERVER_NAME}__JsonQuery`, { file_path: 'a.json' }, { signal: new AbortController().signal, toolUseID: 'tu_1' })
    const [request] = await take(session, 1)
    expect(request).toMatchObject({ type: 'permission_request', toolName: 'JsonQuery' })
    await session.dispose()
  })

  it('without_own_tools_no_mcp_server_is_registered', () => {
    const fake = fakeQuery()
    createSession(fake)
    expect(fake.options!.mcpServers).toBeUndefined()
  })

  it('the_engines_own_hidden_auto_memory_is_off_so_memory_writes_go_through_the_ordinary_tools_instead', () => {
    const fake = fakeQuery()
    createSession(fake)
    expect(fake.options!.settings).toEqual({ autoMemoryEnabled: false })
  })

  describe('workspace MCP servers', () => {
    const docs = { type: 'stdio' as const, command: 'node', args: ['docs.js'] }
    const github = { type: 'http' as const, url: 'https://x.test/mcp' }

    function mcpSession(fake: ReturnType<typeof fakeQuery>, servers: McpServers = { docs, github }) {
      return new SdkSession({
        id: 'sess-1',
        profile,
        cwd: '/w',
        cliPath: '/ext/dist/cli.js',
        runtime: { command: 'node', args: [], env: {} },
        query: fake.query,
        ownTools: [jsonQueryTool],
        mcpServers: servers,
      })
    }

    it('servers_are_passed_beside_the_own_server', () => {
      const fake = fakeQuery()
      mcpSession(fake)
      expect(Object.keys(fake.options!.mcpServers!)).toEqual([TOOL_SERVER_NAME, 'docs', 'github'])
      expect(fake.options!.mcpServers!['docs']).toEqual(docs)
    })

    it('server_statuses_are_reported_after_the_session_started_without_the_own_server_and_the_engine_s_own_reading_of_the_file', async () => {
      const fake = fakeQuery()
      fake.setMcpStatus([
        { name: TOOL_SERVER_NAME, status: 'connected' },
        { name: 'docs', status: 'failed', scope: 'project', error: 'read from the file by the engine' },
        { name: 'docs', status: 'connected', scope: 'dynamic' },
        { name: 'github', status: 'failed', error: 'ECONNREFUSED' },
      ])
      const session = mcpSession(fake)
      fake.emit(initMessage())
      const events = await take(session, 2)
      expect(events[1]).toEqual({
        type: 'mcp_servers',
        servers: [
          { name: 'docs', status: 'connected' },
          { name: 'github', status: 'failed', error: 'ECONNREFUSED' },
        ],
      })
      await session.dispose()
    })

    it('a_reload_replaces_the_servers_and_keeps_the_own_server', async () => {
      const fake = fakeQuery()
      const session = mcpSession(fake)
      fake.setMcpStatus([{ name: 'docs', status: 'connected' }])
      await session.mcp!.reload({ docs })
      expect(fake.setServers).toHaveLength(1)
      expect(Object.keys(fake.setServers[0]!)).toEqual([TOOL_SERVER_NAME, 'docs'])
      const [event] = await take(session, 1)
      expect(event).toEqual({ type: 'mcp_servers', servers: [{ name: 'docs', status: 'connected' }] })
      await session.dispose()
    })

    it('a_failed_reconnect_is_the_server_s_status_not_an_error', async () => {
      const fake = fakeQuery()
      const session = mcpSession(fake)
      fake.failReconnect(new Error('still down'))
      fake.setMcpStatus([{ name: 'github', status: 'failed', error: 'still down' }])
      await session.mcp!.reconnect('github')
      expect(fake.reconnected).toEqual(['github'])
      const [event] = await take(session, 1)
      expect(event).toEqual({ type: 'mcp_servers', servers: [{ name: 'github', status: 'failed', error: 'still down' }] })
      await session.dispose()
    })

    it('a_server_still_connecting_is_asked_about_again_until_it_settles', async () => {
      const fake = fakeQuery()
      const session = mcpSession(fake, { docs })
      fake.setMcpStatus([{ name: 'docs', status: 'pending' }])
      fake.emit(initMessage())
      const [, first] = await take(session, 2)
      expect(first).toEqual({ type: 'mcp_servers', servers: [{ name: 'docs', status: 'pending' }] })
      fake.setMcpStatus([{ name: 'docs', status: 'connected' }])
      const [second] = await take(session, 1)
      expect(second).toEqual({ type: 'mcp_servers', servers: [{ name: 'docs', status: 'connected' }] })
      await session.dispose()
    }, 10_000)

    it('a_session_without_servers_has_no_control_and_never_asks_for_status', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      expect(session.mcp).toBeUndefined()
      fake.emit(initMessage())
      fake.emit(resultMessage())
      const events = await take(session, 2)
      expect(events.map((e) => e.type)).toEqual(['session_started', 'turn_done'])
      await session.dispose()
    })
  })

  it('hooks_are_mapped_onto_the_sdk_hook_protocol', async () => {
    const fake = fakeQuery()
    const seen: string[] = []
    const session = new SdkSession({
      id: 'sess-1',
      profile,
      cwd: '/w',
      cliPath: '/ext/dist/cli.js',
      runtime: { command: 'node', args: [], env: {} },
      query: fake.query,
      hooks: {
        async preToolUse(tool) {
          seen.push(`pre:${tool.toolName}`)
          if (tool.toolName === 'Bash') return { deny: 'no shell' }
          return tool.toolName === 'Write' ? { allow: true } : undefined
        },
        async postToolUse(tool) {
          seen.push(`post:${tool.toolName}:${tool.output}`)
          return { additionalContext: 'noted' }
        },
      },
    })
    const hooks = fake.options!.hooks!
    const base = { session_id: 's', transcript_path: '', cwd: '/w' }
    const ctx = { signal: new AbortController().signal }

    const denied = await hooks.PreToolUse![0]!.hooks[0]!(
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1' },
      't1',
      ctx,
    )
    expect(denied).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no shell' },
    })

    const allowed = await hooks.PreToolUse![0]!.hooks[0]!(
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'specs/x.spec.md' }, tool_use_id: 't3' },
      't3',
      ctx,
    )
    expect(allowed).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } })

    const post = await hooks.PostToolUse![0]!.hooks[0]!(
      { ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: {}, tool_response: 'ok', tool_use_id: 't2' },
      't2',
      ctx,
    )
    expect(post).toEqual({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'noted' } })
    expect(hooks.Stop).toBeUndefined()
    expect(seen).toEqual(['pre:Bash', 'pre:Write', 'post:Edit:ok'])
    await session.dispose()
  })

  describe('running a script', () => {
    const grep: Tool = {
      name: 'Grep',
      description: '',
      schema: z.object({ pattern: z.string() }),
      readOnly: true,
      execute: async () => ({ text: 'a.ts:1:x', isError: false, items: ['a.ts:1:x'] }),
    }

    function scriptingSession(fake: ReturnType<typeof fakeQuery>, cwd: string) {
      return new SdkSession({
        id: 'sess-1',
        profile,
        cwd,
        cliPath: '/ext/dist/cli.js',
        runtime: { command: 'node', args: [], env: {} },
        query: fake.query,
        scriptTools: [grep],
      })
    }

    it('a_script_runs_a_built_in_as_our_own_implementation', async () => {
      const session = scriptingSession(fakeQuery(), '/w')
      const result = await runScriptTool().execute({ script: 'return (await grep({ pattern: "x" })).length' }, session.toolContext)
      expect(result.text).toBe('1')
      await session.dispose()
    })

    it('a_script_reaches_the_own_tools_as_well_as_the_built_ins', async () => {
      const codeSearch: Tool = {
        name: 'CodeSearch',
        description: '',
        schema: z.object({ query: z.string() }),
        readOnly: true,
        execute: async () => ({ text: '1 match', isError: false, items: [{ declaration: 'Cart.total' }] }),
      }
      const fake = fakeQuery()
      const session = new SdkSession({ id: 'sess-1', profile, cwd: '/w', cliPath: '/ext/dist/cli.js', runtime: { command: 'node', args: [], env: {} }, query: fake.query, ownTools: [codeSearch], scriptTools: [grep] })
      const result = await runScriptTool().execute({ script: 'return (await codeSearch({ query: "total" }))[0].declaration' }, session.toolContext)
      expect(result.text).toBe('Cart.total')
      await session.dispose()
    })

    it('a_scripts_edits_are_put_to_the_user_together_and_written_only_when_allowed', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'sdk-script-'))
      await writeFile(join(dir, 'a.ts'), 'foo')
      await writeFile(join(dir, 'b.ts'), 'foo')
      const session = scriptingSession(fakeQuery(), dir)
      const running = runScriptTool().execute({ script: 'await replace("a.ts", "foo", "bar"); await replace("b.ts", "foo", "bar")' }, session.toolContext)
      const [request] = await take(session, 1)
      expect(request).toMatchObject({ type: 'permission_request', title: 'Apply changes to 2 files' })
      expect((request as { edits: unknown[] }).edits).toHaveLength(2)
      expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('foo')
      session.respondToPermission((request as { requestId: string }).requestId, { kind: 'allow' })
      await running
      expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('bar')
      expect(await readFile(join(dir, 'b.ts'), 'utf8')).toBe('bar')
      await session.dispose()
    })
  })

  describe('asking the user', () => {
    const card = {
      questions: [
        { header: 'Scope', question: 'How far?', options: [{ label: 'Small' }, { label: 'Large' }] },
        { header: 'Name', question: 'What is it called?' },
      ],
    }

    function askingSession(fake: ReturnType<typeof fakeQuery>) {
      return new SdkSession({
        id: 'sess-1',
        profile,
        cwd: '/w',
        cliPath: '/ext/dist/cli.js',
        runtime: { command: 'node', args: [], env: {} },
        query: fake.query,
        ownTools: [askUserTool as Tool],
      })
    }

    it('the_same_tool_on_this_engine_asks_through_the_session_and_waits_without_a_deadline', async () => {
      const fake = fakeQuery()
      const session = askingSession(fake)
      expect(Object.keys(fake.options!.mcpServers!)).toEqual([TOOL_SERVER_NAME])
      // The engine runs the own tool in process, with the context the session built for it.
      const running = askUserTool.execute(card, session.toolContext)
      const [request] = await take(session, 1)
      expect(request).toMatchObject({ type: 'question_request', request: card })
      let settled = false
      void running.then(() => (settled = true))
      await new Promise((r) => setTimeout(r, 30))
      expect(settled).toBe(false)
      session.respondToQuestion((request as { requestId: string }).requestId, {
        kind: 'answered',
        answers: [{ chosen: ['Large'] }, { chosen: [], other: 'AskUser' }],
      })
      const output = await running
      expect(output.isError).toBe(false)
      expect(output.text).toContain('Chose: Large')
      expect(output.text).toContain('AskUser')
      const [resolved] = await take(session, 1)
      expect(resolved).toMatchObject({ type: 'question_resolved', outcome: { kind: 'answered' } })
      await session.dispose()
    })

    it('a_question_still_open_when_the_engine_goes_away_ends_unanswered', async () => {
      const fake = fakeQuery()
      const session = askingSession(fake)
      const running = askUserTool.execute(card, session.toolContext)
      const [request] = await take(session, 1)
      expect(request?.type).toBe('question_request')
      await session.dispose()
      const output = await running
      expect(output.text).toContain('did not answer')
    })
  })

  describe('compaction', () => {
    const settle = async () => {
      for (let i = 0; i < 10; i++) await tick()
    }
    const sent = (fake: ReturnType<typeof fakeQuery>) => fake.received.map((m) => m.message.content)

    /** Every event the session emits from now on, as it arrives. */
    function collect(session: SdkSession): SessionEvent[] {
      const events: SessionEvent[] = []
      void (async () => {
        for await (const e of session.events()) events.push(e)
      })()
      return events
    }

    it('the_engine_is_told_not_to_compact_on_its_own', () => {
      const fake = fakeQuery()
      createSession(fake)
      expect(fake.options!.env).toMatchObject({ DISABLE_AUTO_COMPACT: '1' })
    })

    it('each_reply_reports_how_full_the_engines_window_is', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      const events = collect(session)
      fake.emit(initMessage())
      await settle()
      fake.emit(assistantMessage(25_000))
      await settle()
      expect(events).toContainEqual({ type: 'context_usage', usedTokens: 25_000, windowTokens: 200_000, compactAtTokens: 150_000 })
      await session.dispose()
    })

    it('a_turn_that_fills_the_window_is_stopped_compacted_and_carried_on_as_the_same_turn', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      const events = collect(session)
      session.send('build the task')
      fake.emit(initMessage())
      await settle()
      fake.emit(assistantMessage(160_000))
      await settle()
      expect(fake.interrupted).toBe(1)
      fake.emit(interruptedResult())
      await settle()
      expect(sent(fake).at(-1)).toBe(COMPACT_COMMAND)
      for (const m of compactionMessages()) fake.emit(m)
      await settle()
      expect(sent(fake).at(-1)).toMatch(/compacted/i)
      fake.emit(resultMessage())
      await settle()
      // The host sees one turn that ended well: the stop and the compaction in between are the session's own business.
      expect(events.filter((e) => e.type === 'turn_done')).toEqual([expect.objectContaining({ isError: false })])
      expect(events.map((e) => e.type)).toContain('compacted')
      expect(events.at(-1)).toMatchObject({ type: 'turn_done' })
      await session.dispose()
    })

    it('a_ceiling_set_below_the_windows_share_compacts_a_turn_sooner_to_keep_each_request_small', async () => {
      const fake = fakeQuery()
      const session = new SdkSession({
        id: 'sess-1',
        profile,
        cwd: '/w',
        cliPath: '/ext/dist/cli.js',
        runtime: { command: 'node', args: [], env: {} },
        compactAtTokens: 100_000,
        query: fake.query,
      })
      const events = collect(session)
      session.send('build the task')
      fake.emit(initMessage())
      await settle()
      fake.emit(assistantMessage(90_000))
      await settle()
      expect(fake.interrupted).toBe(0)
      fake.emit(assistantMessage(110_000))
      await settle()
      expect(fake.interrupted).toBe(1)
      expect(events).toContainEqual({ type: 'context_usage', usedTokens: 110_000, windowTokens: 200_000, compactAtTokens: 100_000 })
      await session.dispose()
    })

    it('a_failed_compaction_ends_the_turn_as_failed_instead_of_carrying_on_into_a_full_window', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      const events = collect(session)
      session.send('build the task')
      fake.emit(initMessage())
      await settle()
      fake.emit(assistantMessage(160_000))
      await settle()
      fake.emit(interruptedResult())
      await settle()
      for (const m of compactionMessages('Request timed out')) fake.emit(m)
      await settle()
      expect(sent(fake).at(-1)).toBe(COMPACT_COMMAND)
      expect(events.filter((e) => e.type === 'turn_done')).toEqual([
        expect.objectContaining({ isError: true, errors: ['Compaction failed: Request timed out'] }),
      ])
      await session.dispose()
    })

    it('a_failed_compaction_during_a_turn_is_reported_once_on_the_turn', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      const events = collect(session)
      session.send('build the task')
      fake.emit(initMessage())
      await settle()
      fake.emit(assistantMessage(160_000))
      await settle()
      fake.emit(interruptedResult())
      await settle()
      for (const m of compactionMessages('Request timed out')) fake.emit(m)
      await settle()
      expect(events.filter((e) => JSON.stringify(e).includes('Request timed out')).map((e) => e.type)).toEqual(['turn_done'])
      await session.dispose()
    })

    it('a_failed_compaction_between_turns_is_reported_once', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      const all = collect(session)
      session.send('hello')
      fake.emit(initMessage())
      fake.emit(resultMessage())
      await settle()
      const before = all.length
      session.compact()
      for (const m of compactionMessages('Request timed out')) fake.emit(m)
      await settle()
      const events = all.slice(before)
      expect(events.filter((e) => JSON.stringify(e).includes('Request timed out'))).toEqual([
        { type: 'error', message: 'Compaction failed: Request timed out', fatal: false },
      ])
      await session.dispose()
    })

    it('a_compaction_the_engine_turns_down_is_reported_as_failed_not_as_a_reply', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      const all = collect(session)
      session.send('hello')
      fake.emit(initMessage())
      fake.emit(resultMessage())
      await settle()
      const before = all.length
      session.compact()
      for (const m of compactionRefusedMessages('No messages to compact')) fake.emit(m)
      await settle()
      const events = all.slice(before)
      expect(events.filter((e) => JSON.stringify(e).includes('No messages to compact'))).toEqual([
        { type: 'error', message: 'Compaction failed: No messages to compact', fatal: false },
      ])
      await session.dispose()
    })

    it('a_turn_whose_compaction_the_engine_turns_down_ends_as_failed_instead_of_carrying_on', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      const events = collect(session)
      session.send('build the task')
      fake.emit(initMessage())
      await settle()
      fake.emit(assistantMessage(160_000))
      await settle()
      fake.emit(interruptedResult())
      await settle()
      for (const m of compactionRefusedMessages('No messages to compact')) fake.emit(m)
      await settle()
      expect(sent(fake).at(-1)).toBe(COMPACT_COMMAND)
      expect(events.filter((e) => e.type === 'turn_done')).toEqual([
        expect.objectContaining({ isError: true, errors: ['Compaction failed: No messages to compact'] }),
      ])
      await session.dispose()
    })

    it('a_compaction_asks_for_a_summary_short_enough_to_fit_the_engines_output_limit', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      session.send('hello')
      fake.emit(initMessage())
      fake.emit(resultMessage())
      await settle()
      session.compact()
      await settle()
      expect(sent(fake).at(-1)).toMatch(/^\/compact \S/)
      await session.dispose()
    })

    it('a_prompt_the_engine_refuses_as_too_long_is_compacted_and_sent_again', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      const events = collect(session)
      session.send('carry on with the task')
      fake.emit(initMessage())
      await settle()
      for (const m of promptTooLongMessages()) fake.emit(m)
      await settle()
      expect(sent(fake).at(-1)).toBe(COMPACT_COMMAND)
      for (const m of compactionMessages()) fake.emit(m)
      await settle()
      expect(sent(fake).at(-1)).toBe('carry on with the task')
      fake.emit(resultMessage())
      await settle()
      // The refusal was answered, not suffered: the host sees neither it nor a turn that failed.
      expect(events.filter((e) => e.type === 'error')).toEqual([])
      expect(events.filter((e) => e.type === 'turn_done')).toEqual([expect.objectContaining({ isError: false })])
      // A refusal made before any request says nothing about how full the window is.
      expect(events.filter((e) => e.type === 'context_usage').map((e) => e.type === 'context_usage' && e.usedTokens)).not.toContain(0)
      await session.dispose()
    })

    it('a_prompt_still_too_long_after_compacting_ends_the_turn_as_failed', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      const events = collect(session)
      session.send('carry on with the task')
      fake.emit(initMessage())
      await settle()
      for (const m of promptTooLongMessages()) fake.emit(m)
      await settle()
      for (const m of compactionMessages()) fake.emit(m)
      await settle()
      for (const m of promptTooLongMessages()) fake.emit(m)
      await settle()
      expect(sent(fake).filter((t) => t === COMPACT_COMMAND)).toHaveLength(1)
      expect(events.filter((e) => e.type === 'turn_done')).toEqual([expect.objectContaining({ isError: true })])
      expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: 'Prompt is too long' }))
      await session.dispose()
    })

    it('compacting_between_turns_does_not_look_like_a_finished_turn', async () => {
      const fake = fakeQuery()
      const session = createSession(fake)
      const all = collect(session)
      session.send('hello')
      fake.emit(initMessage())
      fake.emit(resultMessage())
      await settle()
      const before = all.length
      session.compact()
      await settle()
      expect(sent(fake).at(-1)).toBe(COMPACT_COMMAND)
      expect(fake.interrupted).toBe(0)
      fake.setContextUsage({ totalTokens: 21_000, maxTokens: 200_000 })
      for (const m of compactionMessages()) fake.emit(m)
      await settle()
      const events = all.slice(before)
      expect(events.map((e) => e.type)).not.toContain('turn_done')
      expect(events).toContainEqual({ type: 'context_usage', usedTokens: 21_000, windowTokens: 200_000, compactAtTokens: 150_000 })
      expect(events).toContainEqual({ type: 'status', status: 'idle' })
      await session.dispose()
    })
  })
})
