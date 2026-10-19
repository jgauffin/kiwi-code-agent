import type { CodeSession, PermissionDecision, SessionEvent } from './code-session'
import type { ModelProfile, Step } from './model-profile'
import type { RunLog } from '../runs/run-log'
import type { QuestionOutcome } from './user-question'
import type { ToolUse } from './hooks'
import type { Grant } from '../permissions/grants'
import { featureSlug } from '../phases/feature-slug'
import { SessionEngineHost } from './session-engine-host'
import { SessionControl } from './session-control'

/**
 * `plan` writes a feature's spec blind, `reconcile` checks it against the code
 * (together: feature planning), `implement` builds the approved spec, `cleanup`
 * splits what the implementation left oversized. `code-plan` agrees on intent
 * and then plans against the code, with no spec, and is built in the same
 * session once the plan is approved. `docs-map` describes the docs so a blind
 * planner can find its way, `file-decisions` files the user's unfiled
 * decisions into the specs and docs, and `doc-migration` cleans up the docs:
 * prunes what a settled spec already says, offers the behaviour no spec holds
 * as specs of their own, and tidies how the rest is arranged. None of those
 * belongs to a feature.
 */
export type SessionMode = 'chat' | 'plan' | 'reconcile' | 'implement' | 'cleanup' | 'code-plan' | 'docs-map' | 'file-decisions' | 'doc-migration'

/** Planning rather than building: no blanket allow for writes. */
export const isPlanning = (mode: Step): boolean =>
  mode === 'plan' || mode === 'reconcile' || mode === 'code-plan' || mode === 'file-decisions' || mode === 'doc-migration'

/**
 * Whether the composer offers "Allow writes". A planning mode's writes are the
 * user's to confirm one by one, except where the job is editing the docs: the
 * switch then lets writes through, and the mode's scope still bounds them.
 */
export const offersAllowWrites = (mode: SessionMode): boolean => !isPlanning(mode) || mode === 'file-decisions' || mode === 'doc-migration'

/**
 * The steps a profile names a model for, in the order the settings page lists
 * them. A step is a mode: what a session is for is what decides how strong a
 * model it earns, so there is no second vocabulary to keep in step.
 */
export const STEPS: { step: Step; group: StepGroup; label: string; hint: string }[] = [
  { step: 'chat', group: 'Chat', label: 'Chat', hint: 'Work in the code with the full tool set.' },
  { step: 'code-plan', group: 'Plan', label: 'Planning', hint: 'Agree on intent, then plan against the code.' },
  { step: 'code-build', group: 'Plan', label: 'Build', hint: "Build the approved plan in the plan's own conversation, so on the same engine." },
  { step: 'plan', group: 'Feature planning', label: 'Spec', hint: 'Write the spec from the intent docs, blind to the code.' },
  { step: 'reconcile', group: 'Feature planning', label: 'Check against code', hint: 'Name each disagreement between the approved spec and the code before it is built.' },
  { step: 'implement', group: 'Feature planning', label: 'Implement', hint: 'Build the approved spec, task by task, with a test per rule.' },
  { step: 'fix', group: 'Feature planning', label: 'Fix', hint: 'Mend what a failed test run names; one effort level harder each time it fails again.' },
  { step: 'cleanup', group: 'Feature planning', label: 'Cleanup', hint: 'Split what the implementation left oversized.' },
  { step: 'docs-map', group: 'Maintenance', label: 'Docs map', hint: 'Describe the docs so a blind planner can find its way.' },
  { step: 'file-decisions', group: 'Maintenance', label: 'File decisions', hint: "File the user's unfiled decisions into the specs and docs they belong in." },
  { step: 'doc-migration', group: 'Maintenance', label: 'Clean up docs', hint: 'Move behaviour into specs, drop what the specs already say, and make the rest easy to find.' },
]

/** The kind of session a step belongs to: the settings page shows one group at a time. */
export type StepGroup = 'Chat' | 'Plan' | 'Feature planning' | 'Maintenance'

export const STEP_GROUPS: StepGroup[] = ['Chat', 'Plan', 'Feature planning', 'Maintenance']

