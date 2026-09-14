import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acceptResolution,
  addComment,
  assertApprovable,
  emptyReview,
  openComments,
  pendingRound,
  readReview,
  removeComment,
  reviewPath,
  strikeItem,
  submitRound,
  writeReview,
  type Review,
} from '../src/agent/phases/plan-review'
import { emptied, reviewPrompt, standingStrikes, submitReview, type ReviewCourier } from '../src/agent/phases/review-handoff'
import { resumePlanPrompt, blindPlanPrompt, specPath } from '../src/agent/phases/blind-plan'
import { reconcilePrompt } from '../src/agent/phases/reconcile'

const spec = `---
feature: Order cancellation
status: draft
---

# Order cancellation

## Goal
Orders can be cancelled.

## Cancelling
- B1: an order can be cancelled
- B2: a cancelled order is refunded
  - E1: a partial refund on a shipped order
`

const body = spec.split('---\n')[2]!.replace(/^\s+/, '')

type Delivery = { kind: 'send'; sessionId: string; text: string } | { kind: 'start'; feature: string; text: string }

function courier(live: string[]): ReviewCourier & { delivered: Delivery[] } {
  const delivered: Delivery[] = []
  return {
    delivered,
    isLive: (id) => live.includes(id),
    send: async (sessionId, text) => void delivered.push({ kind: 'send', sessionId, text }),
    start: async (feature, text) => void delivered.push({ kind: 'start', feature, text }),
  }
}

async function workspace(review?: Review): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-'))
  await mkdir(join(dir, 'plan'), { recursive: true })
  await writeFile(specPath(dir, 'Order cancellation'), spec, 'utf8')
  if (review) await writeReview(reviewPath(dir, 'Order cancellation'), review, 'plan/order-cancellation.spec.md')
  return dir
}

function pending(): Review {
  const review = emptyReview()
  addComment(review, 'B1', 'cancelling is not the same as voiding', 'B1: an order can be cancelled')
  strikeItem(review, 'B2')
  return review
}

