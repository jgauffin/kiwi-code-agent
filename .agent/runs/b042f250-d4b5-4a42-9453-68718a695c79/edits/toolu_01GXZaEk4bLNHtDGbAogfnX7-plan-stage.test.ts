import { describe, expect, it } from 'vitest'
import { checkDue, isApprovable, planStage, tasksStale } from '../src/agent/phases/plan-stage'
import { decisions } from '../src/agent/phases/decisions'
import { parseReview } from '../src/agent/phases/plan-review'
import type { SpecState } from '../src/agent/phases/spec-file'
import { parseSpec, specFingerprint } from '../src/agent/phases/spec-model'
import { stateOfBoard, withSpecFingerprint, type TasksState } from '../src/agent/phases/tasks-file'
import { board, task, tasksState } from './task-board-fixture'

const body =
  '# Order cancellation\n\n## Goal\nOrders can be cancelled.\n\n## Cancelling\n- **Cancel command**: an order can be cancelled\n- **Gone**: a cancelled order is gone [removed]\n'
const draft: SpecState = { exists: true, status: 'draft', body }
const approved: SpecState = { exists: true, status: 'approved', body }

const review = (text: string) => parseReview(`# Review\n\n${text}`)
const noReview = review('')
const noTasks: TasksState = { exists: false }
const tested = task('A', { state: 'tested' })
const mappedFrom = (fingerprint: string): TasksState => stateOfBoard(withSpecFingerprint(board(task('A')), fingerprint))

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

  it('an_approved_spec_without_a_board_is_being_checked_or_ruled_on', () => {
    expect(planStage(approved, noReview, noTasks)).toBe('checking')
    const open = decisions('### X\n- on: Cancel command\n- finding: x')
    expect(planStage(approved, noReview, noTasks, open)).toBe('ruling')
    const applied = decisions('### X [applied]\n- on: Cancel command\n- finding: x\n- ruling: keep')
    expect(planStage(approved, noReview, noTasks, applied)).toBe('checking')
  })

  it('a_draft_stays_a_draft_whatever_board_an_earlier_mapping_left', () => {
    expect(planStage(draft, noReview, tasksState(task('A')))).toBe('created')
    expect(planStage(draft, review('## Round 1, pending\n- on Cancel command: no'), tasksState(task('A')))).toBe('under_review')
  })

  it('is_under_development_from_the_derived_board_until_every_task_is_tested', () => {
    expect(planStage(approved, noReview, tasksState(task('A'), task('B')))).toBe('under_development')
    expect(planStage(approved, noReview, tasksState(task('A', { state: 'in_progress' }), task('B')))).toBe('under_development')
    expect(planStage(approved, noReview, tasksState(tested, task('B', { state: 'done' })))).toBe('under_development')
    expect(planStage(approved, noReview, tasksState(tested, task('B', { state: 'blocked', blockedReason: 'no API' })))).toBe('under_development')
  })

  it('is_in_verification_when_every_task_is_tested_until_the_test_commands_pass', () => {
    expect(planStage(approved, noReview, tasksState(tested))).toBe('verification')
    const failed = stateOfBoard({ tasks: [tested], verification: [{ at: '2026-09-14T10:00:00Z', ok: false, text: '`npm test` in .' }] })
    expect(planStage(approved, noReview, failed)).toBe('verification')
    const passed = stateOfBoard({ tasks: [tested], verification: [{ at: '2026-09-14T10:00:00Z', ok: true, text: '' }] })
    expect(planStage(approved, noReview, passed)).toBe('verified')
  })

  it('an_implemented_spec_is_verified_without_a_board_or_a_review', () => {
    const implemented: SpecState = { exists: true, status: 'implemented', body }
    expect(planStage(implemented, noReview, noTasks)).toBe('verified')
  })

  it('a_board_is_stale_once_the_spec_changed_under_it', () => {
    const fresh: TasksState = mappedFrom(specFingerprint(parseSpec(body)))
    expect(tasksStale(draft, fresh)).toBe(false)
    const revised: SpecState = { ...draft, body: body.replace('can be cancelled', 'can be cancelled until shipped') }
    expect(tasksStale(revised, fresh)).toBe(true)
    expect(tasksStale(draft, noTasks)).toBe(false)
    expect(tasksStale(draft, tasksState(task('A')))).toBe(false)
  })

  it('the_check_waits_while_a_decision_awaits_the_person_or_the_planner', () => {
    const open = decisions('### X\n- on: Cancel command\n- finding: x\n- proposed: change it\n\n### Y\n- on: Cancel command\n- finding: y')
    expect(checkDue(approved, noTasks, open)).toBe(false)
    const ruled = decisions('### X\n- on: Cancel command\n- finding: x\n- proposed: change it\n- ruling: keep')
    expect(checkDue(approved, noTasks, ruled)).toBe(false)
  })

  it('an_approved_spec_without_a_current_board_is_checked_once_every_decision_is_applied', () => {
    const applied = decisions('### X [applied]\n- on: Cancel command\n- finding: x\n- ruling: change it\n\n### Y [withdrawn]\n- finding: y')
    expect(checkDue(approved, noTasks, applied)).toBe(true)
    expect(checkDue(approved, mappedFrom('ffff0000'), [])).toBe(true)
    // A current board, or a spec not yet approved, is not checked.
    expect(checkDue(approved, mappedFrom(specFingerprint(parseSpec(body))), [])).toBe(false)
    expect(checkDue(draft, noTasks, [])).toBe(false)
  })

  it('approval_is_offered_on_a_draft_with_no_comment_open', () => {
    expect(isApprovable('created', draft)).toBe(true)
    expect(isApprovable('final_draft', draft)).toBe(false)
    expect(isApprovable('under_review', draft)).toBe(false)
    expect(isApprovable('checking', approved)).toBe(false)
  })
})
