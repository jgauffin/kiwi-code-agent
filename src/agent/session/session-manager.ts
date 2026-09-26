import type { CodeSession, PermissionDecision, SessionEvent } from './code-session'
import type { ModelProfile } from './model-profile'
import type { RunLog } from '../runs/run-log'
import { answerText, UNANSWERED_RESULT, type QuestionOutcome, type UserQuestionRequest } from './user-question'

/**
 * `plan` writes a feature's spec blind, `reconcile` checks it against the code
 * (together: planning), `implement` builds the approved spec, `cleanup` splits
 * what the implementation left oversized. `docs` judges how the docs a blind
 * planner reads are arranged, and `docs-map` describes them so it can find its
 * way; neither belongs to a feature.
 */
export type SessionMode = 'chat' | 'plan' | 'reconcile' | 'implement' | 'cleanup' | 'docs' | 'docs-map'

/** Work in the intent rather than the code: the plan profile, and no blanket allow for writes. */
export const isPlanning = (mode: SessionMode): boolean => mode === 'plan' || mode === 'reconcile' || mode === 'docs'

/** The modes that stand on their own rather than on a feature's plan files. */
export const isFeatureless = (mode: SessionMode): boolean => mode === 'chat' || mode === 'docs' || mode === 'docs-map'

/** A build, not a conversation: it has no tab and no entry of its own, and nobody prompts it. */
export const isBuild = (mode: SessionMode): boolean => mode === 'docs-map'

export type SessionRecord = {
  id: string
  title: string
  profile: ModelProfile
  mode: SessionMode
  /** The feature whose spec the session works on; every mode but chat. */
  feature?: string
  /** The session whose tab this one runs under: a check runs under its plan session and never gets a tab of its own. */
  parentId?: string
  /** The workspace-relative paths a run was handed: what a cleanup may write, what a docs map build may read. */
  files?: string[]
  /**
   * Engine-side conversation id, what lets a closed session continue. For the
   * Claude SDK it is the engine's own, inherited from the session this one
   * continues; for the own loop it names the session record whose run log
   * this conversation starts in.
   */
  engineSessionId?: string
  createdAt: string
}

export interface SessionStore {
  list(): SessionRecord[]
  save(records: SessionRecord[]): Promise<void>
}

function titleFor(mode: SessionMode, feature: string | undefined): string {
  // Named before the feature is looked at: neither stands on one.
  if (mode === 'docs') return 'Docs evaluation'
  if (mode === 'docs-map') return 'Docs map'
  if (!feature) return 'New session'
  switch (mode) {
    case 'plan':
      return `Plan: ${feature}`
    case 'reconcile':
      return `Map: ${feature}`
    case 'implement':
      return `Implement: ${feature}`
    case 'cleanup':
      return `Cleanup: ${feature}`
    case 'chat':
      return 'New session'
  }
}

export type CreateOptions = {
  parentId?: string
  files?: string[]
  /**
   * The session whose conversation the new one carries on, so what it read is
   * not read again. Honoured on the same engine; across engines the session
   * starts empty and the files on disk are its whole input.
   */
  continues?: SessionRecord | undefined
}

/** What the new session resumes from: the engine's conversation id for the Claude SDK, the previous record's log for the own loop. */
export function continuationOf(previous: SessionRecord, profile: ModelProfile): string | undefined {
  if (previous.engineSessionId === undefined || previous.profile.engine !== profile.engine) return undefined
  switch (profile.engine) {
    case 'claude-sdk':
      return previous.engineSessionId
    case 'openai-compatible':
      return previous.id
  }
}

export type EngineFactory = (record: SessionRecord) => Promise<CodeSession>

export type SessionListener = (sessionId: string, event: SessionEvent) => void

/**
 * A last pass over an event before it is logged and shown, for what the host
 * knows and the engine does not — the diff of a file edit, say. It runs once,
 * so what it adds is in the run log and survives a reload.
 */
export type EventDecorator = (sessionId: string, event: SessionEvent) => Promise<SessionEvent>

const noDecoration: EventDecorator = async (_sessionId, event) => event

/**
 * Owns the list of sessions and the live engines behind them. A session is
 * started lazily on its first prompt, and continued from its engine session
 * id after the extension host restarted.
 */