describe('submitting a review', () => {
  it('goes_to_the_owning_session_when_it_is_still_alive', async () => {
    const dir = await workspace(pending())
    try {
      const post = courier(['owner-1'])
      const round = await submitReview({
        courier: post,
        cwd: dir,
        feature: 'Order cancellation',
        owner: { sessionId: 'owner-1' },
        now: '2026-01-01T00:00:00.000Z',
      })
      expect(round.number).toBe(1)
      expect(post.delivered).toHaveLength(1)
      expect(post.delivered[0]).toMatchObject({ kind: 'send', sessionId: 'owner-1' })
      expect(post.delivered[0]!.text).toContain('C1, on B1: cancelling is not the same as voiding')

      const stored = await readReview(reviewPath(dir, 'Order cancellation'))
      expect(stored.rounds[0]!.submittedAt).toBe('2026-01-01T00:00:00.000Z')
      expect(pendingRound(stored)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('goes_to_a_fresh_plan_session_when_the_owner_is_gone', async () => {
    const dir = await workspace(pending())
    try {
      const post = courier([])
      await submitReview({
        courier: post,
        cwd: dir,
        feature: 'Order cancellation',
        owner: { sessionId: 'owner-1' },
      })
      expect(post.delivered[0]).toMatchObject({ kind: 'start', feature: 'Order cancellation' })
      // The fresh session is told to read both files rather than a transcript it does not have.
      expect(post.delivered[0]!.text).toContain('plan/order-cancellation.spec.md')
      expect(post.delivered[0]!.text).toContain('plan/order-cancellation.review.md')
      expect(post.delivered[0]!.text).toContain('from disk')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('an_empty_review_is_refused_and_nothing_is_sent', async () => {
    const dir = await workspace()
    try {
      const post = courier(['owner-1'])
      await expect(
        submitReview({ courier: post, cwd: dir, feature: 'Order cancellation', owner: { sessionId: 'owner-1' } }),
      ).rejects.toThrow(/empty/)
      expect(post.delivered).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_comment_whose_item_is_gone_from_the_file_is_carried_with_the_text_it_was_written_against', async () => {
    const review = emptyReview()
    addComment(review, 'B9', 'this promises too much', 'B9: every order is refunded within a day')
    const dir = await workspace(review)
    try {
      const post = courier(['owner-1'])
      await submitReview({
        courier: post,
        cwd: dir,
        feature: 'Order cancellation',
        owner: { sessionId: 'owner-1' },
      })
      const text = post.delivered[0]!.text
      expect(text).toContain('C1, on B9, which is no longer in the plan')
      expect(text).toContain('"B9: every order is refunded within a day"')
      expect(text).toContain('this promises too much')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('an_approved_plan_cannot_be_reviewed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'handoff-'))
    try {
      await mkdir(join(dir, 'plan'), { recursive: true })
      await writeFile(specPath(dir, 'Order cancellation'), spec.replace('status: draft', 'status: approved'), 'utf8')
      await writeReview(reviewPath(dir, 'Order cancellation'), pending(), 'plan/order-cancellation.spec.md')
      const post = courier(['owner-1'])
      await expect(
        submitReview({ courier: post, cwd: dir, feature: 'Order cancellation', owner: { sessionId: 'owner-1' } }),
      ).rejects.toThrow(/approved/)
      expect(post.delivered).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('closing a round', () => {
  /** What the agent is told to write: one resolution line under each comment of the round. */
  function resolve(text: string, resolutions: Record<string, string>): string {
    return text
      .split('\n')
      .flatMap((line) => {
        const id = /^- (C\d+) \(/.exec(line)?.[1]
        const answer = id ? resolutions[id] : undefined
        return answer ? [line, `  - ${answer}`] : [line]
      })
      .join('\n')
  }

  it('the_agent_may_disagree_with_everything_and_the_round_still_has_to_be_closed_by_the_human', async () => {
    const dir = await workspace(pending())
    try {
      const file = reviewPath(dir, 'Order cancellation')
      const post = courier(['owner-1'])
      await submitReview({
        courier: post,
        cwd: dir,
        feature: 'Order cancellation',
        owner: { sessionId: 'owner-1' },
      })

      // The agent changes nothing and disagrees; the resolution still lands in the file.
      await writeFile(file, resolve(await readFile(file, 'utf8'), { C1: 'disagreed: cancelling is the right word' }), 'utf8')
      const revised = await readReview(file)
      expect(revised.rounds[0]!.comments[0]!.resolution).toEqual({ kind: 'disagreed', text: 'cancelling is the right word' })
      expect(openComments(revised).map((c) => c.id)).toEqual(['C1'])
      expect(() => assertApprovable(revised)).toThrow(/C1/)

      // The human may argue on in a second round, or accept the disagreement and close it.
      addComment(revised, 'B1', 'I still think it is wrong, but let it stand')
      expect(pendingRound(revised)?.number).toBe(2)
      removeComment(revised, 'C2')
      acceptResolution(revised, 'C1')
      await writeReview(file, revised, 'plan/order-cancellation.spec.md')

      const closed = await readReview(file)
      expect(openComments(closed)).toEqual([])
      expect(() => assertApprovable(closed)).not.toThrow()
      // The record of how the plan was reached stays readable in the file.
      expect(await readFile(file, 'utf8')).toContain('disagreed: cancelling is the right word')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('the plan session knows what a review asks of it', () => {
  it('the_conduct_is_in_the_system_prompt_too_so_a_fresh_session_does_not_wait_for_direction', () => {
    const prompt = blindPlanPrompt('Order cancellation', '/work/repo')
    expect(prompt).toContain('plan/order-cancellation.review.md')
    expect(prompt).toContain('without renumbering')
    expect(prompt).toContain('never bring a struck')
    expect(prompt).toContain('disagreed with a reason')
  })

  it('the_check_is_a_run_not_a_reviewer_so_rulings_on_findings_never_go_to_it', () => {
    const prompt = reconcilePrompt('Order cancellation', '/work/repo')
    expect(prompt).not.toContain('review.md')
    expect(blindPlanPrompt('Order cancellation', '/work/repo')).toContain('[resolved]')
  })

  it('a_session_picking_up_a_spec_reads_the_files_reports_where_it_stands_and_leaves_an_approved_spec_alone', () => {
    const prompt = resumePlanPrompt('Order cancellation')
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('plan/order-cancellation.review.md')
    expect(prompt).toContain('plan/order-cancellation.intent.md')
    expect(prompt).toContain('Do not start over')
    expect(prompt).toContain('An approved spec is settled')
    expect(prompt).toContain('Then stop')
  })
})

describe('the revision the agent is asked for', () => {
  const review = (() => {
    const r = pending()
    addComment(r, 'plan', 'the goal reads like a summary')
    submitRound(r, '2026-01-01T00:00:00.000Z')
    return r
  })()
  const prompt = reviewPrompt({ feature: 'Order cancellation', round: review.rounds[0]!, body, struck: ['B2'] })

  it('names_the_struck_items_and_forbids_renumbering_and_resurrection', () => {
    expect(prompt).toContain('Struck in this round, to be removed: B2.')
    expect(prompt).toContain('[removed]')
    expect(prompt).toContain('do not renumber')
    expect(prompt).toContain('Never reintroduce a struck item')
    expect(prompt).toContain('Repair the items that referred to a removed item')
  })

  it('asks_for_a_resolution_on_every_comment_addressed_or_disagreed_with_a_reason', () => {
    expect(prompt).toContain('Answer every comment of this round')
    expect(prompt).toContain('addressed: what you changed')
    expect(prompt).toContain('disagreed: why you will not')
    expect(prompt).toContain('Never leave a comment unanswered')
  })

  it('says_what_to_do_when_the_plan_is_emptied', () => {
    expect(prompt).toContain('If every item is now struck')
    expect(prompt).toContain('Do not invent a replacement plan')
  })

  it('asks_for_the_revised_plan_and_its_resolutions_to_be_presented_then_a_stop', () => {
    expect(prompt).toContain('what changed in the plan since the review was submitted')
    expect(prompt).toContain('each comment with its resolution')
    expect(prompt).toContain('Then stop')
  })

  it('carries_the_plan_level_comment_as_a_comment_on_the_whole', () => {
    expect(prompt).toContain('C2, on the plan as a whole: the goal reads like a summary')
  })

  it('an_item_struck_in_an_earlier_round_that_the_plan_still_presents_as_live_is_named', () => {
    expect(standingStrikes(body, ['B2'])).toEqual(['B2'])
    const removedB2 = body.replace('- B2: a cancelled order is refunded', '- B2: a cancelled order is refunded [removed]')
    expect(standingStrikes(removedB2, ['B2'])).toEqual([])
    expect(standingStrikes(body, ['B9'])).toEqual([])

    const second = (() => {
      const r = pending()
      submitRound(r, '2026-01-01T00:00:00.000Z')
      addComment(r, 'B1', 'and this one too')
      return submitRound(r, '2026-01-02T00:00:00.000Z')
    })()
    const text = reviewPrompt({ feature: 'Order cancellation', round: second, body, struck: ['B2'] })
    expect(text).toContain('Struck in earlier rounds and still gone: B2.')
    expect(text).toContain('Struck but still standing in the plan, to be marked removed: B2.')
  })

  it('a_plan_whose_every_item_is_struck_is_reported_as_emptied', () => {
    expect(emptied(body, ['B1', 'B2', 'E1'])).toBe(true)
    expect(emptied(body, ['B1', 'B2'])).toBe(false)
    expect(emptied('# Nothing here', [])).toBe(false)

    const all = (() => {
      const r = emptyReview()
      for (const id of ['B1', 'B2', 'E1']) strikeItem(r, id)
      return submitRound(r, '2026-01-01T00:00:00.000Z')
    })()
    const text = reviewPrompt({ feature: 'Order cancellation', round: all, body, struck: ['B1', 'B2', 'E1'] })
    expect(text).toContain('Every item in the plan is now struck: nothing remains.')
    expect(text).toContain('report that nothing remains and stop')
  })
})
