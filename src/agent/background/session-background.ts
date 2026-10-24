import type { SessionEvent } from '../session/code-session'
import { describeCut, describeEnds, type BackgroundCommand, type BackgroundCommands, type BackgroundEvent } from './background-commands'
import { describeCancelledReturn, describeMissedReturn, describeReturn, type ReturnEvent, type ScheduledReturn, type ScheduledReturns } from './scheduled-returns'

/** What a session is as far as its background commands go: a chat is told and woken, a run only told within its turn. */
export type BackgroundRole = 'chat' | 'run' | 'other'

/** What the delivery needs from the session list and its engine host. */
export interface BackgroundPorts {
  roleOf(sessionId: string): BackgroundRole | undefined
  /** The commands the session's record says it had running, as the last window left them. */
  recorded(sessionId: string): BackgroundCommand[]
  record(sessionId: string, commands: BackgroundCommand[]): Promise<void>
  emit(sessionId: string, event: SessionEvent): Promise<void>
  inTurn(sessionId: string): boolean
  /** Starts a turn on the text, not shown as the person's message. */
  wake(sessionId: string, text: string): Promise<void>
  returnRecorded(sessionId: string): ScheduledReturn | undefined
  recordReturn(sessionId: string, ret: ScheduledReturn | undefined): Promise<void>
  /** Every session whose record says it has a return scheduled. */
  withReturns(): { id: string; ret: ScheduledReturn }[]
}

/** Turns a session starts on its own without a word from the person, unless the setting says otherwise. */
export const DEFAULT_OWN_TURN_LIMIT = 10

const asEvent = (command: BackgroundCommand, state: 'running' | 'ended' | 'stopped' | 'cut', exitCode?: number | null): SessionEvent => ({
  type: 'background_command',
  id: command.id,
  command: command.command,
  purpose: command.purpose,
  state,
  ...(exitCode !== undefined ? { exitCode } : {}),
  outputFile: command.outputFile,
})

const asReturnEvent = (ret: ScheduledReturn, state: 'scheduled' | 'cancelled' | 'due' | 'missed'): SessionEvent => ({
  type: 'scheduled_return',
  state,
  dueAt: ret.dueAt,
  reason: ret.reason,
})

/**
 * How the end of a background command reaches its session: as a turn of its own
 * when the session is idle, as a tail on the next tool result when it is in a
 * turn, held for the person's next prompt after they interrupted. The commands
 * themselves are `BackgroundCommands`'; this is the session's side of them.
 */
export class SessionBackground {
  /** Sessions the person interrupted since they last prompted: no turn starts on a command's end until they do. */
  private readonly held = new Set<string>()
  private readonly waking = new Set<string>()
  /** Per session, the turns started on their own since the person last prompted. */
  private readonly ownTurns = new Map<string, number>()
  /** Sessions the person has been told are held at the cap, so they are told once. */
  private readonly capAnnounced = new Set<string>()
  /** Per session, a scheduled return that came due at the cap: told with the person's next prompt. */
  private readonly heldReturns = new Map<string, ScheduledReturn>()

  constructor(
    readonly commands: BackgroundCommands,
    private readonly ports: BackgroundPorts,
    readonly returns: ScheduledReturns,
    private readonly ownTurnLimit: () => number = () => DEFAULT_OWN_TURN_LIMIT,
  ) {}

  /** Re-arms the returns a previous window recorded; one whose time passed with the window closed starts nothing and waits for the person. */
  async resumeReturns(now: number = Date.now()): Promise<void> {
    for (const { id, ret } of this.ports.withReturns()) {
      if (ret.missed) continue
      if (Date.parse(ret.dueAt) > now) {
        this.returns.restore(id, ret)
        continue
      }
      const missed: ScheduledReturn = { ...ret, missed: true }
      await this.ports.recordReturn(id, missed)
      await this.ports.emit(id, asReturnEvent(missed, 'missed'))
    }
  }

  /** A return was scheduled, cancelled or came due. */
  async onReturn(sessionId: string, event: ReturnEvent): Promise<void> {
    switch (event.kind) {
      case 'scheduled':
        await this.ports.recordReturn(sessionId, event.ret)
        await this.ports.emit(sessionId, asReturnEvent(event.ret, 'scheduled'))
        return
      case 'cancelled':
        await this.ports.recordReturn(sessionId, undefined)
        await this.ports.emit(sessionId, asReturnEvent(event.ret, 'cancelled'))
        return
      case 'due':
        await this.ports.recordReturn(sessionId, undefined)
        await this.ports.emit(sessionId, asReturnEvent(event.ret, 'due'))
        await this.returnDue(sessionId, event.ret)
        return
    }
  }

  /** The person's cancel of the session's scheduled return; false when there is none. */
  cancelReturn(sessionId: string): boolean {
    return this.returns.cancel(sessionId) !== undefined
  }

  private async returnDue(sessionId: string, ret: ScheduledReturn): Promise<void> {
    if (this.ports.roleOf(sessionId) !== 'chat') return
    // A turn still under way cannot be resumed: the return waits for it to end.
    if (this.ports.inTurn(sessionId)) {
      setTimeout(() => void this.returnDue(sessionId, ret), 500)
      return
    }
    if (this.capped(sessionId)) {
      this.heldReturns.set(sessionId, ret)
      await this.announceCap(sessionId)
      return
    }
    this.ownTurns.set(sessionId, (this.ownTurns.get(sessionId) ?? 0) + 1)
    try {
      await this.ports.wake(sessionId, describeReturn(ret))
    } catch (error) {
      await this.ports.emit(sessionId, { type: 'error', message: `Resuming the session on its scheduled return: ${error instanceof Error ? error.message : String(error)}`, fatal: false })
    }
  }

