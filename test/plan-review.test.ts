import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addComment,
  assertApprovable,
  assertCommentable,
  commentAt,
  editComment,
  emptyReview,
  isCommentable,
  openComments,
  parseReview,
  pendingRound,
  planItems,
  readReview,
  removeComment,
  renderReview,
  resolveComment,
  reviewPath,
  strikeItem,
  struckItems,
  submitRound,
  unstrikeItem,
  writeReview,
} from '../src/agent/phases/plan-review'

const body = `# Orders

## Goal
Orders can be cancelled.

## Cancelling
- **Cancel command**: an order can be cancelled
  - **Shipped order**: a shipped order cannot
- **Refund**: a cancelled order is refunded [removed]

## Decisions
### The code refuses shipped orders
- on: Cancel command
- finding: the code says otherwise
`

const first = { round: 1, index: 0 }
const second = { round: 1, index: 1 }

describe('plan items', () => {
  it('items_are_addressed_by_name_and_a_removed_item_is_still_an_item_but_a_decision_is_not', () => {
    expect(planItems(body)).toEqual([
      { name: 'Cancel command', text: 'an order can be cancelled', section: 'Cancelling', removed: false },
      { name: 'Shipped order', text: 'a shipped order cannot', section: 'Cancelling', removed: false },
      { name: 'Refund', text: 'a cancelled order is refunded [removed]', section: 'Cancelling', removed: true },
    ])
  })
})

describe('review authoring', () => {
  it('a_comment_can_be_attached_to_an_item_and_to_the_plan_as_a_whole', () => {
    const review = emptyReview()
    addComment(review, 'Cancel command', 'this is not what cancelling means', 'Cancel command: an order can be cancelled')
    addComment(review, 'plan', 'the goal misses the refund story')
    expect(review.rounds).toHaveLength(1)
    expect(review.rounds[0]).toMatchObject({ number: 1, strikes: [] })
    expect(review.rounds[0]!.comments).toEqual([
      { target: 'Cancel command', text: 'this is not what cancelling means', item: 'Cancel command: an order can be cancelled' },
      { target: 'plan', text: 'the goal misses the refund story' },
    ])
  })

  it('a_comment_is_addressed_by_its_round_and_position_and_a_submitted_one_cannot_change', () => {
    const review = emptyReview()
    addComment(review, 'Cancel command', 'wrong')
    expect(commentAt(review, first)?.text).toBe('wrong')
    editComment(review, first, 'still wrong, and here is why')
    expect(review.rounds[0]!.comments[0]!.text).toBe('still wrong, and here is why')
    removeComment(review, first)
    expect(review.rounds).toHaveLength(0)

    addComment(review, 'Cancel command', 'wrong again')
    submitRound(review, '2026-01-01T00:00:00.000Z')
    expect(() => editComment(review, first, 'no')).toThrow(/submitted/)
    expect(() => removeComment(review, first)).toThrow(/submitted/)
    expect(() => editComment(review, { round: 2, index: 0 }, 'no')).toThrow(/no such comment/)
  })

  it('an_item_can_be_struck_and_unstruck_while_the_review_is_unsubmitted', () => {
    const review = emptyReview()
    strikeItem(review, 'Refund')
    strikeItem(review, 'Refund')
    expect(struckItems(review)).toEqual(['Refund'])
    unstrikeItem(review, 'Refund')
    expect(struckItems(review)).toEqual([])
    expect(review.rounds).toHaveLength(0)
  })

  it('a_struck_item_cannot_be_unstruck_once_the_round_is_submitted', () => {
    const review = emptyReview()
    strikeItem(review, 'Refund')
    submitRound(review, '2026-01-01T00:00:00.000Z')
    expect(() => unstrikeItem(review, 'Refund')).toThrow(/submitted/)
    expect(struckItems(review)).toEqual(['Refund'])
  })

  it('the_pending_review_is_one_batch_shown_as_a_whole_and_submitted_at_once', () => {
    const review = emptyReview()
    addComment(review, 'Cancel command', 'one')
    strikeItem(review, 'Refund')
    const pending = pendingRound(review)
    expect(pending?.comments.map((c) => c.text)).toEqual(['one'])
    expect(pending?.strikes).toEqual(['Refund'])
    submitRound(review, '2026-01-01T00:00:00.000Z')
    expect(pendingRound(review)).toBeUndefined()
    addComment(review, 'Cancel command', 'next round')
    expect(pendingRound(review)?.number).toBe(2)
  })

  it('an_empty_review_is_refused_so_no_turn_is_spent', () => {
    expect(() => submitRound(emptyReview())).toThrow(/empty/)
    const review = emptyReview()
    addComment(review, 'Cancel command', 'x')
    removeComment(review, first)
    expect(() => submitRound(review)).toThrow(/empty/)
  })

  it('a_comment_on_a_removed_item_is_allowed_it_is_how_a_struck_item_comes_back', () => {
    const review = emptyReview()
    strikeItem(review, 'Refund')
    submitRound(review, '2026-01-01T00:00:00.000Z')
    const comment = addComment(review, 'Refund', 'bring this one back, I struck it by mistake')
    expect(comment.target).toBe('Refund')
    expect(pendingRound(review)?.comments).toHaveLength(1)
  })
})

