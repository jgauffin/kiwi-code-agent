import { describe, expect, it } from 'vitest'
import { sessionGroups } from '../src/chat/session-groups'
import type { SessionMode, SessionRecord } from '../src/agent/session/session-manager'

const record = (id: string, mode: SessionMode, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  title: id,
  profile: { name: 'Claude', engine: 'claude-sdk', model: 'opus' },
  mode,
  createdAt: '2026-09-29T00:00:00.000Z',
  ...extra,
})

describe('sessionGroups', () => {
  it('lists_chats_and_plans_but_none_of_the_runs_that_serve_a_plan', () => {
    const groups = sessionGroups([
      record('implement', 'implement', { feature: 'login', parentId: 'plan' }),
      record('orphan-implement', 'implement', { feature: 'login' }),
      record('check', 'reconcile', { feature: 'login', parentId: 'plan' }),
      record('cleanup', 'cleanup', { feature: 'login', parentId: 'plan' }),
      record('docs', 'docs'),
      record('map', 'docs-map'),
      record('filing', 'file-decisions'),
      record('plan', 'plan', { feature: 'login' }),
      record('chat', 'chat'),
    ])

    expect(groups.chats.map((r) => r.id)).toEqual(['chat'])
    expect(groups.plans.map((r) => r.id)).toEqual(['plan'])
  })

  it('shows_a_feature_planned_more_than_once_as_one_plan_its_newest_session', () => {
    const groups = sessionGroups([
      record('newer', 'plan', { feature: 'login' }),
      record('other', 'plan', { feature: 'search' }),
      record('older', 'plan', { feature: 'login' }),
    ])

    expect(groups.plans.map((r) => r.id)).toEqual(['newer', 'other'])
  })
})
