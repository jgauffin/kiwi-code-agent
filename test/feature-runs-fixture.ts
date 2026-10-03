import type { SessionEvent } from '../src/agent/session/code-session'
import type { ModelProfile } from '../src/agent/session/model-profile'
import type { SessionMode, SessionRecord } from '../src/agent/session/session-manager'
import type { ChatRefresh, Notify, RunSessions } from '../src/chat/feature-runs'

export const profile: ModelProfile = { name: 'P', engine: 'openai-compatible', model: 'm' }

/** Sessions that start nothing: what was created and sent is kept for the test to read. */
export class FakeSessions implements RunSessions {
  readonly records: SessionRecord[] = []
  readonly sent: { id: string; text: string }[] = []
  readonly closed: string[] = []
  readonly settled: string[] = []

  async create(profile: ModelProfile, mode: SessionMode = 'chat', feature?: string, options: Parameters<RunSessions['create']>[3] = {}): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: `s${this.records.length + 1}`,
      title: mode,
      profile,
      mode,
      createdAt: new Date().toISOString(),
      ...(feature ? { feature } : {}),
      ...(options.parentId ? { parentId: options.parentId } : {}),
      ...(options.files ? { files: options.files } : {}),
      ...(options.task ? { task: options.task } : {}),
      ...(options.fixAttempt !== undefined ? { fixAttempt: options.fixAttempt } : {}),
    }
    this.records.unshift(record)
    return record
  }
  async send(id: string, text: string): Promise<void> {
    this.sent.push({ id, text })
  }
  async close(id: string): Promise<void> {
    this.closed.push(id)
  }
  async settle(id: string): Promise<void> {
    this.settled.push(id)
  }
  async retryFix(id: string, attempt: number, profile: ModelProfile): Promise<void> {
    const record = this.get(id)!
    record.fixAttempt = attempt
    record.profile = profile
  }
  get(id: string): SessionRecord | undefined {
    return this.records.find((r) => r.id === id)
  }
  list(): SessionRecord[] {
    return this.records
  }
  latest(mode: SessionMode, feature: string): SessionRecord | undefined {
    return this.records.find((r) => r.mode === mode && r.feature === feature)
  }
  isLive(): boolean {
    return false
  }
  liveChildOf(): SessionRecord | undefined {
    return undefined
  }
  async transcript(): Promise<SessionEvent[]> {
    return []
  }
  async takeCutOff(): Promise<SessionRecord[]> {
    return []
  }
}

/** A refresh that counts how often the Sessions view was told, and can be waited on for the next time. */
export class FakeRefresh implements ChatRefresh {
  changes = 0
  private waiting: (() => void)[] = []
  async sendState(): Promise<void> {}
  changed(): void {
    this.changes++
    for (const resolve of this.waiting.splice(0)) resolve()
  }
  nextChange(): Promise<void> {
    return new Promise((resolve) => this.waiting.push(resolve))
  }
}

/** Notices kept for the test; every question is answered with `answer`. */
export class FakeNotify implements Notify {
  readonly warnings: string[] = []
  readonly errors: string[] = []
  readonly asked: string[] = []
  answer: string | undefined
  warn(text: string): void {
    this.warnings.push(text)
  }
  error(text: string): void {
    this.errors.push(text)
  }
  async ask(text: string): Promise<string | undefined> {
    this.asked.push(text)
    return this.answer
  }
}