  private capped(sessionId: string): boolean {
    return (this.ownTurns.get(sessionId) ?? 0) >= this.ownTurnLimit()
  }

  private async announceCap(sessionId: string): Promise<void> {
    if (this.capAnnounced.has(sessionId)) return
    this.capAnnounced.add(sessionId)
    await this.ports.emit(sessionId, {
      type: 'error',
      message: `The session started ${this.ownTurnLimit()} turns on its own, on background commands and scheduled returns, without a word from you, so the next one is held. Write in this chat to let it go on.`,
      fatal: false,
    })
  }

  /** A command started, ended or was stopped: shown in the transcript and, when it ended on its own, delivered. */
  async onCommand(sessionId: string, event: BackgroundEvent): Promise<void> {
    const recorded = this.ports.recorded(sessionId)
    switch (event.kind) {
      case 'started':
        await this.ports.record(sessionId, [...recorded, event.command])
        await this.ports.emit(sessionId, asEvent(event.command, 'running'))
        return
      case 'stopped':
        await this.ports.record(sessionId, recorded.filter((c) => c.id !== event.command.id))
        await this.ports.emit(sessionId, asEvent(event.command, 'stopped'))
        return
      case 'ended':
        await this.ports.record(sessionId, recorded.filter((c) => c.id !== event.end.id))
        await this.ports.emit(sessionId, asEvent(event.end, 'ended', event.end.exitCode))
        this.deliver(sessionId)
        return
    }
  }

  /** A turn of the session ended: a chat is told what ended meanwhile, and a run is over, so its commands stop. */
  onSessionEvent(sessionId: string, event: SessionEvent): void {
    if (event.type !== 'turn_done') return
    const role = this.ports.roleOf(sessionId)
    if (role === 'run') this.end(sessionId)
    else this.deliver(sessionId)
  }

  /** The person interrupted: nothing starts a turn on their behalf until they prompt again. */
  interrupted(sessionId: string): void {
    this.held.add(sessionId)
    this.returns.cancel(sessionId)
  }

  /** The person prompted: whatever the session was not told while held goes ahead of their prompt. */
  async beforePerson(sessionId: string): Promise<string | undefined> {
    this.held.delete(sessionId)
    this.ownTurns.delete(sessionId)
    this.capAnnounced.delete(sessionId)
    const parts: string[] = []
    const cancelled = this.returns.cancel(sessionId)
    if (cancelled) parts.push(describeCancelledReturn(cancelled))
    const missed = this.ports.returnRecorded(sessionId)
    if (missed?.missed) {
      await this.ports.recordReturn(sessionId, undefined)
      parts.push(describeMissedReturn(missed))
    }
    const heldReturn = this.heldReturns.get(sessionId)
    if (heldReturn) {
      this.heldReturns.delete(sessionId)
      parts.push(describeReturn(heldReturn))
    }
    const commands = await this.notes(sessionId)
    if (commands) parts.push(commands)
    return parts.length > 0 ? parts.join('\n\n') : undefined
  }

  /** The session is over: every command it started stops and nothing of them is ever delivered. */
  end(sessionId: string): void {
    this.returns.cancel(sessionId)
    this.heldReturns.delete(sessionId)
    this.commands.endSession(sessionId)
    if (this.ports.recorded(sessionId).length > 0) void this.ports.record(sessionId, [])
  }

  /** The window goes away: the commands stop, and stay recorded so the next window can say which were cut. */
  cutAll(): void {
    this.commands.cutAll()
    this.returns.dispose()
  }

  /** What the session has to be told before its next turn: commands cut by a reload, and commands that ended. */
  private async notes(sessionId: string): Promise<string | undefined> {
    const parts: string[] = []
    const running = new Set(this.commands.runningOf(sessionId).map((c) => c.id))
    const cut = this.ports.recorded(sessionId).filter((c) => !running.has(c.id))
    if (cut.length > 0) {
      await this.ports.record(sessionId, this.ports.recorded(sessionId).filter((c) => running.has(c.id)))
      for (const command of cut) await this.ports.emit(sessionId, asEvent(command, 'cut'))
      parts.push(describeCut(cut))
    }
    const ended = this.commands.takeEnded(sessionId)
    if (ended.length > 0) parts.push(describeEnds(ended))
    return parts.length > 0 ? parts.join('\n\n') : undefined
  }

  /** An idle chat session starts a turn on what ended; one in a turn is told on its next tool result, one held waits for the person. */
  private deliver(sessionId: string): void {
    if (this.ports.roleOf(sessionId) !== 'chat' || this.held.has(sessionId) || this.ports.inTurn(sessionId)) return
    if (this.waking.has(sessionId)) return
    this.waking.add(sessionId)
    // Commands that end together are one notice: whatever ended by the time this runs goes in it.
    setTimeout(() => {
      this.waking.delete(sessionId)
      void this.wake(sessionId)
    }, 0)
  }

  private async wake(sessionId: string): Promise<void> {
    if (this.held.has(sessionId) || this.ports.inTurn(sessionId)) return
    try {
      if (this.capped(sessionId)) {
        // The notice stays unread until the person prompts.
        if (this.commands.hasEnded(sessionId) || this.ports.recorded(sessionId).length > 0) await this.announceCap(sessionId)
        return
      }
      const text = await this.notes(sessionId)
      if (text) {
        this.ownTurns.set(sessionId, (this.ownTurns.get(sessionId) ?? 0) + 1)
        await this.ports.wake(sessionId, text)
      }
    } catch (error) {
      await this.ports.emit(sessionId, { type: 'error', message: `Telling the session its background command ended: ${error instanceof Error ? error.message : String(error)}`, fatal: false })
    }
  }
}
