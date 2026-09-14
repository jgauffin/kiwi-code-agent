import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acceptResolution,
  addComment,
  assertApprovable,
  assertCommentable,
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
  reviewPath,
  strikeItem,
  struckItems,
  submitRound,
  unstrikeItem,
  writeReview,
} from '../src/agent/phases/plan-review'

const body = `# Orders

## Behaviour
- B1: an order can be cancelled
- B2: a cancelled order is refunded [removed]

## Tasks
- T1: cancellation (B1, B2)

## Findings
| Finding | Proposed solution |
|---|---|
| F1 (contradiction, B1): the code says otherwise | keep B1, amend intent |
| F2 (breakage, T1): reports break [removed] | |
`

describe('plan items', () => {
  it('items_are_addressed_by_id_and_a_removed_item_is_still_an_item', () => {
    expect(planItems(body)).toEqual([
      { id: 'B1', text: 'an order can be cancelled', section: 'Behaviour', removed: false },
      { id: 'B2', text: 'a cancelled order is refunded [removed]', section: 'Behaviour', removed: true },
      { id: 'T1', text: 'cancellation (B1, B2)', section: 'Tasks', removed: false },
      { id: 'F1', text: '(contradiction, B1) the code says otherwise', section: 'Findings', removed: false },
      { id: 'F2', text: '(breakage, T1) reports break [removed]', section: 'Findings', removed: true },
    ])
  })
})

describe('review authoring', () => {
  it('a_comment_can_be_attached_to_an_item_and_to_the_plan_as_a_whole', () => {
    const review = emptyReview()
    addComment(review, 'B1', 'this is not what cancelling means', 'B1: an order can be cancelled')
    addComment(review, 'plan', 'the goal misses the refund story')
    expect(review.rounds).toHaveLength(1)
    expect(review.rounds[0]).toMatchObject({ number: 1, strikes: [] })
    expect(review.rounds[0]!.comments).toEqual([
      { id: 'C1', target: 'B1', text: 'this is not what cancelling means', item: 'B1: an order can be cancelled' },
      { id: 'C2', target: 'plan', text: 'the goal misses the refund story' },
    ])
  })

  it('a_pending_comment_can_be_edited_and_removed_a_submitted_one_cannot', () => {
    const review = emptyReview()
    addComment(review, 'B1', 'wrong')
    editComment(review, 'C1', 'still wrong, and here is why')
    expect(review.rounds[0]!.comments[0]!.text).toBe('still wrong, and here is why')
    removeComment(review, 'C1')
    expect(review.rounds).toHaveLength(0)

    addComment(review, 'B1', 'wrong again')
    submitRound(review, '2026-01-01T00:00:00.000Z')
    expect(() => editComment(review, 'C2', 'no')).toThrow(/submitted/)
    expect(() => removeComment(review, 'C2')).toThrow(/submitted/)
  })

  it('a_submitted_comment_id_is_never_handed_out_again', () => {
    const review = emptyReview()
    addComment(review, 'B1', 'one')
    submitRound(review, '2026-01-01T00:00:00.000Z')
    expect(addComment(review, 'B2', 'two').id).toBe('C2')
  })

  it('an_item_can_be_struck_and_unstruck_while_the_review_is_unsubmitted', () => {
    const review = emptyReview()
    strikeItem(review, 'B2')
    strikeItem(review, 'B2')
    expect(struckItems(review)).toEqual(['B2'])
    unstrikeItem(review, 'B2')
    expect(struckItems(review)).toEqual([])
    expect(review.rounds).toHaveLength(0)
  })

  it('a_struck_item_cannot_be_unstruck_once_the_round_is_submitted', () => {
    const review = emptyReview()
    strikeItem(review, 'B2')
    submitRound(review, '2026-01-01T00:00:00.000Z')
    expect(() => unstrikeItem(review, 'B2')).toThrow(/submitted/)
    expect(struckItems(review)).toEqual(['B2'])
  })

  it('the_pending_review_is_one_batch_shown_as_a_whole_and_submitted_at_once', () => {
    const review = emptyReview()
    addComment(review, 'B1', 'one')
    strikeItem(review, 'B2')
    const pending = pendingRound(review)
    expect(pending?.comments.map((c) => c.id)).toEqual(['C1'])
    expect(pending?.strikes).toEqual(['B2'])
    submitRound(review, '2026-01-01T00:00:00.000Z')
    expect(pendingRound(review)).toBeUndefined()
    addComment(review, 'B1', 'next round')
    expect(pendingRound(review)?.number).toBe(2)
  })

  it('an_empty_review_is_refused_so_no_turn_is_spent', () => {
    expect(() => submitRound(emptyReview())).toThrow(/empty/)
    const review = emptyReview()
    addComment(review, 'B1', 'x')
    removeComment(review, 'C1')
    expect(() => submitRound(review)).toThrow(/empty/)
  })

  it('a_comment_on_a_removed_item_is_allowed_it_is_how_a_struck_item_comes_back', () => {
    const review = emptyReview()
    strikeItem(review, 'B2')
    submitRound(review, '2026-01-01T00:00:00.000Z')
    const comment = addComment(review, 'B2', 'bring this one back, I struck it by mistake')
    expect(comment.target).toBe('B2')
    expect(pendingRound(review)?.comments).toHaveLength(1)
  })
})

