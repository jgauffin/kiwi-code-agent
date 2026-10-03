import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { specPath } from '../src/agent/phases/blind-plan'
import { pickUpPlan, type PlanPickupCourier } from '../src/agent/phases/plan-pickup'

const spec = `---
feature: Order cancellation
status: draft
---

# Order cancellation

## Goal
Orders can be cancelled.
`

type Delivery = { kind: 'open'; sessionId: string } | { kind: 'start'; feature: string; prompt: string; label: string }

function courier(): PlanPickupCourier & { delivered: Delivery[] } {
  const delivered: Delivery[] = []
  return {
    delivered,
    open: async (sessionId) => void delivered.push({ kind: 'open', sessionId }),
    start: async (feature, prompt, label) => void delivered.push({ kind: 'start', feature, prompt, label }),
  }
}

async function workspace(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pickup-'))
  await mkdir(join(dir, 'specs'), { recursive: true })
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, 'specs', name), text)
  return dir
}

describe('picking up a plan', () => {
  it('a_feature_whose_tab_is_already_open_is_brought_up_instead_of_starting_a_second_session', async () => {
    // No spec is written for it at all: a courier that already owns the feature is never sent to the files.
    const dir = await workspace()
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation', owner: { sessionId: 'owner-1' } })
      expect(post.delivered).toEqual([{ kind: 'open', sessionId: 'owner-1' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_draft_with_no_tab_open_starts_a_session_with_no_conversation_of_its_own_pointed_at_the_files', async () => {
    const dir = await workspace({ 'order-cancellation.spec.md': spec })
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation' })
      expect(post.delivered).toHaveLength(1)
      const started = post.delivered[0]!
      expect(started).toMatchObject({ kind: 'start', feature: 'Order cancellation', label: 'Picking the plan up' })
      // A fresh session has no transcript of the conversation that wrote the draft, so it is told to read it from disk instead.
      expect((started as { prompt: string }).prompt).toContain('specs/order-cancellation.spec.md')
      expect((started as { prompt: string }).prompt).toContain('from disk')
      expect((started as { prompt: string }).prompt).toContain('Do not start over')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_pickup_never_approves_the_draft_or_touches_its_review_so_no_comment_is_spent_by_it', async () => {
    const dir = await workspace({ 'order-cancellation.spec.md': spec })
    try {
      await pickUpPlan({ courier: courier(), cwd: dir, feature: 'Order cancellation' })
      // The spec on disk is exactly as it stood before the pickup: still a draft, nothing written to it or to a review.
      expect(await readFile(specPath(dir, 'Order cancellation'), 'utf8')).toBe(spec)
      await expect(readFile(join(dir, '.kiwi', 'specs', 'order-cancellation.review.md'), 'utf8')).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_draft_pickup_buys_a_critique_sized_to_how_the_draft_was_authored', async () => {
    const planned = `${spec.replace('status: draft', 'status: draft\nauthored: planned')}`
    const dir = await workspace({ 'order-cancellation.spec.md': planned })
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation' })
      const started = post.delivered[0] as { prompt: string }
      // Authorship comes from the spec's own front matter, read fresh rather than assumed.
      expect(started.prompt).toContain('take it as complete and critique only what changed around it since')
      expect(started.prompt).toContain('Write nothing until the user says go')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('no_spec_on_disk_and_no_open_tab_refuses_rather_than_inventing_one', async () => {
    const dir = await workspace()
    try {
      await expect(pickUpPlan({ courier: courier(), cwd: dir, feature: 'Order cancellation' })).rejects.toThrow(/No spec/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
