import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { featureAlreadyNamed, listDraftPlans, listPlans } from '../src/agent/phases/plan-list'
import { renderBoard, withCleanupDecision, withRecord, type TaskBoard } from '../src/agent/phases/tasks-file'
import { addComment, emptyReview, resolveComment, submitRound, writeReview } from '../src/agent/phases/plan-review'
import { board, task } from './task-board-fixture'

const allTested = (name: string): TaskBoard => board(task(name, { state: 'tested' }))
const passed = (b: TaskBoard): TaskBoard => withRecord(b, { at: '2026-09-14T10:00:00Z', ok: true, text: '' })

/** Specs go under `specs/`, a spec name with a slash in a domain folder there; every other plan file among the working files. */
async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'plans-'))
  await mkdir(join(dir, 'specs'))
  await mkdir(join(dir, '.kiwi', 'specs'), { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    const path = name.endsWith('.spec.md') ? join(dir, 'specs', ...name.split('/')) : join(dir, '.kiwi', 'specs', name)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, text)
  }
  return dir
}

describe('plan list', () => {
  it('lists_every_spec_with_its_status_and_an_approved_spec_whose_board_passed_verification_as_verified', async () => {
    const dir = await workspace({
      'orders.spec.md': '---\nfeature: Orders\nstatus: draft\n---\n# Orders\n',
      'billing.spec.md': '---\nfeature: Billing\nstatus: approved\n---\n# Billing\n',
      'billing.tasks.json': renderBoard(allTested('Bill')),
      'audit.spec.md': '---\nfeature: Audit\nstatus: approved\n---\n# Audit\n',
      'audit.tasks.json': renderBoard(passed(allTested('Log'))),
      'orders.review.md': '# not a spec\n',
    })
    try {
      expect(await listPlans(dir)).toEqual([
        { feature: 'Audit', path: join(dir, 'specs', 'audit.spec.md'), status: 'verified' },
        // All tested but not yet passed the test run: still in play.
        { feature: 'Billing', path: join(dir, 'specs', 'billing.spec.md'), status: 'approved' },
        // Nothing recorded about how it was authored, and its review file is not a review round: hand-written, never reviewed.
        { feature: 'Orders', path: join(dir, 'specs', 'orders.spec.md'), status: 'draft', authored: 'hand-written', review: 'created' },
      ])
      expect(await listDraftPlans(dir)).toMatchObject([{ feature: 'Orders' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_feature_whose_tests_passed_is_verified_whatever_the_cleanup_decision', async () => {
    const dir = await workspace({
      'audit.spec.md': '---\nfeature: Audit\nstatus: approved\n---\n# Audit\n',
      'audit.tasks.json': renderBoard(withCleanupDecision(passed(allTested('Log')), 'postponed')),
      'billing.spec.md': '---\nfeature: Billing\nstatus: approved\n---\n# Billing\n',
      'billing.tasks.json': renderBoard(withCleanupDecision(passed(allTested('Bill')), 'skipped')),
    })
    try {
      expect(await listPlans(dir)).toMatchObject([
        { feature: 'Audit', status: 'verified' },
        { feature: 'Billing', status: 'verified' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_verified_spec_is_verified_without_its_working_files', async () => {
    const dir = await workspace({ 'audit.spec.md': '---\nfeature: Audit\nstatus: verified\n---\n# Audit\n' })
    try {
      expect(await listPlans(dir)).toMatchObject([{ feature: 'Audit', status: 'verified' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_spec_without_a_feature_line_is_named_by_its_slug', async () => {
    const dir = await workspace({ 'user-question.spec.md': '# User question\n' })
    try {
      expect(await listPlans(dir)).toMatchObject([{ feature: 'user-question', status: 'draft' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_spec_whose_name_does_not_lead_back_to_its_file_is_named_by_its_slug_so_its_sessions_find_it', async () => {
    const dir = await workspace({ 'analyzers/dotnet-analyzer.spec.md': '---\nfeature: .NET analyzer\nstatus: approved\n---\n# .NET analyzer\n' })
    try {
      expect(await listPlans(dir)).toMatchObject([{ feature: 'dotnet-analyzer' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_spec_one_domain_folder_deep_is_listed_like_any_other', async () => {
    const dir = await workspace({ 'orders/refunds.spec.md': '---\nfeature: Refunds\nstatus: approved\n---\n# Refunds\n' })
    try {
      expect(await listPlans(dir)).toMatchObject([{ feature: 'Refunds', path: join(dir, 'specs', 'orders', 'refunds.spec.md'), status: 'approved', folder: 'orders' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_spec_filed_deeper_than_one_folder_is_still_listed_though_nothing_proposes_such_a_folder', async () => {
    const dir = await workspace({ 'orders/archive/refunds.spec.md': '---\nfeature: Refunds\nstatus: approved\n---\n# Refunds\n' })
    try {
      expect(await listPlans(dir)).toMatchObject([
        { feature: 'Refunds', path: join(dir, 'specs', 'orders', 'archive', 'refunds.spec.md'), status: 'approved', folder: 'orders/archive' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('unfiled_decisions_and_future_work_at_the_root_are_never_listed_as_specs', async () => {
    const dir = await workspace({ 'orders.spec.md': '---\nfeature: Orders\nstatus: draft\n---\n# Orders\n' })
    try {
      await writeFile(join(dir, 'specs', 'unfiled-decisions.md'), '# Unfiled\n')
      await writeFile(join(dir, 'specs', 'future-work.md'), '# Future work\n')
      expect(await listPlans(dir)).toMatchObject([{ feature: 'Orders' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_workspace_without_a_plan_directory_has_no_plans', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plans-'))
    try {
      expect(await listPlans(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_draft_records_how_it_was_planned_or_drafted_when_its_front_matter_says_so', async () => {
    const dir = await workspace({
      'orders.spec.md': '---\nfeature: Orders\nstatus: draft\nauthored: planned\n---\n# Orders\n',
      'billing.spec.md': '---\nfeature: Billing\nstatus: draft\nauthored: drafted\n---\n# Billing\n',
    })
    try {
      expect(await listPlans(dir)).toMatchObject([
        { feature: 'Billing', authored: 'drafted' },
        { feature: 'Orders', authored: 'planned' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('nothing_recorded_about_how_a_draft_was_authored_counts_as_hand_written', async () => {
    const dir = await workspace({ 'orders.spec.md': '---\nfeature: Orders\nstatus: draft\n---\n# Orders\n' })
    try {
      expect(await listPlans(dir)).toMatchObject([{ feature: 'Orders', authored: 'hand-written' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_settled_spec_carries_neither_authorship_nor_a_review_stage', async () => {
    const dir = await workspace({ 'orders.spec.md': '---\nfeature: Orders\nstatus: approved\nauthored: planned\n---\n# Orders\n' })
    try {
      const [orders] = await listPlans(dir)
      expect(orders).not.toHaveProperty('authored')
      expect(orders).not.toHaveProperty('review')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_draft_with_no_review_file_has_never_been_reviewed', async () => {
    const dir = await workspace({ 'orders.spec.md': '---\nfeature: Orders\nstatus: draft\n---\n# Orders\n' })
    try {
      expect(await listPlans(dir)).toMatchObject([{ feature: 'Orders', review: 'created' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_draft_with_a_round_the_planner_has_yet_to_answer_is_a_review_in_flight', async () => {
    const dir = await workspace({ 'orders.spec.md': '---\nfeature: Orders\nstatus: draft\n---\n# Orders\n\n## Goal\nOrders.\n' })
    try {
      const review = emptyReview()
      addComment(review, 'plan', 'needs a second look')
      submitRound(review, '2026-01-01T00:00:00.000Z')
      await writeReview(join(dir, '.kiwi', 'specs', 'orders.review.md'), review, 'specs/orders.spec.md')
      expect(await listPlans(dir)).toMatchObject([{ feature: 'Orders', review: 'under_review' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_draft_whose_planner_has_answered_every_comment_shows_so_until_the_human_closes_the_round', async () => {
    const dir = await workspace({ 'orders.spec.md': '---\nfeature: Orders\nstatus: draft\n---\n# Orders\n\n## Goal\nOrders.\n' })
    try {
      const review = emptyReview()
      addComment(review, 'plan', 'needs a second look')
      submitRound(review, '2026-01-01T00:00:00.000Z')
      review.rounds[0]!.comments[0]!.resolution = { kind: 'addressed', text: 'reworded the goal' }
      await writeReview(join(dir, '.kiwi', 'specs', 'orders.review.md'), review, 'specs/orders.spec.md')
      expect(await listPlans(dir)).toMatchObject([{ feature: 'Orders', review: 'final_draft' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_draft_whose_round_the_human_closed_is_ready_again_rather_than_still_mid_review', async () => {
    const dir = await workspace({ 'orders.spec.md': '---\nfeature: Orders\nstatus: draft\n---\n# Orders\n\n## Goal\nOrders.\n' })
    try {
      const review = emptyReview()
      addComment(review, 'plan', 'needs a second look')
      submitRound(review, '2026-01-01T00:00:00.000Z')
      review.rounds[0]!.comments[0]!.resolution = { kind: 'addressed', text: 'reworded the goal' }
      resolveComment(review, { round: 1, index: 0 })
      await writeReview(join(dir, '.kiwi', 'specs', 'orders.review.md'), review, 'specs/orders.spec.md')
      expect(await listPlans(dir)).toMatchObject([{ feature: 'Orders', review: 'created' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('a feature name already taken', () => {
  it('names_the_feature_whose_spec_the_name_resolves_to', async () => {
    const dir = await workspace({ 'order-cancellation.spec.md': '---\nfeature: Order cancellation\nstatus: draft\n---\n# Order cancellation\n' })
    try {
      expect(await featureAlreadyNamed(dir, 'Order cancellation', [])).toBe('Order cancellation')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('names_the_feature_when_a_differently_spelled_name_resolves_to_the_same_spec', async () => {
    const dir = await workspace({ 'order-cancellation.spec.md': '---\nfeature: Order cancellation\nstatus: draft\n---\n# Order cancellation\n' })
    try {
      expect(await featureAlreadyNamed(dir, 'Order, cancellation!', [])).toBe('Order cancellation')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('names_a_feature_whose_planning_session_has_yet_to_write_its_spec', async () => {
    const dir = await workspace({})
    try {
      expect(await featureAlreadyNamed(dir, 'Plan linked spec', ['Plan linked spec'])).toBe('Plan linked spec')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('leaves_a_name_no_spec_and_no_planning_session_holds_free', async () => {
    const dir = await workspace({ 'order-cancellation.spec.md': '---\nfeature: Order cancellation\nstatus: draft\n---\n# Order cancellation\n' })
    try {
      expect(await featureAlreadyNamed(dir, 'Order refunds', ['Plan linked spec'])).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('names_the_feature_whose_spec_sits_in_a_domain_folder_the_folder_is_not_identity', async () => {
    const dir = await workspace({ 'orders/order-cancellation.spec.md': '---\nfeature: Order cancellation\nstatus: draft\n---\n# Order cancellation\n' })
    try {
      expect(await featureAlreadyNamed(dir, 'Order cancellation', [])).toBe('Order cancellation')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