export class SessionManager {
  private records: SessionRecord[]
  private readonly live = new Map<string, CodeSession>()
  /** Per session, the call the user allowed after its engine had stopped; answered for them when the resumed engine asks. */
  private readonly preapproved = new Map<string, { toolName: string; input: string }>()
  /** One log per session: the write chain that keeps entries in emission order belongs to the instance. */
  private readonly logs = new Map<string, RunLog>()

  constructor(
    private readonly store: SessionStore,
    private readonly createEngine: EngineFactory,
    private readonly runLogFor: (sessionId: string) => RunLog,
    private readonly listener: SessionListener,
    private readonly decorate: EventDecorator = noDecoration,
  ) {
    // Records written before modes existed are chat sessions.
    this.records = store.list().map((r) => ({ ...r, mode: r.mode ?? 'chat' }))
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

  /** Every engine running now, for what the host applies to all of them at once. */
  liveSessions(): CodeSession[] {
    return [...this.live.values()]
  }

  /** One MCP server of a live session, tried again; nothing to do for a session that is not running. */
  async reconnectMcp(id: string, server: string): Promise<void> {
    await this.live.get(id)?.mcp?.reconnect(server)
  }

  /** The live session running under another one's tab, if any. */
  liveChildOf(parentId: string): SessionRecord | undefined {
    return this.records.find((r) => r.parentId === parentId && this.live.has(r.id))
  }

  /** The newest record of a mode on a feature, live or not: the one that knows the feature best. */
  latest(mode: SessionMode, feature: string): SessionRecord | undefined {
    return this.records.find((r) => r.mode === mode && r.feature === feature)
  }

  async create(profile: ModelProfile, mode: SessionMode = 'chat', feature?: string, options: CreateOptions = {}): Promise<SessionRecord> {
    const { parentId, files, continues } = options
    const continued = continues ? continuationOf(continues, profile) : undefined
    const record: SessionRecord = {
      id: crypto.randomUUID(),
      title: titleFor(mode, feature),
      profile,
      mode,
      ...(feature ? { feature } : {}),
      ...(parentId ? { parentId } : {}),
      ...(files ? { files } : {}),
      ...(continued ? { engineSessionId: continued } : {}),
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
    // Echoed here rather than by the engine, and the start-up said out loud: bringing an
    // engine up can take a repo or docs map build, and the wait is the user's to see.
    await this.emit(record, { type: 'user_message', text })
    if (!this.live.has(id)) await this.emit(record, { type: 'status', status: 'starting' })
    ;(await this.ensureLive(record)).send(text)
  }

  /**
   * A request the engine still holds is answered in place. One the engine let
   * go of (it stopped with the prompt open, say over a window reload) resumes
   * the session: the decision becomes the next user turn, and an allow is
   * honoured once more should the resumed engine ask for the same call again.
   */
  async respondToPermission(id: string, requestId: string, decision: PermissionDecision): Promise<void> {
    const live = this.live.get(id)
    if (live) {
      live.respondToPermission(requestId, decision)
      return
    }
    const record = this.require(id)
    const request = await this.openRequest(record, requestId)
    if (!request) throw new Error(`Permission request ${requestId} is no longer open`)
    await this.emit(record, { type: 'permission_resolved', requestId, decision: decision.kind })
    if (decision.kind === 'allow') this.preapproved.set(id, { toolName: request.toolName, input: JSON.stringify(request.input) })
    await this.send(id, decisionPrompt(request, decision))
  }

  /**
   * The answer goes to the engine that asked while it still holds the
   * question. One that let go of it — the turn ended around the card, the
   * window was reloaded — is not a reason to throw a decision the user already
   * made away: it becomes the session's next prompt, so the answer arrives a
   * turn late rather than not at all.
   */
  async respondToQuestion(id: string, requestId: string, outcome: QuestionOutcome): Promise<void> {
    if (this.live.get(id)?.respondToQuestion(requestId, outcome)) return
    const record = this.require(id)
    const request = await this.openQuestion(record, requestId)
    if (!request) throw new Error(`Question ${requestId} is no longer open`)
    await this.emit(record, { type: 'question_resolved', requestId, outcome })
    await this.send(id, questionPrompt(request.request, outcome))
  }

  async interrupt(id: string): Promise<void> {
    await this.live.get(id)?.interrupt()
  }

  /** Stop the engine but keep the record; a later prompt resumes it. A run under the session stops with it. */
  async close(id: string): Promise<void> {
    for (const child of this.records.filter((r) => r.parentId === id)) await this.close(child.id)
    const session = this.live.get(id)
    if (!session) return
    this.live.delete(id)
    await session.dispose()
  }

  async remove(id: string): Promise<void> {
    await this.close(id)
    this.records = this.records.filter((r) => r.id !== id && r.parentId !== id)
    this.logs.delete(id)
    await this.store.save(this.records)
  }

  async transcript(id: string): Promise<SessionEvent[]> {
    const log = this.logFor(id)
    // Everything queued is on disk before it is read back: a request answered right after it arrived is in there.
    await log.settled()
    return (await log.read()).map((e) => e.event)
  }

  /** The session's log, kept: entries land in emission order only while one instance chains the writes. */
  private logFor(id: string): RunLog {
    const existing = this.logs.get(id)
    if (existing) return existing
    const log = this.runLogFor(id)
    this.logs.set(id, log)
    return log
  }

  /**
   * The whole conversation behind a session: the transcripts of the sessions
   * it continues, oldest first, then its own. Only the own loop's records name
   * a record as their engine session; any other id resolves to nothing.
   */
  async conversation(id: string): Promise<SessionEvent[]> {
    const record = this.require(id)
    const previous = record.engineSessionId !== undefined && record.engineSessionId !== id ? this.get(record.engineSessionId) : undefined
    const own = await this.transcript(id)
    return previous ? [...(await this.conversation(previous.id)), ...own] : own
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
    const log = this.logFor(record.id)
    for await (const raw of session.events()) {
      // A decoration that fails must not cost the event itself.
      const event = await this.decorate(record.id, raw).catch(() => raw)
      if (event.type === 'session_started' && record.engineSessionId !== event.engineSessionId) {
        record.engineSessionId = event.engineSessionId
        await this.store.save(this.records)
      }
      log.append(event).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        this.listener(record.id, { type: 'error', message: `Run log write failed: ${message}`, fatal: false })
      })
      this.listener(record.id, event)
      this.answerPreapproved(record.id, session, event)
    }
    if (this.live.get(record.id) === session) this.live.delete(record.id)
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
  private async emit(record: SessionRecord, event: SessionEvent): Promise<void> {
    await this.logFor(record.id).append(event)
    this.listener(record.id, event)
  }

  /** The request as logged, if nothing has decided it since. */
  private async openRequest(record: SessionRecord, requestId: string): Promise<PermissionRequest | undefined> {
    let request: PermissionRequest | undefined
    for (const event of await this.transcript(record.id)) {
      if (event.type === 'permission_request' && event.requestId === requestId) request = event
      if (event.type === 'permission_resolved' && event.requestId === requestId) request = undefined
    }
    return request
  }

  /** The question as logged, if nothing has resolved it since; a request is resolved at most once. */
  private async openQuestion(record: SessionRecord, requestId: string): Promise<QuestionRequest | undefined> {
    let request: QuestionRequest | undefined
    for (const event of await this.transcript(record.id)) {
      if (event.type === 'question_request' && event.requestId === requestId) request = event
      if (event.type === 'question_resolved' && event.requestId === requestId) request = undefined
    }
    return request
  }
}

type PermissionRequest = Extract<SessionEvent, { type: 'permission_request' }>
type QuestionRequest = Extract<SessionEvent, { type: 'question_request' }>

/** The answers as the model hears them once the engine that asked is gone: the questions are repeated so nothing rests on what the resumed engine remembers. */
export function questionPrompt(request: UserQuestionRequest, outcome: QuestionOutcome): string {
  if (outcome.kind === 'unanswered') return `The question you asked was not answered.\n\n${UNANSWERED_RESULT}`
  return `Your question was answered:\n\n${answerText(request, outcome.answers)}`
}

/** The decision as the model hears it once the engine that asked is gone: the call is named in full so nothing rests on what the resumed engine remembers. */
export function decisionPrompt(request: PermissionRequest, decision: PermissionDecision): string {
  const call = `the \`${request.toolName}\` call you proposed`
  const input = `\`\`\`json\n${JSON.stringify(request.input, null, 2)}\n\`\`\``
  switch (decision.kind) {
    case 'allow':
      return `Go ahead with ${call}; it is allowed.\n\n${input}`
    case 'deny':
      return `Do not make ${call}; it is denied${decision.message ? `: ${decision.message}` : ''}.\n\n${input}`
  }
}
