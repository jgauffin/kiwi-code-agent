import { describe, expect, it } from 'vitest'
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { SdkSession } from '../src/agent/sdk-session/sdk-session'
import { TOOL_SERVER_NAME } from '../src/agent/sdk-session/tool-server'
import { jsonQueryTool } from '../src/agent/openai-session/tools/json'
import type { SessionEvent } from '../src/agent/session/code-session'
import { fakeQuery, initMessage, resultMessage } from './fake-query'

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
  it('a_prompt_is_echoed_as_user_message_and_forwarded_to_the_engine', async () => {
    const fake = fakeQuery()
    const session = createSession(fake)
    session.send('fix the bug')
    const [event] = await take(session, 1)
    expect(event).toEqual({ type: 'user_message', text: 'fix the bug' })
    await tick()
    expect(fake.received).toEqual([
      { type: 'user', message: { role: 'user', content: 'fix the bug' }, parent_tool_use_id: null },
    ])
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

  it('deny_carries_the_user_message_back_to_the_model', async () => {
    const fake = fakeQuery()
    const session = createSession(fake)
    const resultPromise = fake.options!.canUseTool!('Bash', { command: 'rm -rf /' }, { signal: new AbortController().signal, toolUseID: 'tu_2' })
    await take(session, 1)
    session.respondToPermission('tu_2', { kind: 'deny', message: 'not that' })
    expect(await resultPromise).toEqual({ behavior: 'deny', message: 'not that', decisionClassification: 'user_reject' })
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
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'plan/x.spec.md' }, tool_use_id: 't3' },
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
})
