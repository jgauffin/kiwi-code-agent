import type { CodeSession, PermissionDecision, SessionEvent } from './code-session'
import type { ModelProfile } from './model-profile'
import type { RunLog } from '../runs/run-log'
import { answerText, UNANSWERED_RESULT, type QuestionOutcome, type UserQuestionRequest } from './user-question'

/**
 * `plan` writes a feature's spec blind, `reconcile` checks it against the code
 * (together: planning), `implement` builds the approved spec, `cleanup` splits
 * what the implementation left oversized.
 */
export type SessionMode = 'chat' | 'plan' | 'reconcile' | 'implement' | 'cleanup'

export const isPlanning = (mode: SessionMode): boolean => mode === 'plan' || mode === 'reconcile'

export type SessionRecord = {
  id: string
  title: string
  profile: ModelProfile
  mode: SessionMode
  /** The feature whose spec the session works on; every mode but chat. */
  feature?: string
  /** The session whose tab this one runs under: a check runs under its plan session and never gets a tab of its own. */
  parentId?: string
  /** Workspace-relative paths a cleanup run was given to split; what it may write, beside new files next to them. */
  files?: string[]
  /** Engine-side conversation id: the engine's own once it reports it, or inherited from the session this one continues. Lets a closed session continue. */
  engineSessionId?: string
  createdAt: string
}

export interface SessionStore {
  list(): SessionRecord[]
  save(records: SessionRecord[]): Promise<void>
}

function titleFor(mode: SessionMode, feature: string | undefined): string {
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
   * not read again. Honoured when the engine resumes; otherwise the session
   * starts empty and the files on disk are its whole input.
   */
  continues?: SessionRecord | undefined
}

/** The Claude SDK resumes a conversation by its id; the own loop starts every session empty. */
export function canContinue(previous: SessionRecord, profile: ModelProfile): boolean {
  return previous.engineSessionId !== undefined && previous.profile.engine === 'claude-sdk' && profile.engine === 'claude-sdk'
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
    const continued = continues && canContinue(continues, profile) ? continues.engineSessionId : undefined
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
    await this.runLogFor(record.id).append(event)
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
