import type { SessionRecord } from '../agent/session/session-manager'

/** What the Sessions view offers to open again: the chats, and one entry per planned feature. */
export type SessionGroups = { chats: SessionRecord[]; plans: SessionRecord[] }

/**
 * The runs a plan starts (checks, implementers, cleanups) and the sessions
 * that serve the docs are its machinery, not something the person opens by
 * name. A feature planned more than once is one plan, stood for by its newest
 * plan session. Records come newest first and keep that order.
 */
export function sessionGroups(records: SessionRecord[]): SessionGroups {
  const chats = records.filter((r) => r.mode === 'chat' && !r.parentId)
  const plans = new Map<string, SessionRecord>()
  for (const r of records) {
    if (r.mode === 'plan' && r.feature && !plans.has(r.feature)) plans.set(r.feature, r)
  }
  return { chats, plans: [...plans.values()] }
}