describe('resolutions and the approval gate', () => {
  it('resolving_a_comment_closes_it_even_when_the_agent_disagreed', () => {
    const review = emptyReview()
    addComment(review, 'Cancel command', 'wrong')
    submitRound(review, '2026-01-01T00:00:00.000Z')
    expect(openComments(review).map((c) => c.text)).toEqual(['wrong'])
    expect(() => resolveComment(review, first)).toThrow(/no resolution/)

    review.rounds[0]!.comments[0]!.resolution = { kind: 'disagreed', text: 'intent says otherwise' }
    expect(openComments(review).map((c) => c.text)).toEqual(['wrong'])
    expect(() => assertApprovable(review)).toThrow(/on Cancel command/)
    resolveComment(review, first)
    expect(openComments(review)).toEqual([])
    expect(() => assertApprovable(review)).not.toThrow()
  })

  it('an_unsubmitted_comment_blocks_approval_too', () => {
    const review = emptyReview()
    addComment(review, 'plan', 'wait')
    expect(() => assertApprovable(review)).toThrow(/on the plan/)
  })
})

describe('commenting is offered on a draft only', () => {
  it('a_missing_or_approved_plan_is_not_commentable', () => {
    expect(isCommentable({ exists: true, status: 'draft', body })).toBe(true)
    expect(isCommentable({ exists: true, status: 'approved', body })).toBe(false)
    expect(isCommentable({ exists: false })).toBe(false)
    expect(() => assertCommentable({ exists: true, status: 'approved', body })).toThrow(/approved/)
    expect(() => assertCommentable({ exists: false })).toThrow(/No plan/)
  })
})

describe('the review file', () => {
  it('the_file_names_targets_and_carries_no_ids', () => {
    const review = emptyReview()
    addComment(review, 'Cancel command', 'not what cancelling means', 'Cancel command: an order can be cancelled')
    addComment(review, 'plan', 'the goal misses refunds')
    strikeItem(review, 'Refund')
    strikeItem(review, 'Shipped order')
    submitRound(review, '2026-01-01T00:00:00.000Z')
    review.rounds[0]!.comments[0]!.resolution = { kind: 'addressed', text: 'rewrote the rule' }
    review.rounds[0]!.comments[1]!.resolution = { kind: 'disagreed', text: 'refunds are another feature' }
    resolveComment(review, first)
    addComment(review, 'Refund', 'bring it back')

    const text = renderReview(review, 'plan/orders.spec.md')
    expect(text).toContain('# Review of plan/orders.spec.md')
    expect(text).toContain('## Round 1, submitted 2026-01-01T00:00:00.000Z')
    expect(text).toContain('- on Cancel command: not what cancelling means\n  - item: Cancel command: an order can be cancelled\n  - addressed: rewrote the rule\n  - resolved')
    expect(text).toContain('- on the plan: the goal misses refunds')
    expect(text).toContain('- remove: Refund, Shipped order')
    expect(text).toContain('## Round 2, pending')
    expect(text).not.toMatch(/\bC\d\b/)
    expect(text).not.toContain('—')
    expect(parseReview(text)).toEqual(review)
    expect(commentAt(parseReview(text), second)?.target).toBe('plan')
  })

  it('a_resolution_the_agent_wrote_loosely_is_still_read', () => {
    const text = `# Review of plan/orders.spec.md

## Round 1, submitted 2026-01-01T00:00:00.000Z
- on Cancel command: wrong
  - resolution (addressed): rewrote it
- on the plan: thin
  - Disagreed: the plan is deliberately short
`
    const review = parseReview(text)
    expect(review.rounds[0]!.comments[0]!.resolution).toEqual({ kind: 'addressed', text: 'rewrote it' })
    expect(review.rounds[0]!.comments[1]!.resolution).toEqual({ kind: 'disagreed', text: 'the plan is deliberately short' })
  })

  it('survives_a_reload_through_the_file_next_to_the_spec', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'review-'))
    try {
      const path = reviewPath(dir, 'Order cancellation')
      expect(path).toBe(join(dir, 'plan', 'order-cancellation.review.md'))
      expect(await readReview(path)).toEqual(emptyReview())

      const review = emptyReview()
      addComment(review, 'Cancel command', 'wrong')
      strikeItem(review, 'Shipped order')
      await mkdir(join(dir, 'plan'), { recursive: true })
      await writeReview(path, review, 'plan/order-cancellation.spec.md')
      expect(await readReview(path)).toEqual(review)

      submitRound(review, '2026-01-01T00:00:00.000Z')
      await writeReview(path, review, 'plan/order-cancellation.spec.md')
      const reloaded = await readReview(path)
      expect(pendingRound(reloaded)).toBeUndefined()
      expect(struckItems(reloaded)).toEqual(['Shipped order'])
      expect(openComments(reloaded).map((c) => c.text)).toEqual(['wrong'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
