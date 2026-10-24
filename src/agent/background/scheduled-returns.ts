import { z } from 'zod'
import { fail, ok, type Tool } from '../openai-session/tools/tool'

export const SCHEDULE_RETURN_TOOL = 'ScheduleReturn'

/** The longest a session may ask to be left alone before it is resumed. */
export const MAX_RETURN_MINUTES = 10

/** A turn a session asked to start later, and why. `missed` marks one whose time passed while the window was closed. */
export type ScheduledReturn = { dueAt: string; reason: string; missed?: true }

export type ReturnEvent =
  | { kind: 'scheduled'; ret: ScheduledReturn }
  /** Cancelled by the person, by their prompt, by an interrupt or by the session ending. */
  | { kind: 'cancelled'; ret: ScheduledReturn }
  | { kind: 'due'; ret: ScheduledReturn }

/**
 * The returns sessions have scheduled, one per session. Like the background
 * commands it lives outside any engine, so a switch of model or engine keeps it.
 */
export class ScheduledReturns {
  private readonly pending = new Map<string, { ret: ScheduledReturn; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private readonly onEvent: (sessionId: string, event: ReturnEvent) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** Replaces any return the session already had. */
  schedule(sessionId: string, minutes: number, reason: string): ScheduledReturn {
    this.drop(sessionId)
    const ret: ScheduledReturn = { dueAt: new Date(this.now() + minutes * 60_000).toISOString(), reason }
    this.arm(sessionId, ret)
    this.onEvent(sessionId, { kind: 'scheduled', ret })
    return ret
  }

  /** Arms a return a previous window recorded, without announcing it again. */
  restore(sessionId: string, ret: ScheduledReturn): void {
    this.drop(sessionId)
    this.arm(sessionId, ret)
  }

  of(sessionId: string): ScheduledReturn | undefined {
    return this.pending.get(sessionId)?.ret
  }

  cancel(sessionId: string): ScheduledReturn | undefined {
    const ret = this.drop(sessionId)
    if (ret) this.onEvent(sessionId, { kind: 'cancelled', ret })
    return ret
  }

  /** The window goes away: no timer outlives it, and the record keeps the return for the next one. */
  dispose(): void {
    for (const { timer } of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
  }

  private drop(sessionId: string): ScheduledReturn | undefined {
    const entry = this.pending.get(sessionId)
    if (!entry) return undefined
    clearTimeout(entry.timer)
    this.pending.delete(sessionId)
    return entry.ret
  }

  private arm(sessionId: string, ret: ScheduledReturn): void {
    // setTimeout cannot count past about 24 days; a return is minutes away.
    const timer = setTimeout(() => {
      this.pending.delete(sessionId)
      this.onEvent(sessionId, { kind: 'due', ret })
    }, Math.max(0, Date.parse(ret.dueAt) - this.now()))
    this.pending.set(sessionId, { ret, timer })
  }
}

const schema = z.object({
  delayMinutes: z.number().positive().describe(`Minutes until you are resumed, at most ${MAX_RETURN_MINUTES}`),
  reason: z.string().min(1).describe('What you will do or check when you are resumed; you are told it then'),
})

/** What the session is told when it was asked to come back too late. */
export const tooLateRefusal = (minutes: number): string =>
  `A scheduled return can be at most ${MAX_RETURN_MINUTES} minutes away; ${minutes} is too long. Ask for ${MAX_RETURN_MINUTES} minutes or less and schedule again when you are resumed.`

/**
 * Ends nothing itself: the model schedules, then ends its turn, and is resumed
 * at the time with its reason. Use it for what changes slowly outside the machine.
 */
export function scheduleReturnTool(sessionId: string, returns: ScheduledReturns): Tool<typeof schema> {
  return {
    name: SCHEDULE_RETURN_TOOL,
    description:
      `Asks to be resumed after a delay of at most ${MAX_RETURN_MINUTES} minutes, with a reason. Call it, then end your turn: at that time a turn starts with your reason, without the user prompting. ` +
      'Use it to wait for something outside this machine that changes slowly, instead of holding a call open. If the user prompts you first, the return is cancelled and you are told.',
    schema,
    readOnly: true,
    async execute(input) {
      if (input.delayMinutes > MAX_RETURN_MINUTES) return fail(tooLateRefusal(input.delayMinutes))
      const ret = returns.schedule(sessionId, input.delayMinutes, input.reason)
      return ok(`You will be resumed at ${ret.dueAt} (${input.delayMinutes} minutes) with your reason. End your turn now.`)
    },
  }
}

/** What the session is told when its return came due. */
export const describeReturn = (ret: ScheduledReturn): string => `Scheduled return: you asked to be resumed now. Your reason: ${ret.reason}`

export const describeCancelledReturn = (ret: ScheduledReturn): string =>
  `Your scheduled return for ${ret.dueAt} (${ret.reason}) was cancelled because the user prompted you first.`

export const describeMissedReturn = (ret: ScheduledReturn): string =>
  `Your scheduled return for ${ret.dueAt} (${ret.reason}) did not happen: the window was closed at that time.`
