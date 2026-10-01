import { permissionResolved, type CodeSession, type PermissionDecision, type SessionEvent } from './code-session'
import type { ModelProfile, Step } from './model-profile'
import type { RunLog } from '../runs/run-log'
import { answerText, UNANSWERED_RESULT, type QuestionOutcome, type UserQuestionRequest } from './user-question'
import { nextStatus, underWay, type SessionStatus } from './session-status'

/**
 * `plan` writes a feature's spec blind, `reconcile` checks it against the code
 * (together: feature planning), `implement` builds the approved spec, `cleanup`
 * splits what the implementation left oversized. `code-plan` agrees on intent
 * and then plans against the code, with no spec, and is built in the chat it
 * continues into. `docs` judges how the docs a blind planner reads are
 * arranged, `docs-map` describes them so it can find its way, and
 * `file-decisions` files the user's unfiled decisions into the specs and docs;
 * none of those belongs to a feature.
 */
export type SessionMode = 'chat' | 'plan' | 'reconcile' | 'implement' | 'cleanup' | 'code-plan' | 'docs' | 'docs-map' | 'file-decisions'

/** Planning rather than building: no blanket allow for writes. */
export const isPlanning = (mode: Step): boolean =>
  mode === 'plan' || mode === 'reconcile' || mode === 'code-plan' || mode === 'docs' || mode === 'file-decisions'

/**
 * The steps a profile names a model for, in the order the settings page lists
 * them. A step is a mode: what a session is for is what decides how strong a
 * model it earns, so there is no second vocabulary to keep in step.
 */
export const STEPS: { step: Step; label: string; hint: string }[] = [
  { step: 'chat', label: 'Chat', hint: 'Work in the code with the full tool set.' },
  { step: 'plan', label: 'Feature planning', hint: 'Write the spec from the intent docs, blind to the code.' },
  { step: 'code-plan', label: 'Plan', hint: 'Agree on intent, then plan against the code.' },
  { step: 'reconcile', label: 'Check against code', hint: 'Name each disagreement between the approved spec and the code before it is built.' },
  { step: 'implement', label: 'Implement', hint: 'Build the approved spec, task by task, with a test per rule.' },
  { step: 'fix', label: 'Fix', hint: 'Mend what a failed test run names; one effort level harder each time it fails again.' },
  { step: 'cleanup', label: 'Cleanup', hint: 'Split what the implementation left oversized.' },
  { step: 'docs', label: 'Evaluate docs', hint: 'Judge how the docs a blind planner reads are arranged.' },
  { step: 'docs-map', label: 'Docs map', hint: 'Describe the docs so a blind planner can find its way.' },
  { step: 'file-decisions', label: 'File decisions', hint: "File the user's unfiled decisions into the specs and docs they belong in." },
]

/** The modes that stand on their own rather than on a feature's plan files. */
export const isFeatureless = (mode: Step): boolean =>
  mode === 'chat' || mode === 'code-plan' || mode === 'docs' || mode === 'docs-map' || mode === 'file-decisions'

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
  /** The board task an implement run builds; absent on a run that fixes a failed test sweep. */
  task?: string
  /** On a run that fixes a failed test sweep: how many sweeps in a row have failed, which sets how hard it tries. */
  fixAttempt?: number
  /** The run's job is done (its task settled, its fix handed back to the test run): history, never again what the person talks to. */
  settled?: true
  /**
   * Engine-side conversation id, what lets a closed session continue. For the
   * Claude SDK it is the engine's own, inherited from the session this one
   * continues; for the own loop it names the session record whose run log
   * this conversation starts in.
   */
  engineSessionId?: string
  /** The host went away while the turn was under way and not waiting on the user: the next host carries it on. */
  cutOff?: true
  createdAt: string
}

/** The step a session's profile resolves as: a fix of a failed test sweep is an implement session but a step of its own. */
export const stepOf = (record: SessionRecord): Step => (record.fixAttempt !== undefined ? 'fix' : record.mode)

export interface SessionStore {
  list(): SessionRecord[]
  save(records: SessionRecord[]): Promise<void>
}

function titleFor(mode: SessionMode, feature: string | undefined): string {
  // Named before the feature is looked at: neither stands on one.
  if (mode === 'docs') return 'Docs evaluation'
  if (mode === 'docs-map') return 'Docs map'
  if (mode === 'file-decisions') return 'Filing decisions'
  if (!feature) return 'New session'
  switch (mode) {
    case 'plan':
      return `Feature: ${feature}`
    case 'reconcile':
      return `Map: ${feature}`
    case 'implement':
      return `Implement: ${feature}`
    case 'cleanup':
      return `Cleanup: ${feature}`
    case 'chat':
    case 'code-plan':
      return 'New session'
  }
}

