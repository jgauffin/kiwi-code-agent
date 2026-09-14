import { describe, expect, it } from 'vitest'
import { isApprovable, isMappable, planStage, tasksStale } from '../src/agent/phases/plan-stage'
import { parseReview } from '../src/agent/phases/plan-review'
import type { SpecState } from '../src/agent/phases/spec-file'
import { parseSpec, specFingerprint } from '../src/agent/phases/spec-model'
import { parseTasks, withSpecFingerprint, type TasksState } from '../src/agent/phases/tasks-file'

const body = '# Order cancellation\n\n## Goal\nOrders can be cancelled.\n\n## Cancelling\n- B1: an order can be cancelled\n- B2: a cancelled order is gone [removed]\n'
const draft: SpecState = { exists: true, status: 'draft', body }
const approved: SpecState = { exists: true, status: 'approved', body }

const review = (text: string) => parseReview(`# Review\n\n${text}`)
const noReview = review('')
const noTasks: TasksState = { exists: false }
const tasks = (...lines: string[]): TasksState => ({ exists: true, ...parseTasks(lines.join('\n')) })

describe('plan stage', () => {
  it('is_missing_without_a_spec', () => {
    expect(planStage({ exists: false }, noReview, noTasks)).toBe('missing')
  })

  it('is_created_while_nothing_has_been_said_about_the_spec', () => {
    expect(planStage(draft, noReview, noTasks)).toBe('created')
  })

  it('is_under_review_while_a_round_is_written_or_unanswered', () => {
    expect(planStage(draft, review('## Round 1 — pending\n- C1 (B1): too vague'), noTasks)).toBe('under_review')
    expect(planStage(draft, review('## Round 1 — submitted 2026-09-14T10:00:00Z\n- C1 (B1): too vague'), noTasks)).toBe(
      'under_review',
    )
  })

  it('is_under_review_while_a_struck_item_still_stands_in_the_spec', () => {
    const struck = review('## Round 1 — submitted 2026-09-14T10:00:00Z\n- struck: B1')
    expect(planStage(draft, struck, noTasks)).toBe('under_review')
    const honoured = review('## Round 1 — submitted 2026-09-14T10:00:00Z\n- struck: B2')
    expect(planStage(draft, honoured, noTasks)).toBe('created')
  })

  it('is_a_final_draft_once_every_comment_is_answered_and_one_is_not_yet_accepted', () => {
    const answered = review('## Round 1 — submitted 2026-09-14T10:00:00Z\n- C1 (B1): too vague\n  - addressed: split it')
    expect(planStage(draft, answered, noTasks)).toBe('final_draft')
    const accepted = review('## Round 1 — submitted 2026-09-14T10:00:00Z\n- C1 (B1): too vague\n  - addressed: split it\n  - accepted')
    expect(planStage(draft, accepted, noTasks)).toBe('created')
  })

  it('is_mapped_once_tasks_exist_until_work_starts', () => {
    expect(planStage(draft, noReview, tasks('- T1: a', '- T2: b'))).toBe('mapped')
    expect(planStage(approved, noReview, tasks('- T1: a', '- T2: b'))).toBe('mapped')
  })

  it('a_review_after_mapping_goes_back_to_under_review', () => {
    expect(planStage(draft, review('## Round 1 — pending\n- C1 (B1): no'), tasks('- T1: a'))).toBe('under_review')
  })

  it('is_under_development_from_the_first_marker_until_every_task_is_tested', () => {
    expect(planStage(approved, noReview, tasks('- T1: a [in progress]', '- T2: b'))).toBe('under_development')
    expect(planStage(approved, noReview, tasks('- T1: a [tested]', '- T2: b [done]'))).toBe('under_development')
    expect(planStage(approved, noReview, tasks('- T1: a [tested]', '- T2: b [blocked: no API]'))).toBe('under_development')
  })

  it('is_in_verification_when_every_task_is_tested_until_the_test_commands_pass', () => {
    expect(planStage(approved, noReview, tasks('- T1: a [tested]'))).toBe('verification')
    const failed = tasks('- T1: a [tested]', '', '## Verification', '- 2026-09-14T10:00:00Z: failed, `npm test` in .')
    expect(planStage(approved, noReview, failed)).toBe('verification')
    const passed = tasks('- T1: a [tested]', '', '## Verification', '- 2026-09-14T10:00:00Z: passed')
    expect(planStage(approved, noReview, passed)).toBe('verified')
  })

  it('a_board_is_stale_once_the_spec_changed_under_it', () => {
    const fresh: TasksState = { exists: true, ...parseTasks(withSpecFingerprint('- T1: a', specFingerprint(parseSpec(body)))) }
    expect(tasksStale(draft, fresh)).toBe(false)
    const revised: SpecState = { ...draft, body: body.replace('can be cancelled', 'can be cancelled until shipped') }
    expect(tasksStale(revised, fresh)).toBe(true)
    // A proposal written into the Findings table is not a change to the plan.
    const withFindings: SpecState = { ...draft, body: `${body}\n## Findings\n| Finding | Proposed solution |\n|---|---|\n| F1 (naive, B1): x | y |\n` }
    expect(tasksStale(withFindings, fresh)).toBe(false)
    expect(tasksStale(draft, noTasks)).toBe(false)
    expect(tasksStale(draft, tasks('- T1: a'))).toBe(false)
  })

  it('approval_is_offered_on_a_mapped_draft_whose_board_is_current', () => {
    const fresh: TasksState = { exists: true, ...parseTasks(withSpecFingerprint('- T1: a', specFingerprint(parseSpec(body)))) }
    const stale: TasksState = { exists: true, ...parseTasks(withSpecFingerprint('- T1: a', 'ffff0000')) }
    expect(isApprovable('mapped', draft, fresh)).toBe(true)
    expect(isApprovable('mapped', draft, stale)).toBe(false)
    expect(isApprovable('mapped', approved, fresh)).toBe(false)
    expect(isApprovable('created', draft, noTasks)).toBe(false)
    expect(isApprovable('final_draft', draft, fresh)).toBe(false)
  })

  it('mapping_is_offered_on_a_created_draft_only_and_runs_by_itself_after_that', () => {
    expect(isMappable('created', draft)).toBe(true)
    expect(isMappable('final_draft', draft)).toBe(false)
    expect(isMappable('mapped', draft)).toBe(false)
    expect(isMappable('under_review', draft)).toBe(false)
    expect(isMappable('created', approved)).toBe(false)
  })
})
