import type { CodeSession, PermissionDecision, SessionEvent } from './code-session'
import type { ModelProfile } from './model-profile'
import type { RunLog } from '../runs/run-log'

export type SessionRecord = {
  id: string
  title: string
  profile: ModelProfile
  /** Engine-side conversation id, set once the engine reports it. Lets a closed session continue. */
  engineSessionId?: string
  createdAt: string
}

export interface SessionStore {
  list(): SessionRecord[]
  save(records: SessionRecord[]): Promise<void>
}

export type EngineFactory = (record: SessionRecord) => Promise<CodeSession>

export type SessionListener = (sessionId: string, event: SessionEvent) => void

/**
 * Owns the list of sessions and the live engines behind them. A session is
 * started lazily on its first prompt, and continued from its engine session
 * id after the extension host restarted.
 */
export class SessionManager {
  private records: SessionRecord[]
  private readonly live = new Map<string, CodeSession>()

  constructor(
    private readonly store: SessionStore,
    private readonly createEngine: EngineFactory,
    private readonly runLogFor: (sessionId: string) => RunLog,
    private readonly listener: SessionListener,
  ) {
    this.records = store.list()
  }

  list(): SessionRecord[] {
    return [...this.records]
  }

  get(id: string): SessionRecord | undefined {
    return this.records.find((r) => r.id === id)
  }

  isLive(id: string): boolean {
    return this.live.has(id)
  }

  async create(profile: ModelProfile): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: crypto.randomUUID(),
      title: 'New session',
      profile,
      createdAt: new Date().toISOString(),
    }
    this.records.unshift(record)
    await this.store.save(this.records)
    return record
  }

  async send(id: string, text: string): Promise<void> {
    const record = this.require(id)
    if (record.title === 'New session') {
      record.title = text.length > 60 ? text.slice(0, 57) + '...' : text
      await this.store.save(this.records)
    }
    ;(await this.ensureLive(record)).send(text)
  }

  respondToPermission(id: string, requestId: string, decision: PermissionDecision): void {
    this.live.get(id)?.respondToPermission(requestId, decision)
  }

  async interrupt(id: string): Promise<void> {
    await this.live.get(id)?.interrupt()
  }

  /** Stop the engine but keep the record; a later prompt resumes it. */
  async close(id: string): Promise<void> {
    const session = this.live.get(id)
    if (!session) return
    this.live.delete(id)
    await session.dispose()
  }

  async remove(id: string): Promise<void> {
    await this.close(id)
    this.records = this.records.filter((r) => r.id !== id)
    await this.store.save(this.records)
  }

  transcript(id: string): Promise<SessionEvent[]> {
    return this.runLogFor(id)
      .read()
      .then((entries) => entries.map((e) => e.event))
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.close(id)))
  }

  private require(id: string): SessionRecord {
    const record = this.get(id)
    if (!record) throw new Error(`Unknown session ${id}`)
    return record
  }

  private async ensureLive(record: SessionRecord): Promise<CodeSession> {
    const existing = this.live.get(record.id)
    if (existing) return existing
    const session = await this.createEngine(record)
    this.live.set(record.id, session)
    void this.pump(record, session)
    return session
  }

  private async pump(record: SessionRecord, session: CodeSession): Promise<void> {
    const log = this.runLogFor(record.id)
    for await (const event of session.events()) {
      if (event.type === 'session_started' && record.engineSessionId !== event.engineSessionId) {
        record.engineSessionId = event.engineSessionId
        await this.store.save(this.records)
      }
      log.append(event).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        this.listener(record.id, { type: 'error', message: `Run log write failed: ${message}`, fatal: false })
      })
      this.listener(record.id, event)
    }
    if (this.live.get(record.id) === session) this.live.delete(record.id)
  }
}