export type CreateOptions = {
  parentId?: string
  files?: string[]
  task?: string
  fixAttempt?: number
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

/** Brings a session's engine up, reporting each phase of the start-up as it enters it. */
export type EngineFactory = (record: SessionRecord, onProgress: (line: string) => void) => Promise<CodeSession>

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
  /** Per session, what its events say it is doing: what a shutdown needs to know which turns it cuts off. */
  private readonly statuses = new Map<string, SessionStatus>()

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
    const { parentId, files, task, fixAttempt, continues } = options
    const continued = continues ? continuationOf(continues, profile) : undefined
    const record: SessionRecord = {
      id: crypto.randomUUID(),
      title: task ? `Implement: ${task}` : titleFor(mode, feature),
      profile,
      mode,
      ...(feature ? { feature } : {}),
      ...(parentId ? { parentId } : {}),
      ...(files ? { files } : {}),
      ...(task ? { task } : {}),
      ...(fixAttempt ? { fixAttempt } : {}),
      ...(continued ? { engineSessionId: continued } : {}),
      createdAt: new Date().toISOString(),
    }
    this.records.unshift(record)
    await this.store.save(this.records)
    return record
  }

  /**
   * A chat that carries a session's conversation on with the full tool set, for
   * work past what that session's mode allows. It keeps the profile so the engine
   * resumes, and the session it continues stops: one engine per conversation.
   */
  async continueInChat(id: string): Promise<SessionRecord> {
    const previous = this.require(id)
    await this.close(id)
    return await this.create(previous.profile, 'chat', undefined, { continues: previous })
  }

  async send(id: string, text: string): Promise<void> {
    const record = this.require(id)
    if (record.title === 'New session') {
      record.title = text.length > 60 ? text.slice(0, 57) + '...' : text
      await this.store.save(this.records)
    }
    if (record.cutOff || record.settled) {
      // A settled run sent work again (its task reopened) has a job once more.
      delete record.cutOff
      delete record.settled
      await this.store.save(this.records)
    }
    // Echoed here rather than by the engine, and the start-up said out loud: bringing an
    // engine up can take a repo or docs map build, and the wait is the user's to see.
    await this.emit(record, { type: 'user_message', text })
    if (!this.live.has(id)) await this.emit(record, { type: 'status', status: 'starting' })
    let session: CodeSession
    try {
      session = await this.ensureLive(record)
    } catch (error) {
      // The start-up is over either way; the chat must stop showing it as under way.
      await this.emit(record, { type: 'error', message: error instanceof Error ? error.message : String(error), fatal: true })
      throw error
    }
    session.send(text)
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
    await this.emit(record, permissionResolved(requestId, decision))
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

  /**
   * Switches a session to a model chosen mid-conversation: the engine stops,
   * the next prompt starts it again on the new profile. The conversation
   * carries only within the same engine, by the rule a new session follows
   * when it continues one; across engines it starts from the files on disk.
   */
  async setProfile(id: string, profile: ModelProfile): Promise<void> {
    const record = this.require(id)
    await this.close(id)
    const continued = continuationOf(record, profile)
    record.profile = profile
    if (continued) record.engineSessionId = continued
    else delete record.engineSessionId
    await this.store.save(this.records)
  }

  async interrupt(id: string): Promise<void> {
    await this.live.get(id)?.interrupt()
  }

  /** Only a running engine holds a conversation to fold; a stopped one is compacted, if need be, once it runs again. */
  compact(id: string): void {
    this.live.get(id)?.compact()
  }

  /** Stop the engine but keep the record; a later prompt resumes it. A run under the session stops with it. */
  async close(id: string): Promise<void> {
    for (const child of this.records.filter((r) => r.parentId === id)) await this.close(child.id)
    const session = this.live.get(id)
    if (!session) return
    this.live.delete(id)
    await session.dispose()
  }

  /** Closed because its job is done, unlike a run merely stopped, which still waits on the person. */
  async settle(id: string): Promise<void> {
    const record = this.require(id)
    record.settled = true
    await this.store.save(this.records)
    await this.close(id)
  }

  async remove(id: string): Promise<void> {
    await this.close(id)
    this.records = this.records.filter((r) => r.id !== id && r.parentId !== id)
    this.logs.delete(id)
    this.statuses.delete(id)
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

  /** The host is going away: a turn it cuts off is marked before its engine stops, so the next host can carry it on. */
  async disposeAll(): Promise<void> {
    const cut = this.records.filter((r) => this.live.has(r.id) && underWay(this.statuses.get(r.id) ?? 'idle'))
    for (const record of cut) record.cutOff = true
    if (cut.length > 0) await this.store.save(this.records)
    await Promise.all([...this.live.keys()].map((id) => this.close(id)))
  }

  /** The runs the last host cut off mid-turn, each handed out once: a later reload does not carry them on again. */
  async takeCutOff(): Promise<SessionRecord[]> {
    const cut = this.records.filter((r) => r.cutOff)
    for (const record of cut) delete record.cutOff
    if (cut.length > 0) await this.store.save(this.records)
    return cut
  }

  private require(id: string): SessionRecord {
    const record = this.get(id)
    if (!record) throw new Error(`Unknown session ${id}`)
    return record
  }

  private async ensureLive(record: SessionRecord): Promise<CodeSession> {
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
        await this.store.save(this.records)
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
        const message = error instanceof Error ? error.message : String(error)
        this.listener(record.id, { type: 'error', message: `Run log write failed: ${message}`, fatal: false })
      })
    this.notify(record, event)
  }

  private notify(record: SessionRecord, event: SessionEvent): void {
    this.statuses.set(record.id, nextStatus(this.statuses.get(record.id) ?? 'idle', record.mode, event))
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
  private async emit(record: SessionRecord, event: SessionEvent): Promise<void> {
    await this.logFor(record.id).append(event)
    this.notify(record, event)
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
