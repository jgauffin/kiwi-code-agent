import { describe, expect, it } from 'vitest'
import type { SessionRecord } from '../src/agent/session/session-manager'
import { specPath } from '../src/agent/phases/blind-plan'
import type { PlanSummary } from '../src/agent/phases/plan-list'
import { tasksPath, writeBoard } from '../src/agent/phases/tasks-file'
import { updatableSpecs, type UpdateCandidateSessions } from '../src/chat/update-candidates'
import { board, task } from './task-board-fixture'
import { withWorkspace, writeFiles } from './workspace-fixture'

const FEATURE = 'Order cancellation'

const settled = `---
feature: ${FEATURE}
status: approved
---

# ${FEATURE}

## Goal
Orders can be cancelled.
`

/** A plan-list entry for `FEATURE` at `status`, its path the real spec file under `dir`. */
const summary = (dir: string, status: PlanSummary['status'], folder?: string): PlanSummary => ({
  feature: FEATURE,
  path: specPath(dir, FEATURE),
  status,
  ...(folder ? { folder } : {}),
})

/** Sessions whose liveness is set per id, rather than always false. */
class FakeSessions implements UpdateCandidateSessions {
  constructor(private readonly records: SessionRecord[] = [], private readonly live: Set<string> = new Set()) {}
  list(): SessionRecord[] {
    return this.records
  }
  isLive(id: string): boolean {
    return this.live.has(id)
  }
}

const noSessions = new FakeSessions()

describe('every spec listed and routed by its state', () => {
  it('a_draft_carries_no_changeability_since_it_is_always_pickable', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': settled }, async (dir) => {
      const result = await updatableSpecs(dir, noSessions, [summary(dir, 'draft')])
      expect(result).toEqual([{ feature: FEATURE, status: 'draft' }])
    })
  })

  it('a_settled_spec_with_nothing_in_flight_is_changeable', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': settled }, async (dir) => {
      const result = await updatableSpecs(dir, noSessions, [summary(dir, 'approved')])
      expect(result).toEqual([{ feature: FEATURE, status: 'approved', changeable: true }])
    })
  })

  it('a_spec_sitting_in_a_domain_folder_carries_its_folder_for_the_picker_to_group_it_by', async () => {
    await withWorkspace({ 'specs/orders/order-cancellation.spec.md': settled }, async (dir) => {
      const result = await updatableSpecs(dir, noSessions, [summary(dir, 'approved', 'orders')])
      expect(result).toEqual([{ feature: FEATURE, status: 'approved', changeable: true, folder: 'orders' }])
    })
  })
})

describe('build still in flight', () => {
  it('an_unfinished_task_is_listed_as_not_changeable_saying_so', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': settled, '.kiwi/specs/.keep': '' }, async (dir) => {
      await writeBoard(tasksPath(dir, FEATURE), board(task('Cancel')))
      const result = await updatableSpecs(dir, noSessions, [summary(dir, 'approved')])
      expect(result).toEqual([{ feature: FEATURE, status: 'approved', changeable: false, waiting: 'an unfinished task' }])
    })
  })

  it('a_decision_waiting_to_be_ruled_is_listed_as_not_changeable_saying_so', async () => {
    const decisions = `# Decisions for ${FEATURE}

### Shipped orders cannot be cancelled
- on: Cancel command
- finding: OrderService.Cancel refuses shipped orders
`
    await withWorkspace({ 'specs/order-cancellation.spec.md': settled }, async (dir) => {
      await writeFiles(dir, { '.kiwi/specs/order-cancellation.decisions.md': decisions })
      const result = await updatableSpecs(dir, noSessions, [summary(dir, 'approved')])
      expect(result).toEqual([{ feature: FEATURE, status: 'approved', changeable: false, waiting: 'a decision waiting to be ruled' }])
    })
  })

  it('a_run_at_work_is_listed_as_not_changeable_saying_so', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': settled }, async (dir) => {
      const record: SessionRecord = { id: 's1', title: 'plan', profile: { name: 'P', engine: 'openai-compatible', model: 'm' }, mode: 'plan', createdAt: new Date().toISOString(), feature: FEATURE }
      const sessions = new FakeSessions([record], new Set(['s1']))
      const result = await updatableSpecs(dir, sessions, [summary(dir, 'approved')])
      expect(result).toEqual([{ feature: FEATURE, status: 'approved', changeable: false, waiting: 'a run at work' }])
    })
  })
})
