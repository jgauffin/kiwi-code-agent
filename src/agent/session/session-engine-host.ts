import type { CodeSession, SessionEvent } from './code-session'
import type { RunLog } from '../runs/run-log'
import { nextStatus, underWay, type SessionStatus } from './session-status'
import { actingMode, type EngineFactory, type EventDecorator, type SessionListener, type SessionRecord } from './session-manager'
import { errorMessage } from '../../error-message'

export type PermissionRequest = Extract<SessionEvent, { type: 'permission_request' }>
export type QuestionRequest = Extract<SessionEvent, { type: 'question_request' }>

/** What the host needs from the records `SessionManager` owns: one by id, all of them, and saving a change back. */
export interface SessionRecords {
  get(id: string): SessionRecord | undefined
  all(): SessionRecord[]
  save(): Promise<void>
}

/** Runs the live engine behind each session and keeps its event log and status; a session is started lazily on its first prompt. */
export class SessionEngineHost {
  private readonly live = new Map<string, CodeSession>()
  /** Per session, the call the user allowed after its engine had stopped; answered for them when the resumed engine asks. */
  private readonly preapproved = new Map<string, { toolName: string; input: string }>()
  /** One log per session: the write chain that keeps entries in emission order belongs to the instance. */
  private readonly logs = new Map<string, RunLog>()
  /** Per session, what its events say it is doing: what a shutdown needs to know which turns it cuts off. */
  private readonly statuses = new Map<string, SessionStatus>()

  constructor(
    private readonly records: SessionRecords,
    private readonly createEngine: EngineFactory,
    private readonly runLogFor: (sessionId: string) => RunLog,
    private readonly listener: SessionListener,
    private readonly decorate: EventDecorator,
  ) {}

  /** Every engine running now, for what the host applies to all of them at once. */
  liveSessions(): CodeSession[] {
    return [...this.live.values()]
  }

  liveSession(id: string): CodeSession | undefined {
    return this.live.get(id)
  }

  /** Starts or stops one MCP server of a live session; nothing to do for a session that is not running. */
  async switchMcp(id: string, server: string, running: boolean): Promise<void> {
    const mcp = this.live.get(id)?.mcp
    await (running ? mcp?.start(server) : mcp?.stop(server))
  }

  /** The live session running under another one's tab, if any. */
  liveChildOf(parentId: string): SessionRecord | undefined {
    return this.records.all().find((r) => r.parentId === parentId && this.live.has(r.id))
  }

  /** Only a running engine holds a conversation to fold; a stopped one is compacted, if need be, once it runs again. */
  compact(id: string): void {
    this.live.get(id)?.compact()
  }

  async interrupt(id: string): Promise<void> {
    await this.live.get(id)?.interrupt()
  }

  /** Stop the engine but keep the record; a later prompt resumes it. A run under the session stops with it. */
  async close(id: string): Promise<void> {
    for (const child of this.records.all().filter((r) => r.parentId === id)) await this.close(child.id)
    const session = this.live.get(id)
    if (!session) return
    this.live.delete(id)
    await session.dispose()
  }

  /** The host is going away: a turn it cuts off is marked before its engine stops, so the next host can carry it on. */
  async disposeAll(): Promise<void> {
    const cut = this.records.all().filter((r) => this.live.has(r.id) && underWay(this.statuses.get(r.id) ?? 'idle'))
    for (const record of cut) record.cutOff = true
    if (cut.length > 0) await this.records.save()
    await Promise.all([...this.live.keys()].map((id) => this.close(id)))
  }

  forget(id: string): void {
    this.logs.delete(id)
    this.statuses.delete(id)
  }

  async transcript(id: string): Promise<SessionEvent[]> {
    const log = this.logFor(id)
    // Everything queued is on disk before it is read back: a request answered right after it arrived is in there.
    await log.settled()
    return (await log.read()).map((e) => e.event)
  }

  /**
   * The whole conversation behind a session: the transcripts of the sessions
   * it continues, oldest first, then its own. Only the own loop's records name
   * a record as their engine session; any other id resolves to nothing.
   */
  async conversation(id: string): Promise<SessionEvent[]> {
    const record = this.requireRecord(id)
    const previous = record.engineSessionId !== undefined && record.engineSessionId !== id ? this.records.get(record.engineSessionId) : undefined
    const own = await this.transcript(id)
    return previous ? [...(await this.conversation(previous.id)), ...own] : own
  }

