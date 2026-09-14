import { describe, expect, it } from 'vitest'
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { SdkSession } from '../src/agent/sdk-session/sdk-session'
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
      canAllowAlways: true,
    })
    session.respondToPermission('tu_9', { kind: 'allow' })
    const result: PermissionResult = await resultPromise
    expect(result).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' }, decisionClassification: 'user_temporary' })
    const [resolved] = await take(session, 1)
    expect(resolved).toEqual({ type: 'permission_resolved', requestId: 'tu_9', decision: 'allow' })
    await session.dispose()
  })

  it('allow_always_hands_the_engine_its_own_permission_suggestions', async () => {
    const fake = fakeQuery()
    const session = createSession(fake)
    const suggestions = [{ type: 'addRules' as const, rules: [{ toolName: 'Read' }], behavior: 'allow' as const, destination: 'session' as const }]
    const resultPromise = fake.options!.canUseTool!('Read', {}, { signal: new AbortController().signal, toolUseID: 'tu_1', suggestions })
    await take(session, 1)
    session.respondToPermission('tu_1', { kind: 'allow_always' })
    expect(await resultPromise).toEqual({
      behavior: 'allow',
      updatedInput: {},
      updatedPermissions: suggestions,
      decisionClassification: 'user_permanent',
    })
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
})
