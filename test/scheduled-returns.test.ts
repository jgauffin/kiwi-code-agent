import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackgroundCommands } from '../src/agent/background/background-commands'
import { MAX_RETURN_MINUTES, ScheduledReturns, scheduleReturnTool } from '../src/agent/background/scheduled-returns'
import type { ToolContext } from '../src/agent/openai-session/tools/tool'
import { SessionManager, type SessionRecord, type SessionStore } from '../src/agent/session/session-manager'
import type { CodeSession, SessionEvent } from '../src/agent/session/code-session'
import type { ModelProfile } from '../src/agent/session/model-profile'
import { AsyncQueue } from '../src/agent/session/async-queue'
import { RunLog } from '../src/agent/runs/run-log'

const profile: ModelProfile = { name: 'Claude', engine: 'claude-sdk', model: 'opus' }
/** About 60 ms: a return this soon is due within the test. */
const SOON = 0.001

class FakeSession implements CodeSession {
  readonly out = new AsyncQueue<SessionEvent>()
  readonly sent: string[] = []
  constructor(
    readonly id: string,
    readonly profile: ModelProfile,
  ) {}
  send(text: string) {
    this.sent.push(text)
  }
  events() {
    return this.out
  }
  respondToPermission() {
    return false
  }
  respondToQuestion() {
    return false
  }
  async interrupt() {}
  compact() {}
  async dispose() {
    this.out.end()
  }
}

function memoryStore(initial: SessionRecord[] = []): SessionStore {
  let records: SessionRecord[] = initial
  return {
    list: () => records,
    save: async (r) => {
      records = structuredClone(r)
    },
  }
}

