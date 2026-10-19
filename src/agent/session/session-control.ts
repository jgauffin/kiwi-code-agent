import { permissionResolved, type CodeSession, type PermissionDecision } from './code-session'
import { answerText, UNANSWERED_RESULT, type QuestionOutcome, type UserQuestionRequest } from './user-question'
import { sameModelProfile, type ModelProfile } from './model-profile'
import { continuationOf, type CallPasses, type SessionRecord } from './session-manager'
import { type PermissionRequest, type SessionEngineHost } from './session-engine-host'
import { errorMessage } from '../../error-message'
import { sameGrant, type Grant } from '../permissions/grants'

/**
 * What a session may do, and what gets said to its engine: access grants,
 * the rules the person allowed, and the prompts, permissions and answers
 * passed through to it.
 */
export class SessionControl {
  constructor(
    private readonly host: SessionEngineHost,
    private readonly requireRecord: (id: string) => SessionRecord,
    private readonly saveRecords: () => Promise<void>,
    private readonly passes: CallPasses,
  ) {}

  /**
   * The session goes on with the full tool set, in place: the person carries on
   * in the session they are reading rather than in a second one. The engine
   * stops, as it does on a model switch, and the next prompt brings one up on
   * the wider setup and resumes the thread, on `continuesOn` where the grant
   * moves it to another model.
   */
  async grantFullAccess(id: string, continuesOn?: ModelProfile): Promise<void> {
    const record = this.requireRecord(id)
    if (record.access === 'full') return
    // The thread carries only within one engine, and a plan agreed in chat exists nowhere else.
    if (continuesOn && continuesOn.engine !== record.profile.engine) {
      throw new Error(`"${record.title}" cannot continue on ${continuesOn.model}: its conversation is on the ${record.profile.engine} engine and does not carry over to ${continuesOn.engine}.`)
    }
    record.access = 'full'
    if (continuesOn) record.profile = continuesOn
    await this.saveRecords()
    await this.host.close(id)
  }

  /** In force from the next call on; the engine is not restarted, since the answers are read on every call. */
  async keepForSession(id: string, grants: Grant[]): Promise<void> {
    const record = this.requireRecord(id)
    const current = record.grants ?? []
    record.grants = [...current, ...grants.filter((g) => !current.some((c) => sameGrant(c, g)))]
    await this.saveRecords()
  }

  async setAllowWrites(id: string, enabled: boolean): Promise<void> {
    const record = this.requireRecord(id)
    if (enabled) record.allowWrites = true
    else delete record.allowWrites
    await this.saveRecords()
    if (enabled) await this.answerWhatPassesNow(record)
  }

  /** The person's own choice for this session, overriding the default for where it started. */
  async setPushAllowed(id: string, allowed: boolean): Promise<void> {
    const record = this.requireRecord(id)
    record.pushAllowed = allowed
    await this.saveRecords()
  }

  async noteSpecSeen(id: string, fingerprint: string): Promise<void> {
    const record = this.requireRecord(id)
    if (record.specSeen === fingerprint) return
    record.specSeen = fingerprint
    await this.saveRecords()
  }

  /**
   * A switch just turned on answers the prompts it covers: the write the
   * session is waiting on goes through, rather than needing the click the
   * switch was meant to spare. What it does not cover is still asked.
   */
  private async answerWhatPassesNow(record: SessionRecord): Promise<void> {
    const live = this.host.liveSession(record.id)
    if (!live) return
    for (const request of await this.host.openRequests(record)) {
      const call = { toolName: request.toolName, input: request.input, toolUseId: request.toolUseId ?? request.requestId }
      if (await this.passes(record.id, call)) live.respondToPermission(request.requestId, { kind: 'allow' })
    }
  }