/** A step named where its group is not shown around it: "Feature planning · Spec". */
export function stepTitle(step: Step): string {
  const entry = STEPS.find((s) => s.step === step)
  if (!entry) return step
  return entry.group === entry.label ? entry.label : `${entry.group} · ${entry.label}`
}

/** The modes that stand on their own rather than on a feature's plan files. */
export const isFeatureless = (mode: Step): boolean =>
  mode === 'chat' || mode === 'code-plan' || mode === 'docs-map' || mode === 'file-decisions' || mode === 'doc-migration'

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
   * What the session may do: `scoped` (the default) by its mode, `full` with the
   * chat's tool set. Granted one way and in place, once a code plan is approved:
   * the scope had that work to protect, and there is none left.
   */
  access?: 'scoped' | 'full'
  /**
   * Engine-side conversation id, what lets a closed session continue. For the
   * Claude SDK it is the engine's own, inherited from the session this one
   * continues; for the own loop it names the session record whose run log
   * this conversation starts in.
   */
  engineSessionId?: string
  /** The host went away while the turn was under way and not waiting on the user: the next host carries it on. */
  cutOff?: true
  /** "Allow writes" is on: writes in the project pass without a prompt, within what the mode lets the session touch. */
  allowWrites?: true
  /** Answers the person kept for this session, in force beside the workspace's and their own. Kept across engines and hosts. */
  grants?: Grant[]
  /** Answers kept for this session in the form used before grants; read as grants where they grant a directory. */
  allowed?: string[]
  denied?: string[]
  /** On a plan session: the spec as its last turn ended on it, by fingerprint, so a revision made by another hand is told apart from its own. */
  specSeen?: string
  /** Where the session began: one started from the phone may push to the paired phones regardless of the workspace's standing default. Absent means the desk. */
  startedFrom?: 'phone' | 'desk'
  /** The person's own choice for this session, overriding the default for where it started: whether a turn stopped mid-way on them may push to the paired phones. */
  pushAllowed?: boolean
  createdAt: string
  /** When the session was last sent a prompt; absent on one stored before this was kept. */
  lastActiveAt?: string
}

/** When the session was last worked in: its last prompt, else its start. */
export const lastActive = (record: SessionRecord): string => record.lastActiveAt ?? record.createdAt

/** The mode a session behaves as now: one granted full access works like a chat. */
export const actingMode = (record: SessionRecord): SessionMode => (record.access === 'full' ? 'chat' : record.mode)

/** The step a session's profile resolves as: a fix of a failed test sweep is an implement session but a step of its own. */
export const stepOf = (record: SessionRecord): Step => (record.fixAttempt !== undefined ? 'fix' : record.mode)

export interface SessionStore {
  list(): SessionRecord[]
  save(records: SessionRecord[]): Promise<void>
}

function titleFor(mode: SessionMode, feature: string | undefined): string {
  // Named before the feature is looked at: neither stands on one.
  if (mode === 'docs-map') return 'Docs map'
  if (mode === 'file-decisions') return 'Filing decisions'
  if (mode === 'doc-migration') return 'Docs cleanup'
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
  /** Set when the session is started from the paired phone rather than at the desk. */
  startedFrom?: 'phone' | 'desk'
}

