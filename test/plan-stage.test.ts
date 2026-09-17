import { describe, expect, it } from 'vitest'
import { isApprovable, isMappable, planStage, remapDue, tasksStale } from '../src/agent/phases/plan-stage'
import { decisions } from '../src/agent/phases/decisions'
import { parseReview } from '../src/agent/phases/plan-review'
import type { SpecState } from '../src/agent/phases/spec-file'
import { parseSpec, specFingerprint } from '../src/agent/phases/spec-model'
import { parseTasks, withSpecFingerprint, type TasksState } from '../src/agent/phases/tasks-file'

const body =
  '# Order cancellation\n\n## Goal\nOrders can be cancelled.\n\n## Cancelling\n- **Cancel command**: an order can be cancelled\n- **Gone**: a cancelled order is gone [removed]\n'
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
    expect(planStage(draft, review('## Round 1, pending\n- on Cancel command: too vague'), noTasks)).toBe('under_review')
    expect(planStage(draft, review('## Round 1, submitted 2026-09-14T10:00:00Z\n- on Cancel command: too vague'), noTasks)).toBe(
      'under_review',
    )
  })

  it('is_under_review_while_a_struck_item_still_stands_in_the_spec', () => {
    const struck = review('## Round 1, submitted 2026-09-14T10:00:00Z\n- remove: Cancel command')
    expect(planStage(draft, struck, noTasks)).toBe('under_review')
    const honoured = review('## Round 1, submitted 2026-09-14T10:00:00Z\n- remove: Gone')
    expect(planStage(draft, honoured, noTasks)).toBe('created')
  })

  it('is_a_final_draft_once_every_comment_is_answered_and_one_is_not_yet_resolved', () => {
    const answered = review('## Round 1, submitted 2026-09-14T10:00:00Z\n- on Cancel command: too vague\n  - addressed: split it')
    expect(planStage(draft, answered, noTasks)).toBe('final_draft')
    const resolved = review('## Round 1, submitted 2026-09-14T10:00:00Z\n- on Cancel command: too vague\n  - addressed: split it\n  - resolved')
    expect(planStage(draft, resolved, noTasks)).toBe('created')
  })

  it('is_mapped_once_tasks_exist_until_work_starts', () => {
    expect(planStage(draft, noReview, tasks('- **A**: a', '- **B**: b'))).toBe('mapped')
    expect(planStage(approved, noReview, tasks('- **A**: a', '- **B**: b'))).toBe('mapped')
  })

  it('a_review_after_mapping_goes_back_to_under_review', () => {
    expect(planStage(draft, review('## Round 1, pending\n- on Cancel command: no'), tasks('- **A**: a'))).toBe('under_review')
  })

  it('is_under_development_from_the_first_marker_until_every_task_is_tested', () => {
    expect(planStage(approved, noReview, tasks('- **A**: a [in progress]', '- **B**: b'))).toBe('under_development')
    expect(planStage(approved, noReview, tasks('- **A**: a [tested]', '- **B**: b [done]'))).toBe('under_development')
    expect(planStage(approved, noReview, tasks('- **A**: a [tested]', '- **B**: b [blocked: no API]'))).toBe('under_development')
  })

  it('is_in_verification_when_every_task_is_tested_until_the_test_commands_pass', () => {
    expect(planStage(approved, noReview, tasks('- **A**: a [tested]'))).toBe('verification')
    const failed = tasks('- **A**: a [tested]', '', '## Verification', '- 2026-09-14T10:00:00Z: failed, `npm test` in .')
    expect(planStage(approved, noReview, failed)).toBe('verification')
    const passed = tasks('- **A**: a [tested]', '', '## Verification', '- 2026-09-14T10:00:00Z: passed')
    expect(planStage(approved, noReview, passed)).toBe('verified')
  })

  it('a_board_is_stale_once_the_spec_changed_under_it', () => {
    const fresh: TasksState = { exists: true, ...parseTasks(withSpecFingerprint('- **A**: a', specFingerprint(parseSpec(body)))) }
    expect(tasksStale(draft, fresh)).toBe(false)
    const revised: SpecState = { ...draft, body: body.replace('can be cancelled', 'can be cancelled until shipped') }
    expect(tasksStale(revised, fresh)).toBe(true)
    expect(tasksStale(draft, noTasks)).toBe(false)
    expect(tasksStale(draft, tasks('- **A**: a'))).toBe(false)
  })

  it('a_stale_board_is_not_remapped_while_a_ruling_awaits_the_planner', () => {
    const stale: TasksState = { exists: true, ...parseTasks(withSpecFingerprint('- **A**: a', 'ffff0000')) }
    const open = decisions('### X\n- on: Cancel command\n- finding: x\n- proposed: change it\n\n### Y\n- on: Cancel command\n- finding: y')
    expect(remapDue(draft, noReview, stale, open)).toBe(false)
    const ruled = decisions('### X\n- on: Cancel command\n- finding: x\n- proposed: change it\n- ruling: keep')
    expect(remapDue(draft, noReview, stale, ruled)).toBe(false)
  })

  it('applying_the_last_ruling_makes_the_remap_due', () => {
    const stale: TasksState = { exists: true, ...parseTasks(withSpecFingerprint('- **A**: a', 'ffff0000')) }
    const applied = decisions('### X [applied]\n- on: Cancel command\n- finding: x\n- proposed: change it\n- ruling: change it\n\n### Y [withdrawn]\n- finding: y')
    expect(remapDue(draft, noReview, stale, applied)).toBe(true)
    expect(remapDue(draft, noReview, stale, [])).toBe(true)
    // A current board, an unmapped spec or a review in flight is not a re-map.
    const fresh: TasksState = { exists: true, ...parseTasks(withSpecFingerprint('- **A**: a', specFingerprint(parseSpec(body)))) }
    expect(remapDue(draft, noReview, fresh, [])).toBe(false)
    expect(remapDue(draft, noReview, noTasks, [])).toBe(false)
    expect(remapDue(draft, review('## Round 1, pending\n- on Cancel command: no'), stale, [])).toBe(false)
  })

  it('approval_is_offered_on_a_mapped_draft_whose_board_is_current', () => {
    const fresh: TasksState = { exists: true, ...parseTasks(withSpecFingerprint('- **A**: a', specFingerprint(parseSpec(body)))) }
    const stale: TasksState = { exists: true, ...parseTasks(withSpecFingerprint('- **A**: a', 'ffff0000')) }
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