  /** `label` marks text the extension wrote: the chat and the title show it in the text's place. */
  async send(id: string, text: string, label?: string): Promise<void> {
    const record = this.requireRecord(id)
    if (record.title === 'New session') {
      const title = label ?? text
      record.title = title.length > 60 ? title.slice(0, 57) + '...' : title
    }
    // A settled run sent work again (its task reopened) has a job once more.
    delete record.cutOff
    delete record.settled
    record.lastActiveAt = new Date().toISOString()
    await this.saveRecords()
    // Echoed here rather than by the engine, and the start-up said out loud: bringing an
    // engine up can take a repo or docs map build, and the wait is the user's to see.
    await this.host.emit(record, { type: 'user_message', text, ...(label ? { label } : {}) })
    if (!this.host.liveSession(id)) await this.host.emit(record, { type: 'status', status: 'starting' })
    let session: CodeSession
    try {
      session = await this.host.ensureLive(record)
    } catch (error) {
      // The start-up is over either way; the chat must stop showing it as under way.
      await this.host.emit(record, { type: 'error', message: errorMessage(error), fatal: true })
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
  /**
   * The answer goes to the engine while it still holds the request. One that
   * let go of it — it withdrew the call, the turn ended, the window was
   * reloaded — still gets the answer the person gave: the card settles, an
   * allow covers the same call when it comes again, and the decision becomes
   * the session's next prompt.
   */
  async respondToPermission(id: string, requestId: string, decision: PermissionDecision): Promise<void> {
    if (this.host.liveSession(id)?.respondToPermission(requestId, decision)) return
    const record = this.requireRecord(id)
    const request = await this.host.openRequest(record, requestId)
    if (!request) throw new Error(`Permission request ${requestId} is no longer open`)
    await this.host.emit(record, permissionResolved(requestId, decision))
    if (decision.kind === 'allow') this.host.notePreapproval(id, request.toolName, JSON.stringify(request.input))
    await this.send(id, decisionPrompt(request, decision), decision.kind === 'allow' ? `Allowed ${request.toolName}` : `Denied ${request.toolName}`)
  }

  /**
   * The answer goes to the engine that asked while it still holds the
   * question. One that let go of it — the turn ended around the card, the
   * window was reloaded — is not a reason to throw a decision the user already
   * made away: it becomes the session's next prompt, so the answer arrives a
   * turn late rather than not at all.
   */
  async respondToQuestion(id: string, requestId: string, outcome: QuestionOutcome): Promise<void> {
    if (this.host.liveSession(id)?.respondToQuestion(requestId, outcome)) return
    const record = this.requireRecord(id)
    const request = await this.host.openQuestion(record, requestId)
    if (!request) throw new Error(`Question ${requestId} is no longer open`)
    await this.host.emit(record, { type: 'question_resolved', requestId, outcome })
    await this.send(id, questionPrompt(request.request, outcome), 'Question answered')
  }

  /**
   * Another agent's message starts a turn. It is not the person's message: nothing is echoed
   * as theirs, the title is left alone, and no permission or question is answered by it.
   */
  async sendFromAgent(id: string, text: string): Promise<void> {
    const record = this.requireRecord(id)
    if (!this.host.liveSession(id)) await this.host.emit(record, { type: 'status', status: 'starting' })
    const session = await this.host.ensureLive(record)
    session.send(text)
  }

  /** A paired phone's command, logged beside the act itself so the record says where it came from. */
  async noteRemoteAct(id: string, note: string): Promise<void> {
    await this.host.emit(this.requireRecord(id), { type: 'remote_action', note })
  }

  /**
   * Switches a session to a model chosen mid-conversation: the engine stops,
   * the next prompt starts it again on the new profile. The conversation
   * carries only within the same engine, by the rule a new session follows
   * when it continues one; across engines it starts from the files on disk.
   */
  async setProfile(id: string, profile: ModelProfile): Promise<void> {
    const record = this.requireRecord(id)
    await this.host.close(id)
    const continued = continuationOf(record, profile)
    record.profile = profile
    if (continued) record.engineSessionId = continued
    else delete record.engineSessionId
    await this.saveRecords()
  }

  /**
   * A fix run handed the next failed sweep: its thread carries on, the attempt
   * counts up, and the profile that attempt resolves to takes hold on the next
   * turn, as a model switch would.
   */
  async retryFix(id: string, attempt: number, profile: ModelProfile): Promise<void> {
    const record = this.requireRecord(id)
    record.fixAttempt = attempt
    if (sameModelProfile(record.profile, profile)) await this.saveRecords()
    else await this.setProfile(id, profile)
  }

  /** Closed because its job is done, unlike a run merely stopped, which still waits on the person. */
  async settle(id: string): Promise<void> {
    const record = this.requireRecord(id)
    record.settled = true
    await this.saveRecords()
    await this.host.close(id)
  }
}

/** The answers as the model hears them once the engine that asked is gone: the questions are repeated so nothing rests on what the resumed engine remembers. */
function questionPrompt(request: UserQuestionRequest, outcome: QuestionOutcome): string {
  if (outcome.kind === 'unanswered') return `The question you asked was not answered.\n\n${UNANSWERED_RESULT}`
  return `Your question was answered:\n\n${answerText(request, outcome.answers)}`
}

/** The decision as the model hears it once the engine that asked is gone: the call is named in full so nothing rests on what the resumed engine remembers. */
function decisionPrompt(request: PermissionRequest, decision: PermissionDecision): string {
  const call = `the \`${request.toolName}\` call you proposed`
  const input = `\`\`\`json\n${JSON.stringify(request.input, null, 2)}\n\`\`\``
  switch (decision.kind) {
    case 'allow':
      return `Go ahead with ${call}; it is allowed.\n\n${input}`
    case 'deny':
      return `Do not make ${call}; it is denied${decision.message ? `: ${decision.message}` : ''}.\n\n${input}`
  }
}
