import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager, type SessionRecord, type SessionStore } from '../src/agent/session/session-manager'
import type { QuestionOutcome, UserQuestionRequest } from '../src/agent/session/user-question'
import type { CodeSession, PermissionDecision, SessionEvent } from '../src/agent/session/code-session'
import { AsyncQueue } from '../src/agent/session/async-queue'
import { RunLog } from '../src/agent/runs/run-log'
import type { ModelProfile } from '../src/agent/session/model-profile'

const profile: ModelProfile = { name: 'Claude', engine: 'claude-sdk', model: 'opus' }

class FakeSession implements CodeSession {
  readonly out = new AsyncQueue<SessionEvent>()
  readonly sent: string[] = []
  readonly answered: { requestId: string; decision: PermissionDecision }[] = []
  readonly answers: { requestId: string; outcome: QuestionOutcome }[] = []
  private readonly holding = new Set<string>()
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
  /** Stands in for an engine holding a question: it holds the ones it was told about, and resolves each once. */
  respondToQuestion(requestId: string, outcome: QuestionOutcome): boolean {
    if (!this.holding.delete(requestId)) return false
    this.answers.push({ requestId, outcome })
    this.out.push({ type: 'question_resolved', requestId, outcome })
    return true
  }
  /** Ask as an engine would: the request goes out and the engine holds it until it is resolved. */
  ask(requestId: string, request: UserQuestionRequest) {
    this.holding.add(requestId)
    this.out.push({ type: 'question_request', requestId, request })
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
  it('live_sessions_are_reachable_and_a_reconnect_reaches_the_live_session_s_mcp_control', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const reconnected: string[] = []
      const manager = new SessionManager(
        memoryStore(),
        async (r) => {
          const s = new FakeSession(r.id, r.profile, r.engineSessionId)
          return Object.assign(s, { mcp: { reload: async () => {}, reconnect: async (name: string) => void reconnected.push(name) } })
        },
        (id) => RunLog.forSession(dir, id),
        () => {},
      )
      const record = await manager.create(profile)
      const idle = await manager.create(profile)
      expect(manager.liveSessions()).toEqual([])
      await manager.reconnectMcp(idle.id, 'docs')
      await manager.send(record.id, 'hello')
      expect(manager.liveSessions().map((s) => s.id)).toEqual([record.id])
      await manager.reconnectMcp(record.id, 'docs')
      expect(reconnected).toEqual(['docs'])
      await manager.disposeAll()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

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
      const check = await manager.create(profile, 'reconcile', 'Orders', { parentId: plan.id })
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

  it('a_cleanup_run_carries_the_files_it_may_split_and_a_cleanup_title', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-'))
    try {
      const store = memoryStore()
      const manager = new SessionManager(
        store,
        async (r) => new FakeSession(r.id, r.profile, r.engineSessionId),
        (id) => RunLog.forSession(dir, id),
        () => {},
      )
      const implementer = await manager.create(profile, 'implement', 'Orders')
      const cleanup = await manager.create(profile, 'cleanup', 'Orders', { parentId: implementer.id, files: ['src/orders/cancel.ts'] })
      expect(cleanup).toMatchObject({ title: 'Cleanup: Orders', parentId: implementer.id, files: ['src/orders/cancel.ts'] })
      expect(store.saved[store.saved.length - 1]![0]).toMatchObject({ files: ['src/orders/cancel.ts'] })
      expect(implementer.files).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  describe('continuing a conversation', () => {
    const berget: ModelProfile = { name: 'GLM', engine: 'openai-compatible', model: 'glm', baseUrl: 'https://b', apiKeySecret: 'k' }

    function setup(dir: string) {
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
      return { manager, engines }
    }

    it('a_record_continuing_a_resumable_session_carries_its_engine_session_id', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'sm-'))
      try {
        const { manager, engines } = setup(dir)
        const check = await manager.create(profile, 'reconcile', 'Orders')
        await manager.send(check.id, 'map')
        engines[0]!.out.push({ type: 'session_started', engineSessionId: 'eng-map', model: 'opus' })
        await tick()
        await manager.close(check.id)

        const implementer = await manager.create(profile, 'implement', 'Orders', { continues: manager.get(check.id) })
        expect(implementer.engineSessionId).toBe('eng-map')
        await manager.send(implementer.id, 'implement')
        expect(engines[1]!.resumedFrom).toBe('eng-map')
        await manager.disposeAll()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('a_record_continuing_an_own_loop_session_names_that_record_and_its_conversation_is_the_chain_of_logs', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'sm-'))
      try {
        const { manager, engines } = setup(dir)
        const check = await manager.create(berget, 'reconcile', 'Orders')
        await manager.send(check.id, 'map')
        engines[0]!.out.push({ type: 'session_started', engineSessionId: check.id, model: 'glm' })
        engines[0]!.out.push({ type: 'user_message', text: 'map' })
        await tick()
        await manager.close(check.id)

        const implementer = await manager.create(berget, 'implement', 'Orders', { continues: manager.get(check.id) })
        expect(implementer.engineSessionId).toBe(check.id)
        await manager.send(implementer.id, 'implement')
        expect(engines[1]!.resumedFrom).toBe(check.id)
        // The engine reports the conversation it resumed, so the chain survives a reload.
        engines[1]!.out.push({ type: 'session_started', engineSessionId: check.id, model: 'glm' })
        engines[1]!.out.push({ type: 'user_message', text: 'implement' })
        await tick()
        await manager.close(implementer.id)
        expect(manager.get(implementer.id)!.engineSessionId).toBe(check.id)

        const again = await manager.create(berget, 'implement', 'Orders', { continues: manager.get(implementer.id) })
        expect(again.engineSessionId).toBe(implementer.id)
        await manager.send(again.id, 'once more')
        engines[2]!.out.push({ type: 'user_message', text: 'once more' })
        await tick()
        expect((await manager.conversation(again.id)).filter((e) => e.type === 'user_message').map((e) => e.text)).toEqual([
          'map',
          'implement',
          'once more',
        ])
        await manager.disposeAll()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('a_conversation_is_not_continued_across_engines_or_from_a_session_that_never_ran', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'sm-'))
      try {
        const { manager, engines } = setup(dir)
        const check = await manager.create(berget, 'reconcile', 'Orders')
        await manager.send(check.id, 'map')
        engines[0]!.out.push({ type: 'session_started', engineSessionId: check.id, model: 'glm' })
        await tick()
        // A Claude implementer cannot pick up a Berget mapping, or the other way round.
        expect((await manager.create(profile, 'implement', 'Orders', { continues: manager.get(check.id) })).engineSessionId).toBeUndefined()
        const never = await manager.create(profile, 'reconcile', 'Orders')
        expect((await manager.create(profile, 'implement', 'Orders', { continues: never })).engineSessionId).toBeUndefined()
        const neverOwn = await manager.create(berget, 'reconcile', 'Orders')
        expect((await manager.create(berget, 'implement', 'Orders', { continues: neverOwn })).engineSessionId).toBeUndefined()
        await manager.disposeAll()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('a_session_that_ran_before_names_itself_and_its_conversation_is_its_own_log', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'sm-'))
      try {
        const { manager, engines } = setup(dir)
        const chat = await manager.create(berget)
        await manager.send(chat.id, 'hi')
        engines[0]!.out.push({ type: 'session_started', engineSessionId: chat.id, model: 'glm' })
        engines[0]!.out.push({ type: 'user_message', text: 'hi' })
        await tick()
        expect(manager.get(chat.id)!.engineSessionId).toBe(chat.id)
        expect((await manager.conversation(chat.id)).map((e) => e.type)).toEqual(['session_started', 'user_message'])
        await manager.disposeAll()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('latest_returns_the_newest_record_of_a_mode_on_a_feature', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'sm-'))
      try {
        const { manager } = setup(dir)
        expect(manager.latest('implement', 'Orders')).toBeUndefined()
        const first = await manager.create(profile, 'implement', 'Orders')
        await manager.create(profile, 'implement', 'Invoices')
        const second = await manager.create(profile, 'implement', 'Orders')
        expect(manager.latest('implement', 'Orders')?.id).toBe(second.id)
        expect(manager.latest('reconcile', 'Orders')).toBeUndefined()
        expect(first.id).not.toBe(second.id)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  describe('answering a question', () => {
    const card: UserQuestionRequest = {
      questions: [{ header: 'Scope', question: 'How far?', options: [{ label: 'Small' }, { label: 'Large' }] }],
    }
    const answered: QuestionOutcome = { kind: 'answered', answers: [{ chosen: ['Large'] }] }

    function setup(dir: string) {
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
      return { manager, engines, seen }
    }

    it('an_answer_reaches_the_engine_that_asked_and_the_question_and_its_answers_are_logged_in_order', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'sm-'))
      try {
        const { manager, engines, seen } = setup(dir)
        const record = await manager.create(profile, 'plan', 'Orders')
        await manager.send(record.id, 'plan it')
        engines[0]!.ask('q-1', card)
        await tick()
        await manager.respondToQuestion(record.id, 'q-1', answered)
        await tick()
        expect(engines[0]!.answers).toEqual([{ requestId: 'q-1', outcome: answered }])
        // No new prompt was needed: the live engine resumes on its own tool result.
        expect(engines[0]!.sent).toEqual(['plan it'])
        expect(seen.map((e) => e.type)).toEqual(['question_request', 'question_resolved'])
        const transcript = await manager.transcript(record.id)
        expect(transcript.map((e) => e.type)).toEqual(['question_request', 'question_resolved'])
        expect(transcript[0]).toMatchObject({ requestId: 'q-1', request: card })
        expect(transcript[1]).toMatchObject({ requestId: 'q-1', outcome: answered })
        await manager.disposeAll()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('an_answer_given_after_the_engine_let_go_of_the_question_resumes_the_session_as_its_next_prompt', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'sm-'))
      try {
        const { manager, engines, seen } = setup(dir)
        const record = await manager.create(profile, 'plan', 'Orders')
        await manager.send(record.id, 'plan it')
        engines[0]!.out.push({ type: 'session_started', engineSessionId: 'eng-1', model: 'opus' })
        engines[0]!.ask('q-1', card)
        await tick()
        await manager.close(record.id)

        await manager.respondToQuestion(record.id, 'q-1', answered)
        expect(engines).toHaveLength(2)
        expect(engines[1]!.resumedFrom).toBe('eng-1')
        expect(engines[1]!.sent[0]).toContain('How far?')
        expect(engines[1]!.sent[0]).toContain('Chose: Large')
        expect(seen.find((e) => e.type === 'question_resolved')).toMatchObject({ requestId: 'q-1', outcome: answered })
        await manager.disposeAll()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    it('a_question_resolved_once_is_answered_no_further', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'sm-'))
      try {
        const { manager, engines } = setup(dir)
        const record = await manager.create(profile, 'plan', 'Orders')
        await manager.send(record.id, 'plan it')
        engines[0]!.ask('q-1', card)
        await tick()
        await manager.respondToQuestion(record.id, 'q-1', answered)
        await tick()
        await manager.close(record.id)
        await expect(manager.respondToQuestion(record.id, 'q-1', { kind: 'unanswered' })).rejects.toThrow(/q-1/)
        expect(engines).toHaveLength(1)
        await manager.disposeAll()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })
})