  /** Whether a permission or question request still waits on an answer: false once whichever device got there first has resolved it. */
  async isRequestOpen(id: string, requestId: string): Promise<boolean> {
    const record = this.requireRecord(id)
    if ((await this.openRequest(record, requestId)) !== undefined) return true
    return (await this.openQuestion(record, requestId)) !== undefined
  }

  notePreapproval(id: string, toolName: string, input: string): void {
    this.preapproved.set(id, { toolName, input })
  }

  async ensureLive(record: SessionRecord): Promise<CodeSession> {
    const existing = this.live.get(record.id)
    if (existing) return existing
    const session = await this.createEngine(record, (line) => this.publish(record, { type: 'status', status: 'starting', detail: line }))
    this.live.set(record.id, session)
    void this.pump(record, session)
    return session
  }

  private async pump(record: SessionRecord, session: CodeSession): Promise<void> {
    for await (const raw of session.events()) {
      // A decoration that fails must not cost the event itself.
      const event = await this.decorate(record.id, raw).catch(() => raw)
      if (event.type === 'session_started' && record.engineSessionId !== event.engineSessionId) {
        record.engineSessionId = event.engineSessionId
        await this.records.save()
      }
      this.publish(record, event)
      this.answerPreapproved(record.id, session, event)
    }
    if (this.live.get(record.id) === session) this.live.delete(record.id)
  }

  /** Shown at once and logged in emission order, without waiting on the write: what follows may not overtake it on screen. */
  private publish(record: SessionRecord, event: SessionEvent): void {
    this.logFor(record.id)
      .append(event)
      .catch((error: unknown) => {
        const message = errorMessage(error)
        this.listener(record.id, { type: 'error', message: `Run log write failed: ${message}`, fatal: false })
      })
    this.notify(record, event)
  }

  private notify(record: SessionRecord, event: SessionEvent): void {
    this.statuses.set(record.id, nextStatus(this.statuses.get(record.id) ?? 'idle', actingMode(record), event))
    this.listener(record.id, event)
  }

  /** The allow given after a restart covers one call, in the turn it resumed; anything else is the user's to decide. */
  private answerPreapproved(id: string, session: CodeSession, event: SessionEvent): void {
    const approved = this.preapproved.get(id)
    if (!approved) return
    if (event.type === 'turn_done' || event.type === 'ended') {
      this.preapproved.delete(id)
      return
    }
    if (event.type !== 'permission_request') return
    if (event.toolName !== approved.toolName || JSON.stringify(event.input) !== approved.input) return
    this.preapproved.delete(id)
    session.respondToPermission(event.requestId, { kind: 'allow' })
  }

  /** An event of the session's own, outside its engine: logged and shown like the engine's. */
  async emit(record: SessionRecord, event: SessionEvent): Promise<void> {
    await this.logFor(record.id).append(event)
    this.notify(record, event)
  }

  /** The request as logged, if nothing has decided it since. */
  async openRequest(record: SessionRecord, requestId: string): Promise<PermissionRequest | undefined> {
    return (await this.openRequests(record)).find((request) => request.requestId === requestId)
  }

  /** Every prompt the log shows as still waiting, in the order they were asked. */
  async openRequests(record: SessionRecord): Promise<PermissionRequest[]> {
    const open = new Map<string, PermissionRequest>()
    for (const event of await this.transcript(record.id)) {
      if (event.type === 'permission_request') open.set(event.requestId, event)
      if (event.type === 'permission_resolved') open.delete(event.requestId)
    }
    return [...open.values()]
  }

  /** The question as logged, if nothing has resolved it since; a request is resolved at most once. */
  async openQuestion(record: SessionRecord, requestId: string): Promise<QuestionRequest | undefined> {
    let request: QuestionRequest | undefined
    for (const event of await this.transcript(record.id)) {
      if (event.type === 'question_request' && event.requestId === requestId) request = event
      if (event.type === 'question_resolved' && event.requestId === requestId) request = undefined
    }
    return request
  }

  /** The session's log, kept: entries land in emission order only while one instance chains the writes. */
  private logFor(id: string): RunLog {
    const existing = this.logs.get(id)
    if (existing) return existing
    const log = this.runLogFor(id)
    this.logs.set(id, log)
    return log
  }

  private requireRecord(id: string): SessionRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`Unknown session ${id}`)
    return record
  }
}
