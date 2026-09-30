import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { featureSlug } from '../src/agent/phases/blind-plan'
import { sessionGroups } from '../src/chat/session-groups'
import type { SessionMode, SessionRecord } from '../src/agent/session/session-manager'
import type { PlanSummary } from '../src/agent/phases/plan-list'

const record = (id: string, mode: SessionMode, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  title: id,
  profile: { name: 'Claude', engine: 'claude-sdk', model: 'opus' },
  mode,
  createdAt: '2026-09-29T00:00:00.000Z',
  ...extra,
})

const spec = (feature: string, status: PlanSummary['status'] = 'draft'): PlanSummary => ({ feature, path: join('/ws', 'plan', `${featureSlug(feature)}.spec.md`), status })

describe('sessionGroups', () => {
  it('lists_chats_and_plans_but_none_of_the_runs_that_serve_a_plan', () => {
    const groups = sessionGroups(
      [
        record('implement', 'implement', { feature: 'login', parentId: 'plan' }),
        record('orphan-implement', 'implement', { feature: 'login' }),
        record('check', 'reconcile', { feature: 'login', parentId: 'plan' }),
        record('cleanup', 'cleanup', { feature: 'login', parentId: 'plan' }),
        record('docs', 'docs'),
        record('map', 'docs-map'),
        record('filing', 'file-decisions'),
        record('plan', 'plan', { feature: 'login' }),
        record('chat', 'chat'),
      ],
      [spec('login')],
    )

    expect(groups.chats.map((r) => r.id)).toEqual(['chat'])
    expect(groups.plans.map((p) => p.record?.id)).toEqual(['plan'])
  })

  it('lists_a_code_plan_with_the_chats_since_it_is_a_conversation_not_a_feature', () => {
    const groups = sessionGroups([record('code-plan', 'code-plan'), record('chat', 'chat')], [])

    expect(groups.chats.map((r) => r.id)).toEqual(['code-plan', 'chat'])
    expect(groups.plans).toEqual([])
  })

  it('shows_a_feature_planned_more_than_once_as_one_plan_its_newest_session', () => {
    const groups = sessionGroups(
      [record('newer', 'plan', { feature: 'login' }), record('other', 'plan', { feature: 'search' }), record('older', 'plan', { feature: 'login' })],
      [spec('login'), spec('search')],
    )

    expect(groups.plans.map((p) => p.record?.id)).toEqual(['newer', 'other'])
  })

  it('lists_a_planned_feature_whose_plan_session_is_gone', () => {
    const groups = sessionGroups([], [spec('Order cancellation', 'approved')])

    expect(groups.plans).toEqual([{ feature: 'Order cancellation', status: 'approved', record: undefined }])
  })

  it('leaves_out_a_verified_feature_even_with_its_plan_session_kept', () => {
    const groups = sessionGroups([record('plan', 'plan', { feature: 'login' })], [spec('login', 'verified')])

    expect(groups.plans).toEqual([])
  })

  it('lists_a_plan_session_whose_spec_is_not_written_yet', () => {
    const groups = sessionGroups([record('plan', 'plan', { feature: 'login' })], [])

    expect(groups.plans).toEqual([{ feature: 'login', status: undefined, record: expect.objectContaining({ id: 'plan' }) }])
  })

  it('matches_a_session_to_its_spec_by_the_file_name_the_feature_gets', () => {
    const groups = sessionGroups([record('plan', 'plan', { feature: 'Order Cancellation' })], [spec('order cancellation')])

    expect(groups.plans.map((p) => p.record?.id)).toEqual(['plan'])
  })
})
