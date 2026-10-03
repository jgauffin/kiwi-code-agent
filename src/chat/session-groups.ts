import { basename } from 'node:path'
import { lastActive, type SessionRecord } from '../agent/session/session-manager'
import { featureSlug } from '../agent/phases/blind-plan'
import type { PlanStatus, PlanSummary } from '../agent/phases/plan-list'

/**
 * A planned feature: its spec's stage (absent while the planner has not written
 * it), the newest plan session on it, if one is kept, and when any run on the
 * feature was last worked in.
 */
export type PlanEntry = { feature: string; status: PlanStatus | undefined; record: SessionRecord | undefined; lastActiveAt: string | undefined }

/** What the Sessions view offers to open again: the chats, and one entry per planned feature. */
export type SessionGroups = { chats: SessionRecord[]; plans: PlanEntry[] }

/** Conversations the person talks to that belong to no feature: a code plan ends in a chat, and the docs evaluation, the filing and the doc migration go on once they have reported. */
const CONVERSATIONS: ReadonlySet<SessionRecord['mode']> = new Set(['chat', 'code-plan', 'docs', 'file-decisions', 'doc-migration'])

const newestFirst = (a: string | undefined, b: string | undefined): number => (b ?? '').localeCompare(a ?? '')

/**
 * The runs a plan starts (checks, implementers, cleanups) and the docs map
 * build are its machinery, not something the person opens by name. A plan is
 * its spec on disk: the session that wrote it may be gone, and the feature is
 * still unfinished. A verified feature is listed while its plan session is
 * kept, so work just finished is not gone from the list; a verified spec
 * nobody has a session on is history. Everything comes newest worked in
 * first, then the specs nobody has opened here.
 */
export function sessionGroups(records: SessionRecord[], specs: PlanSummary[]): SessionGroups {
  const chats = records.filter((r) => CONVERSATIONS.has(r.mode) && !r.parentId).sort((a, b) => newestFirst(lastActive(a), lastActive(b)))
  const bySlug = new Map(specs.map((s) => [basename(s.path, '.spec.md'), s]))
  const touched = new Map<string, string>()
  for (const r of records) {
    if (!r.feature) continue
    const slug = featureSlug(r.feature)
    const at = lastActive(r)
    if (at > (touched.get(slug) ?? '')) touched.set(slug, at)
  }
  const plans = new Map<string, PlanEntry>()
  for (const r of records) {
    if (r.mode !== 'plan' || !r.feature) continue
    const slug = featureSlug(r.feature)
    if (plans.has(slug)) continue
    const spec = bySlug.get(slug)
    plans.set(slug, { feature: spec?.feature ?? r.feature, status: spec?.status, record: r, lastActiveAt: touched.get(slug) })
  }
  const opened = [...plans.values()].sort((a, b) => newestFirst(a.lastActiveAt, b.lastActiveAt))
  const unopened: PlanEntry[] = []
  for (const [slug, spec] of bySlug) {
    if (spec.status === 'verified' || plans.has(slug)) continue
    unopened.push({ feature: spec.feature, status: spec.status, record: undefined, lastActiveAt: undefined })
  }
  return { chats, plans: [...opened, ...unopened] }
}