async function until(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('a session coming back later', () => {
  let dir: string
  let engines: FakeSession[]
  let shown: { id: string; event: SessionEvent }[]
  let manager: SessionManager
  let returns: ScheduledReturns
  let commands: BackgroundCommands
  const ctx = () => ({ cwd: dir, signal: new AbortController().signal }) as ToolContext

  function build(store: SessionStore = memoryStore(), limit = 10): SessionManager {
    commands = new BackgroundCommands(dir, () => undefined)
    returns = new ScheduledReturns((id, event) => void manager.returnEvent(id, event))
    return new SessionManager(
      store,
      async (r) => {
        const s = new FakeSession(r.id, r.profile)
        engines.push(s)
        return s
      },
      (id) => RunLog.forSession(dir, id),
      (id, event) => void shown.push({ id, event }),
      undefined,
      undefined,
      commands,
      returns,
      () => limit,
    )
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ret-'))
    engines = []
    shown = []
    manager = build()
  })

  afterEach(async () => {
    returns.dispose()
    commands.cutAll()
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  })

  const sentCount = () => engines.reduce((n, e) => n + e.sent.length, 0)
  const rows = (state: string) => shown.filter((s) => s.event.type === 'scheduled_return' && s.event.state === state)

  async function idle(id: string): Promise<void> {
    engines.at(-1)!.out.push({ type: 'turn_done', isError: false, errors: [] })
    await until(() => !manager.isInTurn(id), 'the turn to end')
  }

  async function idleChat(): Promise<SessionRecord> {
    const chat = await manager.create(profile, 'chat')
    await manager.send(chat.id, 'hi')
    await idle(chat.id)
    return chat
  }

  it('a_session_that_asks_to_be_resumed_starts_a_turn_with_its_reason_at_that_time_without_the_person_prompting', async () => {
    const chat = await idleChat()
    const result = await scheduleReturnTool(chat.id, returns).execute({ delayMinutes: SOON, reason: 'check the deploy' }, ctx())
    expect(result.isError).toBe(false)
    await until(() => sentCount() === 2, 'the turn on the return')
    expect(engines[0]!.sent[1]).toContain('check the deploy')
  })

  it('a_delay_over_ten_minutes_is_refused_and_the_refusal_names_the_longest_delay', async () => {
    const chat = await idleChat()
    const result = await scheduleReturnTool(chat.id, returns).execute({ delayMinutes: MAX_RETURN_MINUTES + 1, reason: 'later' }, ctx())
    expect(result.isError).toBe(true)
    expect(result.text).toContain('10 minutes')
    expect(returns.of(chat.id)).toBeUndefined()
  })

  it('a_scheduled_return_is_shown_with_when_and_why_and_the_person_can_cancel_it', async () => {
    const chat = await idleChat()
    await scheduleReturnTool(chat.id, returns).execute({ delayMinutes: 5, reason: 'wait for the review' }, ctx())
    await until(() => rows('scheduled').length === 1, 'the scheduled row')
    expect(rows('scheduled')[0]!.event).toMatchObject({ reason: 'wait for the review', dueAt: returns.of(chat.id)!.dueAt })
    expect(manager.cancelReturn(chat.id)).toBe(true)
    await until(() => rows('cancelled').length === 1, 'the cancelled row')
    expect(returns.of(chat.id)).toBeUndefined()
    expect(manager.get(chat.id)?.scheduledReturn).toBeUndefined()
  })

  it('a_prompt_before_the_scheduled_time_cancels_the_return_and_the_session_is_told_with_the_prompt', async () => {
    const chat = await idleChat()
    await scheduleReturnTool(chat.id, returns).execute({ delayMinutes: 5, reason: 'wait for the review' }, ctx())
    await manager.send(chat.id, 'actually, stop')
    const prompt = engines[0]!.sent.at(-1)!
    expect(prompt).toContain('wait for the review')
    expect(prompt).toContain('cancelled')
    expect(prompt).toContain('actually, stop')
    expect(returns.of(chat.id)).toBeUndefined()
  })

  it('interrupting_the_session_cancels_a_scheduled_return', async () => {
    const chat = await idleChat()
    await scheduleReturnTool(chat.id, returns).execute({ delayMinutes: SOON, reason: 'poll' }, ctx())
    await manager.interrupt(chat.id)
    await new Promise((r) => setTimeout(r, 150))
    expect(sentCount()).toBe(1)
    expect(returns.of(chat.id)).toBeUndefined()
  })

  it('a_scheduled_return_survives_a_window_reload', async () => {
    const store = memoryStore()
    manager = build(store)
    const chat = await idleChat()
    await scheduleReturnTool(chat.id, returns).execute({ delayMinutes: 5, reason: 'check the queue' }, ctx())
    await until(() => store.list().find((r) => r.id === chat.id)?.scheduledReturn !== undefined, 'the return to be recorded')
    await manager.disposeAll()
    expect(returns.of(chat.id)).toBeUndefined()

    manager = build(store)
    await manager.resumeReturns()
    expect(returns.of(chat.id)?.reason).toBe('check the queue')
  })

  it('a_return_whose_time_passed_while_the_window_was_closed_starts_no_turn_and_is_shown_missed_until_the_person_prompts', async () => {
    const chat = await idleChat()
    const stored: SessionRecord = { ...manager.get(chat.id)!, scheduledReturn: { dueAt: new Date(Date.now() - 60_000).toISOString(), reason: 'check the queue' } }
    manager = build(memoryStore([stored]))
    await manager.resumeReturns()
    expect(rows('missed')).toHaveLength(1)
    expect(returns.of(chat.id)).toBeUndefined()
    await new Promise((r) => setTimeout(r, 100))
    expect(sentCount()).toBe(1)

    await manager.send(chat.id, 'back')
    const prompt = engines.at(-1)!.sent.at(-1)!
    expect(prompt).toContain('check the queue')
    expect(prompt).toContain('back')
  })

  it('turns_a_session_starts_on_its_own_are_capped_and_the_next_is_held_with_the_person_told_why', async () => {
    manager = build(memoryStore(), 2)
    const chat = await idleChat()
    for (let turn = 0; turn < 2; turn++) {
      await scheduleReturnTool(chat.id, returns).execute({ delayMinutes: SOON, reason: `round ${turn}` }, ctx())
      await until(() => sentCount() === 2 + turn, 'the turn on the return')
      await idle(chat.id)
    }
    await scheduleReturnTool(chat.id, returns).execute({ delayMinutes: SOON, reason: 'one too many' }, ctx())
    await until(() => shown.some((s) => s.event.type === 'error' && s.event.message.includes('held')), 'the person to be told')
    expect(sentCount()).toBe(3)

    await manager.send(chat.id, 'go on')
    expect(engines.at(-1)!.sent.at(-1)!).toContain('one too many')
  })
})
