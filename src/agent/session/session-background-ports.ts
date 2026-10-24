import type { BackgroundPorts, BackgroundRole } from '../background/session-background'
import type { SessionEvent } from './code-session'
import { actingMode, type SessionRecord } from './session-manager'

/** What the background commands of the sessions read and change in the session list. */
export interface SessionListAccess {
  get(id: string): SessionRecord | undefined
  all(): SessionRecord[]
  save(): Promise<void>
  emit(record: SessionRecord, event: SessionEvent): Promise<void>
  inTurn(id: string): boolean
  wake(id: string, text: string): Promise<void>
}

function roleOf(record: SessionRecord | undefined): BackgroundRole | undefined {
  if (!record) return undefined
  const mode = actingMode(record)
  if (mode === 'chat') return 'chat'
  return mode === 'implement' ? 'run' : 'other'
}

export function sessionBackgroundPorts(sessions: SessionListAccess): BackgroundPorts {
  return {
    roleOf: (id) => roleOf(sessions.get(id)),
    recorded: (id) => sessions.get(id)?.background ?? [],
    record: async (id, list) => {
      const record = sessions.get(id)
      if (!record) return
      if (list.length > 0) record.background = list
      else delete record.background
      await sessions.save()
    },
    emit: async (id, event) => {
      const record = sessions.get(id)
      if (record) await sessions.emit(record, event)
    },
    inTurn: (id) => sessions.inTurn(id),
    wake: (id, text) => sessions.wake(id, text),
    returnRecorded: (id) => sessions.get(id)?.scheduledReturn,
    recordReturn: async (id, ret) => {
      const record = sessions.get(id)
      if (!record) return
      if (ret) record.scheduledReturn = ret
      else delete record.scheduledReturn
      await sessions.save()
    },
    withReturns: () => sessions.all().flatMap((r) => (r.scheduledReturn ? [{ id: r.id, ret: r.scheduledReturn }] : [])),
  }
}
