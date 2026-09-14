import { describe, expect, it } from 'vitest'
import { isApprovable, isMappable, planStage } from '../src/agent/phases/plan-stage'
import { parseReview } from '../src/agent/phases/plan-review'
import type { SpecState } from '../src/agent/phases/spec-file'
import { parseTasks, type TasksState } from '../src/agent/phases/tasks-file'

const body = '# Order cancellation\n\n## Behaviour\n- B1: an order can be cancelled\n- B2: a cancelled order is gone [removed]\n'
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

  it('approval_is_offered_on_a_mapped_draft_only', () => {
    expect(isApprovable('mapped', draft)).toBe(true)
    expect(isApprovable('mapped', approved)).toBe(false)
    expect(isApprovable('created', draft)).toBe(false)
    expect(isApprovable('final_draft', draft)).toBe(false)
  })

  it('mapping_is_offered_on_a_draft_with_no_review_in_flight', () => {
    expect(isMappable('created', draft)).toBe(true)
    expect(isMappable('final_draft', draft)).toBe(true)
    expect(isMappable('mapped', draft)).toBe(true)
    expect(isMappable('under_review', draft)).toBe(false)
    expect(isMappable('mapped', approved)).toBe(false)
  })
})
