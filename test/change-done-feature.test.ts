import { describe, expect, it } from 'vitest'
import { isDone, startChange } from '../src/agent/phases/change-done-feature'
import type { PlanPickupCourier } from '../src/agent/phases/plan-pickup'
import { tasksPath, writeBoard } from '../src/agent/phases/tasks-file'
import { board, task } from './task-board-fixture'
import { withWorkspace, writeFiles } from './workspace-fixture'

const FEATURE = 'Order cancellation'

const spec = (status: string) => `---
feature: ${FEATURE}
status: ${status}
---

# ${FEATURE}

## Goal
Orders can be cancelled.
`

type Delivery = { kind: 'start'; feature: string; prompt: string; label: string } | { kind: 'say'; sessionId: string; note: string }

function courier(): PlanPickupCourier & { delivered: Delivery[] } {
  const delivered: Delivery[] = []
  return {
    delivered,
    open: async () => {
      throw new Error('A change starts its own session on the spec as it stands, never the conversation that shaped it.')
    },
    start: async (feature, prompt, label) => {
      delivered.push({ kind: 'start', feature, prompt, label })
      return 'started-1'
    },
    say: async (sessionId, note) => void delivered.push({ kind: 'say', sessionId, note }),
    tell: async () => {
      throw new Error("The change is said in the developer's own words, never a prompt of the extension's.")
    },
    critiqueOwed: () => {},
  }
}

describe('a done feature opens as a change', () => {
  it('a_verified_spec_with_nothing_on_its_board_is_done', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': spec('verified') }, async (dir) => {
      expect(await isDone(dir, FEATURE)).toBe(true)
    })
  })

  it('a_spec_still_being_planned_or_built_is_not_done_so_it_is_picked_up_as_before', async () => {
    for (const status of ['draft', 'approved', 'implemented']) {
      await withWorkspace({ 'specs/order-cancellation.spec.md': spec(status) }, async (dir) => {
        expect(await isDone(dir, FEATURE)).toBe(false)
      })
    }
  })

  it('a_verified_spec_whose_board_has_a_task_left_is_not_done', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': spec('verified'), '.kiwi/specs/.keep': '' }, async (dir) => {
      await writeBoard(tasksPath(dir, FEATURE), board(task('Cancel')))
      expect(await isDone(dir, FEATURE)).toBe(false)
    })
  })

  it('with_nothing_typed_the_change_starts_on_the_spec_as_it_stands_and_the_planner_asks_what_should_change', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': spec('verified') }, async (dir) => {
      const post = courier()
      await startChange({ courier: post, cwd: dir, feature: FEATURE })
      expect(post.delivered).toHaveLength(1)
      expect(post.delivered[0]).toMatchObject({ kind: 'start', feature: FEATURE, label: 'Starting a change' })
      expect((post.delivered[0] as { prompt: string }).prompt).toContain('ask what the developer wants changed')
    })
  })

  it('what_was_typed_before_opening_it_is_the_change_said_next_in_the_persons_own_words', async () => {
    await withWorkspace({ 'specs/orders/order-cancellation.spec.md': spec('verified') }, async (dir) => {
      const post = courier()
      await startChange({ courier: post, cwd: dir, feature: FEATURE, description: 'Drop the refund rule' })
      const prompt = (post.delivered[0] as { prompt: string }).prompt
      // Never asks what changed: the next message already carries it.
      expect(prompt).not.toContain('ask what the developer wants changed')
      expect(prompt).toContain('specs/orders/order-cancellation.spec.md')
      expect(post.delivered[1]).toEqual({ kind: 'say', sessionId: 'started-1', note: 'Drop the refund rule' })
    })
  })

  it('a_decision_waiting_to_be_ruled_refuses_the_change_rather_than_starting_one', async () => {
    const decisions = `# Decisions for ${FEATURE}

### Shipped orders cannot be cancelled
- on: Cancel command
- finding: OrderService.Cancel refuses shipped orders
`
    await withWorkspace({ 'specs/order-cancellation.spec.md': spec('verified') }, async (dir) => {
      await writeFiles(dir, { '.kiwi/specs/order-cancellation.decisions.md': decisions })
      const post = courier()
      await expect(startChange({ courier: post, cwd: dir, feature: FEATURE })).rejects.toThrow('still has work in flight')
      expect(post.delivered).toEqual([])
    })
  })

  it('no_spec_on_disk_refuses_rather_than_inventing_one', async () => {
    await withWorkspace({}, async (dir) => {
      await expect(startChange({ courier: courier(), cwd: dir, feature: FEATURE })).rejects.toThrow(/No spec/)
    })
  })
})
