import { basename } from 'node:path'
import type { SessionRecord } from '../agent/session/session-manager'
import { featureSlug } from '../agent/phases/blind-plan'
import type { PlanStatus, PlanSummary } from '../agent/phases/plan-list'

/** A planned feature: its spec's stage (absent while the planner has not written it) and the newest plan session on it, if one is kept. */
export type PlanEntry = { feature: string; status: Exclude<PlanStatus, 'verified'> | undefined; record: SessionRecord | undefined }

/** What the Sessions view offers to open again: the chats, and one entry per unfinished planned feature. */
export type SessionGroups = { chats: SessionRecord[]; plans: PlanEntry[] }

/**
 * The runs a plan starts (checks, implementers, cleanups) and the sessions
 * that serve the docs are its machinery, not something the person opens by
 * name. A plan is its spec on disk: the session that wrote it may be gone, and
 * the feature is still unfinished. The features with a plan session come
 * first, newest first, then the specs nobody has opened here.
 */
export function sessionGroups(records: SessionRecord[], specs: PlanSummary[]): SessionGroups {
  // A code plan is a conversation that ends in a chat, not a feature with a spec.
  const chats = records.filter((r) => (r.mode === 'chat' || r.mode === 'code-plan') && !r.parentId)
  const bySlug = new Map(specs.map((s) => [basename(s.path, '.spec.md'), s]))
  const plans = new Map<string, PlanEntry>()
  for (const r of records) {
    if (r.mode !== 'plan' || !r.feature) continue
    const slug = featureSlug(r.feature)
    if (plans.has(slug)) continue
    const spec = bySlug.get(slug)
    if (spec?.status === 'verified') continue
    plans.set(slug, { feature: spec?.feature ?? r.feature, status: spec?.status, record: r })
  }
  for (const [slug, spec] of bySlug) {
    if (spec.status === 'verified' || plans.has(slug)) continue
    plans.set(slug, { feature: spec.feature, status: spec.status, record: undefined })
  }
  return { chats, plans: [...plans.values()] }
}
