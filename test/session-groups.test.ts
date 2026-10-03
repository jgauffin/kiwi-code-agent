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

const spec = (feature: string, status: PlanSummary['status'] = 'draft'): PlanSummary => ({ feature, path: join('/ws', 'specs', `${featureSlug(feature)}.spec.md`), status })

describe('sessionGroups', () => {
  it('lists_chats_and_plans_but_none_of_the_runs_that_serve_a_plan', () => {
    const groups = sessionGroups(
      [
        record('implement', 'implement', { feature: 'login', parentId: 'plan' }),
        record('orphan-implement', 'implement', { feature: 'login' }),
        record('check', 'reconcile', { feature: 'login', parentId: 'plan' }),
        record('cleanup', 'cleanup', { feature: 'login', parentId: 'plan' }),
        record('map', 'docs-map'),
        record('plan', 'plan', { feature: 'login' }),
        record('chat', 'chat'),
      ],
      [spec('login')],
    )

    expect(groups.chats.map((r) => r.id)).toEqual(['chat'])
    expect(groups.plans.map((p) => p.record?.id)).toEqual(['plan'])
  })

  it('lists_the_docs_evaluation_and_the_decision_filing_with_the_chats_so_a_closed_tab_can_be_reopened', () => {
    const groups = sessionGroups([record('docs', 'docs'), record('filing', 'file-decisions'), record('chat', 'chat')], [])

    expect(groups.chats.map((r) => r.id)).toEqual(['docs', 'filing', 'chat'])
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

    expect(groups.plans).toEqual([{ feature: 'Order cancellation', status: 'approved', record: undefined, lastActiveAt: undefined }])
  })

  it('lists_a_verified_feature_at_its_stage_while_its_plan_session_is_kept', () => {
    const groups = sessionGroups([record('plan', 'plan', { feature: 'login' })], [spec('login', 'verified')])

    expect(groups.plans.map((p) => [p.record?.id, p.status])).toEqual([['plan', 'verified']])
  })

  it('leaves_out_a_verified_spec_nobody_has_a_session_on', () => {
    const groups = sessionGroups([], [spec('login', 'verified')])

    expect(groups.plans).toEqual([])
  })

  it('lists_a_plan_session_whose_spec_is_not_written_yet', () => {
    const groups = sessionGroups([record('plan', 'plan', { feature: 'login' })], [])

    expect(groups.plans).toEqual([{ feature: 'login', status: undefined, record: expect.objectContaining({ id: 'plan' }), lastActiveAt: '2026-09-29T00:00:00.000Z' }])
  })

  it('orders_the_conversations_by_when_they_were_last_worked_in_not_by_when_they_started', () => {
    const groups = sessionGroups(
      [record('new-idle', 'chat', { createdAt: '2026-10-02T00:00:00.000Z' }), record('old-busy', 'code-plan', { lastActiveAt: '2026-10-03T09:00:00.000Z' })],
      [],
    )

    expect(groups.chats.map((r) => r.id)).toEqual(['old-busy', 'new-idle'])
  })

  it('dates_a_plan_by_the_newest_run_on_its_feature_so_a_build_today_brings_it_up', () => {
    const groups = sessionGroups(
      [
        record('build', 'implement', { feature: 'login', parentId: 'login-plan', lastActiveAt: '2026-10-03T11:00:00.000Z' }),
        record('search-plan', 'plan', { feature: 'search', createdAt: '2026-10-02T00:00:00.000Z' }),
        record('login-plan', 'plan', { feature: 'login' }),
      ],
      [spec('login', 'verified'), spec('search'), spec('unopened')],
    )

    expect(groups.plans.map((p) => [p.feature, p.lastActiveAt])).toEqual([
      ['login', '2026-10-03T11:00:00.000Z'],
      ['search', '2026-10-02T00:00:00.000Z'],
      ['unopened', undefined],
    ])
  })

  it('matches_a_session_to_its_spec_by_the_file_name_the_feature_gets', () => {
    const groups = sessionGroups([record('plan', 'plan', { feature: 'Order Cancellation' })], [spec('order cancellation')])

    expect(groups.plans.map((p) => p.record?.id)).toEqual(['plan'])
  })
})
