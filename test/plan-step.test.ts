import { describe, expect, it } from 'vitest'
import { planStep, presentTabs, shownSteps, tabFor, tabLabel } from '../src/chat/webview/plan-step'
import type { CleanupUnit } from '../src/chat/protocol'
import type { Decision } from '../src/agent/phases/decisions'
import type { Task } from '../src/agent/phases/tasks-file'
import type { ReviewRound } from '../src/agent/phases/plan-review'
import { planState as plan } from './plan-state-fixture'

function decision(over: Partial<Decision>): Decision {
  return { title: 'Shipped orders', on: [], finding: 'code', proposals: [], state: 'open', line: 0, end: 0, ...over }
}

function task(state: Task['state'], group?: string): Task {
  return { name: 'Cancel', text: '', delivers: [], ...(group ? { group } : {}), files: [], newFiles: [], foreignFiles: [], context: [], how: '', proves: [], note: '', built: '', state, removed: false }
}

const round = (over: Partial<ReviewRound>): ReviewRound => ({ number: 1, comments: [], strikes: [], ...over })

const unit = (): CleanupUnit => ({ path: 'src/orders/cancel.ts', line: 12, name: 'cancel', kind: 'function', breaches: [{ measure: 'lines', value: 61, limit: 25 }] })

describe('planStep', () => {
  it('a_spec_not_yet_written_waits_on_the_planner', () => {
    const { body: _body, spec: _spec, ...bare } = plan()
    const step = planStep({ ...bare, status: 'missing', stage: 'missing', commentable: false })
    expect(step.current).toBe('plan')
    expect(step.next).toMatchObject({ kind: 'waiting' })
  })

  it('a_verified_spec_whose_working_files_are_swept_is_done_and_opens_on_the_spec', () => {
    const swept = plan({ status: 'verified', stage: 'verified', tasks: [], commentable: false })
    const step = planStep(swept)
    expect(step.next).toMatchObject({ kind: 'done' })
    expect(tabFor(step.current, swept)).toBe('spec')
  })

  it('a_draft_with_no_comment_open_offers_approve', () => {
    const step = planStep(plan({ approvable: true }))
    expect(step.current).toBe('approve')
    expect(step.next).toMatchObject({ kind: 'action', action: 'approve' })
  })

  it('a_pending_round_offers_submit_with_its_count', () => {
    const step = planStep(plan({ stage: 'under_review', review: { rounds: [round({ comments: [{ target: 'Cancel', text: 'no' }], strikes: ['Refund'] })] } }))
    expect(step.next).toMatchObject({ kind: 'action', action: 'submit_review', label: 'Submit review (2)' })
  })

  it('an_empty_pending_round_is_not_a_review', () => {
    const step = planStep(plan({ approvable: true, review: { rounds: [round({})] } }))
    expect(step.next).toMatchObject({ kind: 'action', action: 'approve' })
  })

  it('a_submitted_round_waits_on_the_planner', () => {
    const step = planStep(plan({ stage: 'under_review', review: { rounds: [round({ submittedAt: 't', comments: [{ target: 'Cancel', text: 'no' }] })] } }))
    expect(step.current).toBe('review')
    expect(step.next).toEqual({ kind: 'waiting', text: 'the planner is answering 1 comment' })
  })

  it('final_draft_points_at_the_answers_to_read', () => {
    const answered = { target: 'Cancel', text: 'no', resolution: { kind: 'addressed' as const, text: 'fixed' } }
    const step = planStep(plan({ stage: 'final_draft', review: { rounds: [round({ submittedAt: 't', comments: [answered, answered] })] } }))
    expect(step.next).toMatchObject({ kind: 'goto', tab: 'review', label: '2 answers to read' })
  })

  it('a_live_check_shows_its_progress_under_approve', () => {
    const step = planStep(plan({ stage: 'checking', status: 'approved', commentable: false, check: { live: true, text: 'reading src/orders' } }))
    expect(step.current).toBe('approve')
    expect(step.next).toEqual({ kind: 'waiting', text: 'reading src/orders' })
  })

  it('a_decision_without_a_proposal_waits_on_the_planner', () => {
    const step = planStep(plan({ stage: 'ruling', status: 'approved', decisions: [decision({})], pendingDecisions: 1 }))
    expect(step.current).toBe('rule')
    expect(step.next).toEqual({ kind: 'waiting', text: 'the planner is proposing on 1 decision' })
  })

  it('an_open_decision_links_to_the_wizard_and_send_rulings_waits_for_every_ruling', () => {
    const open = decision({ proposals: ['drop it', 'narrow it'] })
    const ruled = decision({ title: 'Refund', proposals: ['queue it'], state: 'ruled', ruling: 'keep' })
    const step = planStep(plan({ stage: 'ruling', status: 'approved', decisions: [open, ruled], pendingDecisions: 2 }))
    expect(step.current).toBe('rule')
    expect(step.next).toMatchObject({ kind: 'goto', tab: 'decisions', label: '1 to rule on' })
    const allRuled = planStep(plan({ stage: 'ruling', status: 'approved', decisions: [{ ...open, state: 'ruled', ruling: 'drop it' }, ruled], pendingDecisions: 2 }))
    expect(allRuled.next).toMatchObject({ kind: 'action', action: 'send_rulings', label: 'Send rulings (2)' })
    expect(allRuled.goto).toBeUndefined()
  })

  it('rulings_with_the_planner_wait', () => {
    const step = planStep(plan({ stage: 'ruling', status: 'approved', pendingDecisions: 2, applyingRulings: true }))
    expect(step.next).toEqual({ kind: 'waiting', text: 'the planner is applying 2 rulings' })
  })

  it('a_draft_an_earlier_mapping_left_decisions_on_is_ruled_before_it_is_approved', () => {
    const step = planStep(plan({ approvable: true, decisions: [decision({ proposals: ['drop it'] })], pendingDecisions: 1 }))
    expect(step.current).toBe('rule')
    expect(step.next).toMatchObject({ kind: 'goto', tab: 'decisions' })
  })

  it('an_approved_plan_offers_implement_only_while_nothing_is_building_the_tasks', () => {
    const derived = { stage: 'under_development' as const, status: 'approved' as const, commentable: false, tasks: [task('open')] }
    expect(planStep(plan({ ...derived, implementable: true })).next).toMatchObject({ action: 'implement', label: 'Implement' })
    expect(planStep(plan(derived)).next).toEqual({ kind: 'waiting', text: '0 of 1 tested' })
  })

  it('right_after_the_clean_check_the_planner_lists_what_the_docs_should_say_and_the_implementation_follows_it', () => {
    const step = planStep(plan({ stage: 'under_development', status: 'approved', commentable: false, reviewingDocs: true, tasks: [task('open')] }))
    expect(step.current).toBe('approve')
    expect(step.next).toEqual({ kind: 'waiting', text: 'the planner is listing what the docs should now say; the implementation starts after it' })
  })

  it('under_development_reports_progress_and_blocks', () => {
    const step = planStep(plan({ stage: 'under_development', status: 'approved', commentable: false, tasks: [task('tested'), task('blocked'), task('open')] }))
    expect(step.current).toBe('implement')
    expect(step.next).toEqual({ kind: 'waiting', text: '1 of 3 tested, 1 blocked' })
  })

  it('under_development_names_the_scenario_being_implemented', () => {
    const grouped = plan({ stage: 'under_development', status: 'approved', commentable: false, tasks: [task('tested', 'Foundation'), task('in_progress', 'Cancelling an order'), task('open', 'Reporting')] })
    expect(planStep(grouped).next).toEqual({ kind: 'waiting', text: 'Cancelling an order, 1 of 3 tested' })
    // A flat board has only the task's name to say where the work is.
    const flat = plan({ stage: 'under_development', status: 'approved', commentable: false, tasks: [task('in_progress'), task('open')] })
    expect(planStep(flat).next).toEqual({ kind: 'waiting', text: 'Cancel, 0 of 2 tested' })
  })

  it('verification_offers_verify_again_once_a_run_is_recorded', () => {
    const base = { stage: 'verification' as const, status: 'approved' as const, commentable: false, verifiable: true, atWork: false }
    expect(planStep(plan(base)).next).toMatchObject({ action: 'verify', label: 'Verify' })
    expect(planStep(plan({ ...base, lastVerification: { at: 't', ok: false, text: 'failed' } })).next).toMatchObject({ label: 'Verify again' })
  })

  it('failed_tests_handed_to_the_implementer_wait_on_the_fix_instead_of_offering_verify_again', () => {
    const fixing = plan({ stage: 'verification', status: 'approved', commentable: false, verifiable: true, atWork: true, lastVerification: { at: 't', ok: false, text: 'failed' } })
    const step = planStep(fixing)
    expect(step.next).toEqual({ kind: 'waiting', text: 'the implementer is fixing the failed tests' })
    expect(step.yours).toBe(false)
  })

  it('verify_only_when_tests_run_the_step_is_hidden_and_the_empty_run_ends_implement', () => {
    const none = plan({ stage: 'verification', status: 'approved', commentable: false, verifies: false, verification: { live: true, text: 'Running the tests…' } })
    expect(shownSteps(none)).not.toContain('verify')
    expect(shownSteps(plan({ verifies: true }))).toContain('verify')
    expect(planStep(none).current).toBe('implement')
  })

  it('still_blocked_waits_for_the_developer_the_bar_points_at_the_blocked_tasks', () => {
    const blocked = { ...task('blocked'), name: 'Refund', blockedReason: 'no e2e setup' }
    const stuck = plan({ stage: 'under_development', status: 'approved', commentable: false, atWork: false, implementable: true, tasks: [task('tested'), blocked] })
    const step = planStep(stuck)
    expect(step.current).toBe('implement')
    expect(step.next).toMatchObject({ kind: 'goto', tab: 'tasks', label: '1 task still blocked' })
    expect(step.yours).toBe(true)
    // While the build looks at it again, it is not the developer's yet.
    expect(planStep(plan({ ...stuck, atWork: true })).next).toMatchObject({ kind: 'waiting' })
    // Another task still to build keeps the build going.
    expect(planStep(plan({ ...stuck, tasks: [task('open'), blocked] })).next).not.toMatchObject({ tab: 'tasks' })
  })

  it('a_verified_feature_stands_at_the_cleanup_step', () => {
    const verified = { stage: 'verified' as const, status: 'approved' as const, commentable: false }
    const step = planStep(plan(verified))
    expect(step.current).toBe('cleanup')
    // Nothing measured yet in this window: the sizes can be checked, and nothing is claimed about them.
    expect(step.next).toMatchObject({ kind: 'action', action: 'sweep' })
    expect(planStep(plan({ ...verified, cleanupSweep: { units: [] } })).next).toEqual({ kind: 'done', text: 'verified' })
  })

  it('units_over_the_limit_are_offered_at_the_cleanup_step_and_never_split_on_their_own', () => {
    const verified = { stage: 'verified' as const, status: 'approved' as const, commentable: false }
    const sweep = { units: [unit(), { ...unit(), name: 'LasAsync' }] }
    const offered = planStep(plan({ ...verified, cleanupSweep: sweep }))
    expect(offered.current).toBe('cleanup')
    expect(offered.next).toMatchObject({ kind: 'goto', tab: 'cleanup', label: '2 units over the limit' })

    const postponed = planStep(plan({ ...verified, cleanupSweep: sweep, cleanupDecision: 'postponed' }))
    expect(postponed.next).toMatchObject({ kind: 'goto', tab: 'cleanup', label: 'Cleanup postponed (2)' })

    // Skipped and done are answers: the offer is not put again.
    expect(planStep(plan({ ...verified, cleanupSweep: sweep, cleanupDecision: 'skipped' })).next).toEqual({ kind: 'done', text: 'cleanup skipped' })
    expect(planStep(plan({ ...verified, cleanupSweep: sweep, cleanupDecision: 'done' })).next).toEqual({ kind: 'done', text: 'verified' })
  })

  it('a_cleanup_run_in_flight_says_what_it_is_doing', () => {
    const step = planStep(plan({ stage: 'verified', status: 'approved', commentable: false, cleanup: { live: true, text: 'Read src/a.ts' } }))
    expect(step.current).toBe('cleanup')
    expect(step.next).toEqual({ kind: 'waiting', text: 'Read src/a.ts' })
  })

  it('review_stays_reachable_on_a_draft_ready_to_approve', () => {
    expect(planStep(plan({ approvable: true })).reached).toContain('review')
  })

  it('after_approval_only_passed_steps_are_reached_and_rule_only_when_the_check_found_something', () => {
    const building = { stage: 'under_development' as const, status: 'approved' as const, commentable: false, tasks: [task('done')] }
    expect(planStep(plan(building)).reached).toEqual(['plan', 'review', 'approve', 'implement'])
    const ruled = decision({ state: 'applied', ruling: 'keep' })
    expect(planStep(plan({ ...building, decisions: [ruled] })).reached).toEqual(['plan', 'review', 'approve', 'rule', 'implement'])
    expect(shownSteps(plan(building))).not.toContain('rule')
  })
})

