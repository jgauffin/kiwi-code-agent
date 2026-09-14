import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager, type SessionRecord, type SessionStore } from '../src/agent/session/session-manager'
import type { CodeSession, SessionEvent } from '../src/agent/session/code-session'
import { AsyncQueue } from '../src/agent/session/async-queue'
import { RunLog } from '../src/agent/runs/run-log'
import type { ModelProfile } from '../src/agent/session/model-profile'

const profile: ModelProfile = { name: 'Claude', engine: 'claude-sdk', model: 'opus' }

class FakeSession implements CodeSession {
  readonly out = new AsyncQueue<SessionEvent>()
  readonly sent: string[] = []
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
  respondToPermission() {}
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
