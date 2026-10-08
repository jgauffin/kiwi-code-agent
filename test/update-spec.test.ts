import { describe, expect, it } from 'vitest'
import { startUpdate } from '../src/agent/phases/update-spec'
import type { PlanPickupCourier } from '../src/agent/phases/plan-pickup'
import { tasksPath, writeBoard } from '../src/agent/phases/tasks-file'
import { board, task } from './task-board-fixture'
import { withWorkspace, writeFiles } from './workspace-fixture'

const FEATURE = 'Order cancellation'

const draft = `---
feature: ${FEATURE}
status: draft
---

# ${FEATURE}

## Goal
Orders can be cancelled.
`

const settled = `---
feature: ${FEATURE}
status: approved
---

# ${FEATURE}

## Goal
Orders can be cancelled.
`

type Delivery =
  | { kind: 'open'; sessionId: string }
  | { kind: 'start'; feature: string; prompt: string; label: string }
  | { kind: 'say'; sessionId: string; note: string }

function courier(): PlanPickupCourier & { delivered: Delivery[]; owed: string[] } {
  const delivered: Delivery[] = []
  const owed: string[] = []
  return {
    delivered,
    owed,
    open: async (sessionId) => void delivered.push({ kind: 'open', sessionId }),
    start: async (feature, prompt, label) => {
      delivered.push({ kind: 'start', feature, prompt, label })
      return 'started-1'
    },
    say: async (sessionId, note) => void delivered.push({ kind: 'say', sessionId, note }),
    tell: async () => {
      throw new Error('An update hears the description in the developer\'s own words, never a prompt of the extension\'s.')
    },
    critiqueOwed: (feature) => void owed.push(feature),
  }
}

describe('picking a spec to update', () => {
  it('a_feature_whose_tab_is_already_open_hears_the_description_as_its_next_message', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': settled }, async (dir) => {
      const post = courier()
      await startUpdate({ courier: post, cwd: dir, feature: FEATURE, description: 'Drop the refund rule', owner: { sessionId: 'owner-1' } })
      expect(post.delivered).toEqual([
        { kind: 'open', sessionId: 'owner-1' },
        { kind: 'say', sessionId: 'owner-1', note: 'Drop the refund rule' },
      ])
    })
  })

  it('a_draft_with_nothing_open_is_carried_on_as_a_draft_pickup_hearing_the_description_next', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': draft }, async (dir) => {
      const post = courier()
      await startUpdate({ courier: post, cwd: dir, feature: FEATURE, description: 'Drop the refund rule' })
      expect(post.delivered[0]).toMatchObject({ kind: 'start', feature: FEATURE, label: 'Picking the plan up' })
      // The draft pickup's own kickoff, not a new one written for Update spec.
      expect((post.delivered[0] as { prompt: string }).prompt).toContain('Do not start over')
      expect(post.delivered[1]).toEqual({ kind: 'say', sessionId: 'started-1', note: 'Drop the refund rule' })
    })
  })

  it('a_settled_spec_with_nothing_open_starts_a_fresh_plan_session_on_the_spec_as_it_stands_hearing_the_description_next', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': settled }, async (dir) => {
      const post = courier()
      await startUpdate({ courier: post, cwd: dir, feature: FEATURE, description: 'Drop the refund rule' })
      expect(post.delivered[0]).toMatchObject({ kind: 'start', feature: FEATURE, label: 'Updating the spec' })
      const prompt = (post.delivered[0] as { prompt: string }).prompt
      // Never asks what changed: the next message already carries it, in the developer's own words.
      expect(prompt).not.toContain('ask what the developer wants changed')
      expect(prompt).toContain('specs/order-cancellation.spec.md')
      expect(post.delivered[1]).toEqual({ kind: 'say', sessionId: 'started-1', note: 'Drop the refund rule' })
    })
  })

  it('a_settled_spec_filed_in_a_domain_folder_is_found_and_updated_like_any_other', async () => {
    await withWorkspace({ 'specs/orders/order-cancellation.spec.md': settled }, async (dir) => {
      const post = courier()
      await startUpdate({ courier: post, cwd: dir, feature: FEATURE, description: 'Drop the refund rule' })
      expect(post.delivered[0]).toMatchObject({ kind: 'start', feature: FEATURE, label: 'Updating the spec' })
      expect((post.delivered[0] as { prompt: string }).prompt).toContain('specs/orders/order-cancellation.spec.md')
    })
  })

  it('an_unfinished_task_refuses_the_update_rather_than_starting_one', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': settled, '.kiwi/specs/.keep': '' }, async (dir) => {
      await writeBoard(tasksPath(dir, FEATURE), board(task('Cancel')))
      await expect(startUpdate({ courier: courier(), cwd: dir, feature: FEATURE, description: 'Drop the refund rule' })).rejects.toThrow(
        'still has work in flight',
      )
    })
  })

  it('a_decision_waiting_to_be_ruled_refuses_the_update_rather_than_starting_one', async () => {
    const decisions = `# Decisions for ${FEATURE}

### Shipped orders cannot be cancelled
- on: Cancel command
- finding: OrderService.Cancel refuses shipped orders
`
    await withWorkspace({ 'specs/order-cancellation.spec.md': settled }, async (dir) => {
      await writeFiles(dir, { '.kiwi/specs/order-cancellation.decisions.md': decisions })
      await expect(startUpdate({ courier: courier(), cwd: dir, feature: FEATURE, description: 'Drop the refund rule' })).rejects.toThrow(
        'still has work in flight',
      )
    })
  })

  it('a_feature_already_open_with_work_in_flight_is_still_refused_rather_than_heard', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': settled, '.kiwi/specs/.keep': '' }, async (dir) => {
      await writeBoard(tasksPath(dir, FEATURE), board(task('Cancel')))
      const post = courier()
      await expect(
        startUpdate({ courier: post, cwd: dir, feature: FEATURE, description: 'Drop the refund rule', owner: { sessionId: 'owner-1' } }),
      ).rejects.toThrow('still has work in flight')
      expect(post.delivered).toEqual([])
    })
  })

  it('no_spec_on_disk_refuses_rather_than_inventing_one', async () => {
    await withWorkspace({}, async (dir) => {
      await expect(startUpdate({ courier: courier(), cwd: dir, feature: FEATURE, description: 'Drop the refund rule' })).rejects.toThrow(/No spec/)
    })
  })
})