describe('whose turn it is', () => {
  const building = { stage: 'under_development' as const, status: 'approved' as const, commentable: false, tasks: [task('tested'), task('open')] }

  it('a_question_in_a_run_takes_the_bar_and_points_at_the_chat', () => {
    const step = planStep(plan({ ...building, blocked: { on: 'answer', mode: 'implement' } }))
    expect(step.current).toBe('implement')
    expect(step.next).toMatchObject({ kind: 'goto', tab: 'chat', label: 'Question from the implementer' })
    expect(step.yours).toBe(true)
  })

  it('a_permission_prompt_points_at_the_chat_over_any_other_act', () => {
    const open = decision({ proposals: ['drop it'] })
    const step = planStep(plan({ stage: 'ruling', status: 'approved', decisions: [open], pendingDecisions: 1, blocked: { on: 'approval', mode: 'plan' } }))
    expect(step.next).toMatchObject({ kind: 'goto', tab: 'chat', label: 'Allow or deny: the planner' })
    expect(step.goto).toBeUndefined()
  })

  it('an_implementer_that_stopped_with_tasks_left_offers_to_carry_on', () => {
    const step = planStep(plan({ ...building, atWork: false, implementable: true }))
    expect(step.next).toMatchObject({ kind: 'action', action: 'implement', label: 'Continue implementing' })
    expect(step.goto).toMatchObject({ tab: 'chat' })
    expect(step.yours).toBe(true)
  })

  it('an_implementer_whose_turn_failed_offers_to_try_again_and_says_why', () => {
    const step = planStep(plan({ ...building, atWork: false, implementable: true, failure: { mode: 'implement', message: 'API error 401: invalid_token' } }))
    expect(step.next).toMatchObject({ kind: 'action', action: 'implement', label: 'Try again' })
    expect(step.next.kind === 'action' && step.next.hint).toContain('API error 401: invalid_token')
  })

  it('a_run_that_stopped_with_nothing_to_restart_it_points_at_the_chat', () => {
    const { body: _body, spec: _spec, ...bare } = plan()
    const writing = planStep({ ...bare, status: 'missing', stage: 'missing', commentable: false, atWork: false })
    expect(writing.next).toMatchObject({ kind: 'goto', tab: 'chat', label: 'The planner stopped' })
    const answering = planStep(plan({ stage: 'under_review', atWork: false, review: { rounds: [round({ submittedAt: 't', comments: [{ target: 'Cancel', text: 'no' }] })] } }))
    expect(answering.next).toMatchObject({ kind: 'goto', tab: 'chat', label: 'The planner stopped' })
    expect(answering.yours).toBe(true)
  })

  it('a_check_that_failed_or_was_stopped_offers_to_check_again', () => {
    const idle = { stage: 'checking' as const, status: 'approved' as const, commentable: false, atWork: false }
    expect(planStep(plan({ ...idle, checkable: true })).next).toMatchObject({ kind: 'action', action: 'check', label: 'Check again' })
  })

  it('a_step_at_work_is_the_agents_and_an_act_is_yours', () => {
    expect(planStep(plan({ stage: 'checking', status: 'approved', check: { live: true, text: 'reading src' } })).yours).toBe(false)
    expect(planStep(plan(building)).yours).toBe(false)
    expect(planStep(plan({ approvable: true })).yours).toBe(true)
  })

  it('passed_tests_complete_the_plan_and_the_cleanup_offer_does_not_hold_it', () => {
    const verified = { stage: 'verified' as const, status: 'approved' as const, commentable: false, atWork: false }
    const offered = planStep(plan({ ...verified, cleanupSweep: { units: [unit()] } }))
    expect(offered).toMatchObject({ complete: true, yours: false, next: { kind: 'goto', tab: 'cleanup' } })
    expect(planStep(plan({ ...verified, cleanupSweep: { units: [unit()] }, cleanupDecision: 'postponed' })).complete).toBe(true)
    expect(planStep(plan({ stage: 'verification', status: 'approved', commentable: false, atWork: false })).complete).toBe(false)
  })
})