describe('resolutions and the approval gate', () => {
  it('a_comment_stays_open_until_its_resolution_is_accepted_even_a_disagreement', () => {
    const review = emptyReview()
    addComment(review, 'B1', 'wrong')
    submitRound(review, '2026-01-01T00:00:00.000Z')
    expect(openComments(review).map((c) => c.id)).toEqual(['C1'])
    expect(() => acceptResolution(review, 'C1')).toThrow(/no resolution/)

    review.rounds[0]!.comments[0]!.resolution = { kind: 'disagreed', text: 'intent says otherwise' }
    expect(openComments(review).map((c) => c.id)).toEqual(['C1'])
    expect(() => assertApprovable(review)).toThrow(/C1/)
    acceptResolution(review, 'C1')
    expect(openComments(review)).toEqual([])
    expect(() => assertApprovable(review)).not.toThrow()
  })

  it('an_unsubmitted_comment_blocks_approval_too', () => {
    const review = emptyReview()
    addComment(review, 'B1', 'wait')
    expect(() => assertApprovable(review)).toThrow(/C1/)
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
  it('round_trips_comments_strikes_resolutions_and_acceptance', () => {
    const review = emptyReview()
    addComment(review, 'B1', 'not what cancelling means', 'B1: an order can be cancelled')
    addComment(review, 'plan', 'the goal misses refunds')
    strikeItem(review, 'B2')
    submitRound(review, '2026-01-01T00:00:00.000Z')
    review.rounds[0]!.comments[0]!.resolution = { kind: 'addressed', text: 'rewrote B1' }
    review.rounds[0]!.comments[1]!.resolution = { kind: 'disagreed', text: 'refunds are another feature' }
    acceptResolution(review, 'C1')
    addComment(review, 'B2', 'bring it back')

    const text = renderReview(review, 'plan/orders.spec.md')
    expect(text).toContain('# Review of plan/orders.spec.md')
    expect(text).toContain('## Round 1 — submitted 2026-01-01T00:00:00.000Z')
    expect(text).toContain('- C1 (B1): not what cancelling means')
    expect(text).toContain('  - addressed: rewrote B1')
    expect(text).toContain('  - accepted')
    expect(text).toContain('- struck: B2')
    expect(text).toContain('## Round 2 — pending')
    expect(parseReview(text)).toEqual(review)
  })

  it('a_resolution_the_agent_wrote_loosely_is_still_read', () => {
    const text = `# Review of plan/orders.spec.md

## Round 1 — submitted 2026-01-01T00:00:00.000Z
- C1 (B1): wrong
  - resolution (addressed): rewrote it
- C2 (plan): thin
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
      addComment(review, 'B1', 'wrong')
      strikeItem(review, 'B3')
      await mkdir(join(dir, 'plan'), { recursive: true })
      await writeReview(path, review, 'plan/order-cancellation.spec.md')
      expect(await readReview(path)).toEqual(review)

      submitRound(review, '2026-01-01T00:00:00.000Z')
      await writeReview(path, review, 'plan/order-cancellation.spec.md')
      const reloaded = await readReview(path)
      expect(pendingRound(reloaded)).toBeUndefined()
      expect(struckItems(reloaded)).toEqual(['B3'])
      expect(openComments(reloaded).map((c) => c.id)).toEqual(['C1'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
