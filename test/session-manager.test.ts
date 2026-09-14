import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager, type SessionRecord, type SessionStore } from '../src/agent/session/session-manager'
import type { CodeSession, PermissionDecision, SessionEvent } from '../src/agent/session/code-session'
import { AsyncQueue } from '../src/agent/session/async-queue'
import { RunLog } from '../src/agent/runs/run-log'
import type { ModelProfile } from '../src/agent/session/model-profile'

const profile: ModelProfile = { name: 'Claude', engine: 'claude-sdk', model: 'opus' }

class FakeSession implements CodeSession {
  readonly out = new AsyncQueue<SessionEvent>()
  readonly sent: string[] = []
  readonly answered: { requestId: string; decision: PermissionDecision }[] = []
  disposed = false
  constructor(
    readonly id: string,
    readonly profile: ModelProfile,
    readonly resumedFrom: string | undefined,
  ) {}
  send(text: string) {
    this.sent.push(text)
  }
  events() {
    return this.out
  }
  respondToPermission(requestId: string, decision: PermissionDecision) {
    this.answered.push({ requestId, decision })
  }
  async interrupt() {}
  async dispose() {
    this.disposed = true
    this.out.end()
  }
}

function memoryStore(): SessionStore & { saved: SessionRecord[][] } {
  let records: SessionRecord[] = []
  const saved: SessionRecord[][] = []
  return {
    saved,
    list: () => records,
    save: async (r) => {
      records = r
      saved.push(structuredClone(r))
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('SessionManager', () => {
  it('engine_starts_on_first_prompt_not_on_creation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const engines: FakeSession[] = []
      const manager = new SessionManager(
        memoryStore(),
        async (r) => {
          const s = new FakeSession(r.id, r.profile, r.engineSessionId)
          engines.push(s)
          return s
        },
        (id) => RunLog.forSession(dir, id),
        () => {},
      )
      const record = await manager.create(profile)
      expect(manager.isLive(record.id)).toBe(false)
      expect(engines).toHaveLength(0)
      await manager.send(record.id, 'hello')
      expect(manager.isLive(record.id)).toBe(true)
      expect(engines[0]!.sent).toEqual(['hello'])
      await manager.disposeAll()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('first_prompt_becomes_the_title_and_engine_session_id_is_persisted_for_resume', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const store = memoryStore()
      const engines: FakeSession[] = []
      const seen: SessionEvent[] = []
      const manager = new SessionManager(
        store,
        async (r) => {
          const s = new FakeSession(r.id, r.profile, r.engineSessionId)
          engines.push(s)
          return s
        },
        (id) => RunLog.forSession(dir, id),
        (_, e) => seen.push(e),
      )
      const record = await manager.create(profile)
      await manager.send(record.id, 'rename the widget please')
      engines[0]!.out.push({ type: 'session_started', engineSessionId: 'eng-7', model: 'opus' })
      await tick()
      expect(manager.get(record.id)).toMatchObject({ title: 'rename the widget please', engineSessionId: 'eng-7' })
      expect(store.saved.at(-1)![0]).toMatchObject({ engineSessionId: 'eng-7' })

      await manager.close(record.id)
      expect(engines[0]!.disposed).toBe(true)
      await manager.send(record.id, 'and again')
      expect(engines[1]!.resumedFrom).toBe('eng-7')

      expect(seen.map((e) => e.type)).toEqual(['session_started'])
      const transcript = await manager.transcript(record.id)
      expect(transcript.map((e) => e.type)).toEqual(['session_started'])
      await manager.disposeAll()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('an_engine_that_stops_is_no_longer_live_and_the_next_prompt_starts_a_new_one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const engines: FakeSession[] = []
      const manager = new SessionManager(
        memoryStore(),
        async (r) => {
          const s = new FakeSession(r.id, r.profile, r.engineSessionId)
          engines.push(s)
          return s
        },
        (id) => RunLog.forSession(dir, id),
        () => {},
      )
      const record = await manager.create(profile)
      await manager.send(record.id, 'go')
      engines[0]!.out.push({ type: 'ended' })
      engines[0]!.out.end()
      await tick()
      expect(manager.isLive(record.id)).toBe(false)
      await manager.send(record.id, 'again')
      expect(engines).toHaveLength(2)
      await manager.disposeAll()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_decision_on_a_request_the_stopped_engine_let_go_of_resumes_the_session_with_the_decision_as_the_next_turn', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const engines: FakeSession[] = []
      const seen: SessionEvent[] = []
      const manager = new SessionManager(
        memoryStore(),
        async (r) => {
          const s = new FakeSession(r.id, r.profile, r.engineSessionId)
          engines.push(s)
          return s
        },
        (id) => RunLog.forSession(dir, id),
        (_, e) => seen.push(e),
      )
      const record = await manager.create(profile)
      await manager.send(record.id, 'run the tests')
      engines[0]!.out.push({ type: 'session_started', engineSessionId: 'eng-1', model: 'opus' })
      engines[0]!.out.push({ type: 'permission_request', requestId: 'req-1', toolName: 'Bash', input: { command: 'npm test' } })
      await tick()
      await manager.close(record.id)

      await manager.respondToPermission(record.id, 'req-1', { kind: 'allow' })
      expect(engines).toHaveLength(2)
      expect(engines[1]!.resumedFrom).toBe('eng-1')
      expect(engines[1]!.sent).toHaveLength(1)
      expect(engines[1]!.sent[0]).toContain('Bash')
      expect(engines[1]!.sent[0]).toContain('npm test')
      expect(engines[1]!.sent[0]).toMatch(/allowed/)
      expect(seen.find((e) => e.type === 'permission_resolved')).toEqual({ type: 'permission_resolved', requestId: 'req-1', decision: 'allow' })
      const transcript = await manager.transcript(record.id)
      expect(transcript.map((e) => e.type)).toEqual(['session_started', 'permission_request', 'permission_resolved'])

      // The same request cannot be decided twice, however often the engine stops.
      await manager.close(record.id)
      await expect(manager.respondToPermission(record.id, 'req-1', { kind: 'deny' })).rejects.toThrow(/req-1/)
      expect(engines).toHaveLength(2)
      await manager.disposeAll()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_deny_given_after_the_engine_stopped_resumes_the_session_and_tells_the_model_not_to_make_the_call', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const engines: FakeSession[] = []
      const manager = new SessionManager(
        memoryStore(),
        async (r) => {
          const s = new FakeSession(r.id, r.profile, r.engineSessionId)
          engines.push(s)
          return s
        },
        (id) => RunLog.forSession(dir, id),
        () => {},
      )
      const record = await manager.create(profile)
      await manager.send(record.id, 'write it')
      engines[0]!.out.push({ type: 'permission_request', requestId: 'req-1', toolName: 'Write', input: { file_path: 'a.txt', content: 'x' } })
      await tick()
      await manager.close(record.id)

      await manager.respondToPermission(record.id, 'req-1', { kind: 'deny' })
      expect(engines[1]!.sent[0]).toMatch(/denied/)
      expect(engines[1]!.sent[0]).toContain('Write')
      engines[1]!.out.push({ type: 'permission_request', requestId: 'req-2', toolName: 'Write', input: { file_path: 'a.txt', content: 'x' } })
      await tick()
      expect(engines[1]!.answered).toEqual([])
      await manager.disposeAll()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('an_allow_given_after_the_engine_stopped_answers_the_same_call_once_when_the_resumed_engine_asks_again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const engines: FakeSession[] = []
      const manager = new SessionManager(
        memoryStore(),
        async (r) => {
          const s = new FakeSession(r.id, r.profile, r.engineSessionId)
          engines.push(s)
          return s
        },
        (id) => RunLog.forSession(dir, id),
        () => {},
      )
      const record = await manager.create(profile)
      await manager.send(record.id, 'run the tests')
      engines[0]!.out.push({ type: 'permission_request', requestId: 'req-1', toolName: 'Bash', input: { command: 'npm test' } })
      await tick()
      await manager.close(record.id)
      await manager.respondToPermission(record.id, 'req-1', { kind: 'allow' })
      const resumed = engines[1]!

      // A different call is the user's to decide.
      resumed.out.push({ type: 'permission_request', requestId: 'req-2', toolName: 'Bash', input: { command: 'rm -rf dist' } })
      await tick()
      expect(resumed.answered).toEqual([])

      resumed.out.push({ type: 'permission_request', requestId: 'req-3', toolName: 'Bash', input: { command: 'npm test' } })
      await tick()
      expect(resumed.answered).toEqual([{ requestId: 'req-3', decision: { kind: 'allow' } }])

      // Honoured once: the same call later in the conversation is asked about again.
      resumed.out.push({ type: 'permission_request', requestId: 'req-4', toolName: 'Bash', input: { command: 'npm test' } })
      await tick()
      expect(resumed.answered).toHaveLength(1)
      await manager.disposeAll()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('an_allow_given_after_the_engine_stopped_lapses_when_the_resumed_turn_ends_without_the_call', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const engines: FakeSession[] = []
      const manager = new SessionManager(
        memoryStore(),
        async (r) => {
          const s = new FakeSession(r.id, r.profile, r.engineSessionId)
          engines.push(s)
          return s
        },
        (id) => RunLog.forSession(dir, id),
        () => {},
      )
      const record = await manager.create(profile)
      await manager.send(record.id, 'run the tests')
      engines[0]!.out.push({ type: 'permission_request', requestId: 'req-1', toolName: 'Bash', input: { command: 'npm test' } })
      await tick()
      await manager.close(record.id)
      await manager.respondToPermission(record.id, 'req-1', { kind: 'allow' })
      const resumed = engines[1]!
      resumed.out.push({ type: 'turn_done', isError: false, errors: [] })
      resumed.out.push({ type: 'permission_request', requestId: 'req-2', toolName: 'Bash', input: { command: 'npm test' } })
      await tick()
      expect(resumed.answered).toEqual([])
      await manager.disposeAll()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('what_the_host_adds_to_an_event_is_logged_with_it_so_it_survives_a_reload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const engines: FakeSession[] = []
      const seen: SessionEvent[] = []
      const manager = new SessionManager(
        memoryStore(),
        async (r) => {
          const s = new FakeSession(r.id, r.profile, r.engineSessionId)
          engines.push(s)
          return s
        },
        (id) => RunLog.forSession(dir, id),
        (_, e) => seen.push(e),
        async (_id, event) =>
          event.type === 'tool_result'
            ? { ...event, edit: { path: '/w/a.ts', label: 'a.ts', diffs: ['@@ -1,1 +1,1 @@\n-a\n+b'], omitted: 0 } }
            : event,
      )
      const record = await manager.create(profile)
      await manager.send(record.id, 'edit it')
      engines[0]!.out.push({ type: 'tool_result', toolUseId: 'call-1', text: 'ok', isError: false })
      await tick()

      const live = seen.find((e) => e.type === 'tool_result')
      expect(live).toMatchObject({ edit: { label: 'a.ts' } })
      const replayed = (await manager.transcript(record.id)).find((e) => e.type === 'tool_result')
      expect(replayed).toEqual(live)
      await manager.disposeAll()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_decoration_that_fails_costs_the_diff_not_the_event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const seen: SessionEvent[] = []
      const engines: FakeSession[] = []
      const manager = new SessionManager(
        memoryStore(),
        async (r) => {
          const s = new FakeSession(r.id, r.profile, r.engineSessionId)
          engines.push(s)
          return s
        },
        (id) => RunLog.forSession(dir, id),
        (_, e) => seen.push(e),
        async () => {
          throw new Error('cannot read the file')
        },
      )
      const record = await manager.create(profile)
      await manager.send(record.id, 'edit it')
      engines[0]!.out.push({ type: 'tool_result', toolUseId: 'call-1', text: 'ok', isError: false })
      await tick()
      expect(seen.map((e) => e.type)).toContain('tool_result')
      await manager.disposeAll()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_run_under_a_session_is_found_while_live_and_goes_when_its_parent_closes_or_is_removed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const engines: FakeSession[] = []
      const manager = new SessionManager(
        memoryStore(),
        async (r) => {
          const s = new FakeSession(r.id, r.profile, r.engineSessionId)
          engines.push(s)
          return s
        },
        (id) => RunLog.forSession(dir, id),
        () => {},
      )
      const plan = await manager.create(profile, 'plan', 'Orders')
      const check = await manager.create(profile, 'reconcile', 'Orders', plan.id)
      expect(check.parentId).toBe(plan.id)
      expect(manager.liveChildOf(plan.id)).toBeUndefined()

      await manager.send(check.id, 'check')
      expect(manager.liveChildOf(plan.id)?.id).toBe(check.id)

      await manager.close(plan.id)
      expect(engines[0]!.disposed).toBe(true)
      expect(manager.liveChildOf(plan.id)).toBeUndefined()

      await manager.remove(plan.id)
      expect(manager.get(check.id)).toBeUndefined()
      await manager.disposeAll()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