/** What the new session resumes from: the engine's conversation id for the Claude SDK, the previous record's log for the own loop. */
export function continuationOf(previous: SessionRecord, profile: ModelProfile): string | undefined {
  if (previous.engineSessionId === undefined || previous.profile.engine !== profile.engine) return undefined
  switch (profile.engine) {
    case 'claude-sdk':
    case 'claude-installed':
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
 * Whether the rules in force now let a call through without asking. A prompt
 * still open is read against it when the user turns a switch on instead of
 * answering: what the switch covers is no longer theirs to click.
 */
export type CallPasses = (sessionId: string, call: ToolUse) => Promise<boolean>

const nothingPasses: CallPasses = async () => false

/** What the person does in a session that a linked window's agent exchange must hear of. */
export interface PersonsWord {
  /** Returns what the other window's agent said while the person had interrupted, to be read with their message. */
  personSpoke(sessionId: string): string | undefined
  personInterrupted(sessionId: string): void
}

/**
 * A stored record in today's shape: one written before modes existed is a chat, one stored as `opened` has full access,
 * and a docs evaluation, a session type that is gone, is the chat it became once it had reported.
 */
function fromStore(stored: Omit<SessionRecord, 'mode'> & { mode?: SessionMode | 'docs'; opened?: true }): SessionRecord {
  const { opened, mode, ...record } = stored
  return { ...record, mode: mode === undefined || mode === 'docs' ? 'chat' : mode, ...(opened ? { access: 'full' as const } : {}) }
}

/**
 * Owns the list of sessions and the live engines behind them. A session is
 * started lazily on its first prompt, and continued from its engine session
 * id after the extension host restarted.
 */
export class SessionManager {
  private records: SessionRecord[]
  private readonly host: SessionEngineHost
  private readonly control: SessionControl
  private readonly removedListeners: Array<(sessionId: string) => void> = []
  private exchange: PersonsWord | undefined

  constructor(
    private readonly store: SessionStore,
    createEngine: EngineFactory,
    runLogFor: (sessionId: string) => RunLog,
    listener: SessionListener,
    decorate: EventDecorator = noDecoration,
    passes: CallPasses = nothingPasses,
  ) {
    this.records = store.list().map(fromStore)
    this.host = new SessionEngineHost(
      { get: (id) => this.get(id), all: () => this.records, save: () => this.store.save(this.records) },
      createEngine,
      runLogFor,
      listener,
      decorate,
    )
    this.control = new SessionControl(this.host, (id) => this.require(id), () => this.store.save(this.records), passes)
  }

  list(): SessionRecord[] {
    return [...this.records]
  }

  get(id: string): SessionRecord | undefined {
    return this.records.find((r) => r.id === id)
  }

  isLive(id: string): boolean {
    return this.host.liveSession(id) !== undefined
  }

  /** Every engine running now, for what the host applies to all of them at once. */
  liveSessions(): CodeSession[] {
    return this.host.liveSessions()
  }

  /** Starts or stops one MCP server of a live session; nothing to do for a session that is not running. */
  async switchMcp(id: string, server: string, running: boolean): Promise<void> {
    await this.host.switchMcp(id, server, running)
  }

  /** The live session running under another one's tab, if any. */
  liveChildOf(parentId: string): SessionRecord | undefined {
    return this.host.liveChildOf(parentId)
  }

  /** The newest record of a mode on a feature, live or not: the one that knows the feature best. */
  latest(mode: SessionMode, feature: string): SessionRecord | undefined {
    return this.records.find((r) => r.mode === mode && r.feature === feature)
  }

  async create(profile: ModelProfile, mode: SessionMode = 'chat', feature?: string, options: CreateOptions = {}): Promise<SessionRecord> {
    const { parentId, files, task, fixAttempt, continues, startedFrom } = options
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
      ...(startedFrom ? { startedFrom } : {}),
      createdAt: new Date().toISOString(),
    }
    this.records.unshift(record)
    await this.store.save(this.records)
    return record
  }

  /**
   * Every run on the feature whose spec went by `fromSlug` follows it to its
   * new name; a title the extension gave is given again, one the person or a
   * task named is kept.
   */
  async followFeatureRename(fromSlug: string, feature: string): Promise<void> {
    const moved = this.records.filter((r) => r.feature !== undefined && featureSlug(r.feature) === fromSlug)
    if (moved.length === 0) return
    for (const record of moved) {
      if (record.title === titleFor(record.mode, record.feature)) record.title = titleFor(record.mode, feature)
      record.feature = feature
    }
    await this.store.save(this.records)
  }

  async grantFullAccess(id: string, continuesOn?: ModelProfile): Promise<void> {
    await this.control.grantFullAccess(id, continuesOn)
  }

  /** In force from the next call on; the engine is not restarted, since the answers are read on every call. */
  async keepForSession(id: string, grants: Grant[]): Promise<void> {
    await this.control.keepForSession(id, grants)
  }

  async setAllowWrites(id: string, enabled: boolean): Promise<void> {
    await this.control.setAllowWrites(id, enabled)
  }

  /** The person's own choice for this session, overriding the default for where it started. */
  async setPushAllowed(id: string, allowed: boolean): Promise<void> {
    await this.control.setPushAllowed(id, allowed)
  }

  async noteSpecSeen(id: string, fingerprint: string): Promise<void> {
    await this.control.noteSpecSeen(id, fingerprint)
  }

  /** `label` marks text the extension wrote: the chat and the title show it in the text's place. */
  async send(id: string, text: string, label?: string): Promise<void> {
    // What the other window's agent said while the person had interrupted is read on this turn, ahead of their message.
    const held = this.exchange?.personSpoke(id)
    if (held === undefined) return this.control.send(id, text, label)
    await this.control.send(id, `${held}\n\n${text}`, label ?? text)
  }

  /** Lets the session's turns know the person spoke or interrupted, for the agent exchange with a linked window. */
  attachExchange(exchange: PersonsWord): void {
    this.exchange = exchange
  }

  /** An event of the session's own, outside its engine: logged and shown like the engine's. */
  async record(id: string, event: SessionEvent): Promise<void> {
    await this.host.emit(this.require(id), event)
  }

  /** The session's agent is in a turn now. */
  isInTurn(id: string): boolean {
    return this.host.inTurn(id)
  }

  /** A turn on what another agent said, not shown as the person's message. */
  async startTurnFromAgent(id: string, text: string): Promise<void> {
    await this.control.sendFromAgent(id, text)
  }

  async respondToPermission(id: string, requestId: string, decision: PermissionDecision): Promise<void> {
    await this.control.respondToPermission(id, requestId, decision)
  }

  async respondToQuestion(id: string, requestId: string, outcome: QuestionOutcome): Promise<void> {
    await this.control.respondToQuestion(id, requestId, outcome)
  }

  async setProfile(id: string, profile: ModelProfile): Promise<void> {
    await this.control.setProfile(id, profile)
  }

  async retryFix(id: string, attempt: number, profile: ModelProfile): Promise<void> {
    await this.control.retryFix(id, attempt, profile)
  }

  async interrupt(id: string): Promise<void> {
    this.exchange?.personInterrupted(id)
    await this.host.interrupt(id)
  }

  /** Ends the turn in flight for a pause of the linked conversation: unlike the person's Stop, the other agent may still reach this one once it resumes. */
  async endTurn(id: string): Promise<void> {
    await this.host.interrupt(id)
  }

  /** A paired phone's command, logged beside the act itself so the record says where it came from. */
  async noteRemoteAct(id: string, note: string): Promise<void> {
    await this.control.noteRemoteAct(id, note)
  }

  /** Whether a permission or question request still waits on an answer: false once whichever device got there first has resolved it. */
  async isRequestOpen(id: string, requestId: string): Promise<boolean> {
    return this.host.isRequestOpen(id, requestId)
  }

  /** Only a running engine holds a conversation to fold; a stopped one is compacted, if need be, once it runs again. */
  compact(id: string): void {
    this.host.compact(id)
  }

  /** Stop the engine but keep the record; a later prompt resumes it. A run under the session stops with it. */
  async close(id: string): Promise<void> {
    await this.host.close(id)
  }

  /** Closed because its job is done, unlike a run merely stopped, which still waits on the person. */
  async settle(id: string): Promise<void> {
    await this.control.settle(id)
  }

  async remove(id: string): Promise<void> {
    await this.close(id)
    this.records = this.records.filter((r) => r.id !== id && r.parentId !== id)
    this.host.forget(id)
    await this.store.save(this.records)
    for (const listener of this.removedListeners) listener(id)
  }

  /** Told of each session once it is deleted, for what hangs on it outside the list. */
  onRemoved(listener: (sessionId: string) => void): void {
    this.removedListeners.push(listener)
  }

  async transcript(id: string): Promise<SessionEvent[]> {
    return this.host.transcript(id)
  }

  async conversation(id: string): Promise<SessionEvent[]> {
    return this.host.conversation(id)
  }

  /** The host is going away: a turn it cuts off is marked before its engine stops, so the next host can carry it on. */
  async disposeAll(): Promise<void> {
    await this.host.disposeAll()
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
}
