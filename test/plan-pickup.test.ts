import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { specPath } from '../src/agent/phases/blind-plan'
import { pickUpPlan, type PlanPickupCourier } from '../src/agent/phases/plan-pickup'
import { readSpecState } from '../src/agent/phases/spec-file'
import { parseSpec, specFingerprint } from '../src/agent/phases/spec-model'
import { deriveBoard, tasksPath, writeBoard } from '../src/agent/phases/tasks-file'

const spec = `---
feature: Order cancellation
status: draft
---

# Order cancellation

## Goal
Orders can be cancelled.
`

type Delivery =
  | { kind: 'open'; sessionId: string }
  | { kind: 'start'; feature: string; prompt: string; label: string }
  | { kind: 'say'; sessionId: string; note: string }
  | { kind: 'tell'; sessionId: string; prompt: string; label: string }

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
    tell: async (sessionId, prompt, label) => void delivered.push({ kind: 'tell', sessionId, prompt, label }),
    critiqueOwed: (feature) => void owed.push(feature),
  }
}

/** The spec as it was approved and built. */
const built = `---
feature: Order cancellation
status: verified
authored: planned
---

# Order cancellation

## Goal
Orders can be cancelled.

## Cancelling an order
- **Cancel before shipping**: an order not yet shipped can be cancelled
- **Cancel reason**: the buyer gives a reason when cancelling
`

/** Revised by hand afterwards and back to draft: one rule amended, one added, one left alone. */
const revised = built
  .replace('status: verified', 'status: draft')
  .replace('an order not yet shipped can be cancelled', 'an order not yet packed can be cancelled')
  .replace('when cancelling\n', 'when cancelling\n- **Refund on cancel**: a cancelled order is refunded in full\n')

/** A workspace whose board was derived from `built` and finished, holding `now` as a draft spec. */
async function builtThenRevised(now = revised): Promise<string> {
  const dir = await workspace({ 'order-cancellation.spec.md': built })
  const state = await readSpecState(specPath(dir, 'Order cancellation'))
  if (!state.exists) throw new Error('spec not written')
  const board = deriveBoard(parseSpec(state.body))
  await mkdir(join(dir, '.kiwi', 'specs'), { recursive: true })
  await writeBoard(tasksPath(dir, 'Order cancellation'), { ...board, tasks: board.tasks.map((t) => ({ ...t, state: 'tested' as const })) })
  await writeFile(specPath(dir, 'Order cancellation'), now.replace('status: verified', 'status: draft'))
  return dir
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

  it('a_revised_draft_brought_up_in_its_open_session_names_the_rules_nothing_has_built_yet', async () => {
    const dir = await builtThenRevised()
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation', owner: { sessionId: 'owner-1', specSeen: 'older-version' } })
      expect(post.delivered[0]).toEqual({ kind: 'open', sessionId: 'owner-1' })
      expect(post.delivered[1]).toMatchObject({ kind: 'tell', sessionId: 'owner-1', label: 'Planning the revised spec' })
      const told = (post.delivered[1] as { prompt: string }).prompt
      expect(told).toContain('specs/order-cancellation.spec.md')
      expect(told).toContain('"Refund on cancel"')
      expect(told).toContain('"Cancel before shipping"')
      // A rule the board already delivers as it stands is built: naming it would send the planner over finished work.
      expect(told).not.toContain('"Cancel reason"')
      expect(told).toContain('Write nothing until the user says go')
      expect(post.owed).toEqual(['Order cancellation'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_revised_draft_its_open_session_already_saw_brings_the_tab_up_with_nothing_said_again', async () => {
    const dir = await builtThenRevised()
    try {
      const post = courier()
      const seen = await readSpecState(specPath(dir, 'Order cancellation'))
      const specSeen = seen.exists ? specFingerprint(parseSpec(seen.body)) : ''
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation', owner: { sessionId: 'owner-1', specSeen } })
      expect(post.delivered).toEqual([{ kind: 'open', sessionId: 'owner-1' }])
      expect(post.owed).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_draft_with_no_board_brought_up_in_its_open_session_is_left_to_the_conversation_it_has', async () => {
    const dir = await workspace({ 'order-cancellation.spec.md': revised })
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation', owner: { sessionId: 'owner-1' } })
      expect(post.delivered).toEqual([{ kind: 'open', sessionId: 'owner-1' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_revised_draft_whose_rules_are_all_built_has_nothing_to_plan_in_its_open_session', async () => {
    const dir = await builtThenRevised(built.replace('Orders can be cancelled.', 'Orders can be cancelled by the buyer.'))
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation', owner: { sessionId: 'owner-1' } })
      expect(post.delivered).toEqual([{ kind: 'open', sessionId: 'owner-1' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_revised_draft_picked_up_in_a_fresh_session_is_told_which_rules_nothing_has_built_yet', async () => {
    const dir = await builtThenRevised()
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation' })
      const started = (post.delivered[0] as { prompt: string }).prompt
      expect(started).toContain('"Refund on cancel"')
      expect(started).not.toContain('"Cancel reason"')
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

  it('a_draft_filed_in_a_domain_folder_is_picked_up_the_same_as_any_other', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pickup-'))
    try {
      await mkdir(join(dir, 'specs', 'orders'), { recursive: true })
      await writeFile(join(dir, 'specs', 'orders', 'order-cancellation.spec.md'), spec)
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation' })
      const started = post.delivered[0] as { prompt: string }
      expect(started.prompt).toContain('specs/orders/order-cancellation.spec.md')
      expect(started.prompt).toContain('Do not start over')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_draft_pickup_says_a_critique_is_owed_before_the_session_it_starts_says_anything', async () => {
    const dir = await workspace({ 'order-cancellation.spec.md': spec })
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation' })
      expect(post.owed).toEqual(['Order cancellation'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_settled_spec_is_resumed_with_no_critique_owed_since_there_is_nothing_left_to_steer', async () => {
    const dir = await workspace({ 'order-cancellation.spec.md': spec.replace('status: draft', 'status: approved') })
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation' })
      expect(post.owed).toEqual([])
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

  it('a_note_typed_before_the_pickup_is_said_in_the_session_that_already_owns_the_plan', async () => {
    const dir = await workspace()
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation', owner: { sessionId: 'owner-1' }, note: 'Drop the refund rule' })
      expect(post.delivered).toEqual([
        { kind: 'open', sessionId: 'owner-1' },
        { kind: 'say', sessionId: 'owner-1', note: 'Drop the refund rule' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_note_typed_before_the_pickup_is_said_in_the_fresh_session_after_its_kickoff', async () => {
    const dir = await workspace({ 'order-cancellation.spec.md': spec })
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation', note: 'Drop the refund rule' })
      // The kickoff stays the extension's own text; the note follows it as the person's own message, so the chat shows it in their words.
      expect(post.delivered[0]).toMatchObject({ kind: 'start' })
      expect(post.delivered[1]).toEqual({ kind: 'say', sessionId: 'started-1', note: 'Drop the refund rule' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('no_note_typed_leaves_the_pickup_with_nothing_extra_to_say', async () => {
    const dir = await workspace({ 'order-cancellation.spec.md': spec })
    try {
      const post = courier()
      await pickUpPlan({ courier: post, cwd: dir, feature: 'Order cancellation' })
      expect(post.delivered.filter((d) => d.kind === 'say')).toEqual([])
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