describe('tabFor', () => {
  it('review_opens_the_spec_until_a_round_exists', () => {
    expect(tabFor('review', plan())).toBe('spec')
    expect(tabFor('review', plan({ review: { rounds: [round({})] } }))).toBe('review')
  })

  it('each_step_opens_the_tab_it_works_in', () => {
    const mapped = plan({ tasks: [task('open')] })
    expect(tabFor('rule', mapped)).toBe('decisions')
    expect(tabFor('approve', mapped)).toBe('spec')
    expect(tabFor('implement', mapped)).toBe('tasks')
  })
})

describe('tabs', () => {
  it('a_tab_is_present_once_it_has_content', () => {
    expect(presentTabs(plan())).toEqual(['spec'])
    const full = plan({
      decisions: [decision({ proposals: ['p'] }), decision({ title: 'Refund', state: 'ruled', ruling: 'keep' })],
      review: { rounds: [round({ submittedAt: 't', comments: [{ target: 'Cancel', text: 'no' }] })] },
      tasks: [task('open')],
    })
    expect(presentTabs(full)).toEqual(['spec', 'review', 'decisions', 'tasks'])
    // The decisions count is what is left to rule on.
    expect(presentTabs(full).map((t) => tabLabel(t, full))).toEqual(['Spec', 'Review (1)', 'Decisions (1)', 'Tasks (1)'])
  })

  it('the_cleanup_tab_appears_with_the_sweep_and_counts_the_units_on_offer', () => {
    const verified = { stage: 'verified' as const, status: 'approved' as const, commentable: false, tasks: [task('tested')] }
    expect(presentTabs(plan(verified))).not.toContain('cleanup')
    const offered = plan({ ...verified, cleanupSweep: { units: [unit(), unit()] } })
    expect(tabLabel('cleanup', offered)).toBe('Cleanup (2)')
    expect(tabFor('cleanup', offered)).toBe('cleanup')
    const skipped = plan({ ...verified, cleanupSweep: { units: [unit()] }, cleanupDecision: 'skipped' })
    expect(presentTabs(skipped)).toContain('cleanup')
    expect(tabLabel('cleanup', skipped)).toBe('Cleanup')
  })

  it('the_tasks_tab_counts_tested_once_work_has_started', () => {
    expect(tabLabel('tasks', plan({ tasks: [task('tested'), task('in_progress'), task('open')] }))).toBe('Tasks (1 of 3)')
  })
})
