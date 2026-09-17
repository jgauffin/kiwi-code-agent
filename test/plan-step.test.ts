import { describe, expect, it } from 'vitest'
import { planStep, presentTabs, tabFor, tabLabel } from '../src/chat/webview/plan-step'
import type { PlanState } from '../src/chat/protocol'
import type { Decision } from '../src/agent/phases/decisions'
import type { Task } from '../src/agent/phases/tasks-file'
import type { ReviewRound } from '../src/agent/phases/plan-review'

function plan(over: Partial<PlanState> = {}): PlanState {
  return {
    specPath: 'plan/orders.spec.md',
    tasksPath: 'plan/orders.tasks.md',
    stage: 'created',
    status: 'draft',
    body: '# Orders',
    spec: { title: 'Orders', goal: '', scenarios: [], questions: [], decisions: [], problems: [] },
    stale: false,
    repairable: false,
    mappable: true,
    implementable: false,
    verifiable: false,
    tasks: [],
    review: { rounds: [] },
    commentable: true,
    approvable: false,
    pendingDecisions: 0,
    applyingRulings: false,
    ...over,
  }
}

function decision(over: Partial<Decision>): Decision {
  return { title: 'Shipped orders', on: [], finding: 'code', proposal: '', state: 'open', line: 0, end: 0, ...over }
}

function task(state: Task['state'], group?: string): Task {
  return { name: 'Cancel', text: '', delivers: [], ...(group ? { group } : {}), files: [], context: [], how: '', proves: [], state, removed: false }
}

const round = (over: Partial<ReviewRound>): ReviewRound => ({ number: 1, comments: [], strikes: [], ...over })

describe('planStep', () => {
  it('a_spec_not_yet_written_waits_on_the_planner', () => {
    const { body: _body, spec: _spec, ...bare } = plan()
    const step = planStep({ ...bare, status: 'missing', stage: 'missing', commentable: false })
    expect(step.current).toBe('plan')
    expect(step.next).toMatchObject({ kind: 'waiting' })
  })

  it('an_uncommented_spec_offers_mapping_from_the_review_step', () => {
    const step = planStep(plan())
    expect(step.current).toBe('review')
    expect(step.next).toMatchObject({ kind: 'action', action: 'map' })
  })

  it('a_pending_round_offers_submit_with_its_count', () => {
    const step = planStep(plan({ stage: 'under_review', review: { rounds: [round({ comments: [{ target: 'Cancel', text: 'no' }], strikes: ['Refund'] })] } }))
    expect(step.next).toMatchObject({ kind: 'action', action: 'submit_review', label: 'Submit review (2)' })
  })

  it('an_empty_pending_round_is_not_a_review', () => {
    const step = planStep(plan({ review: { rounds: [round({})] } }))
    expect(step.next).toMatchObject({ kind: 'action', action: 'map' })
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

  it('a_live_mapping_shows_its_progress', () => {
    const step = planStep(plan({ mapping: { live: true, text: 'reading src/orders' } }))
    expect(step.current).toBe('map')
    expect(step.next).toEqual({ kind: 'waiting', text: 'reading src/orders' })
  })

  it('a_decision_without_a_proposal_waits_on_the_planner', () => {
    const spec = { ...plan().spec!, decisions: [decision({})] }
    const step = planStep(plan({ stage: 'mapped', spec, pendingDecisions: 1 }))
    expect(step.current).toBe('rule')
    expect(step.next).toEqual({ kind: 'waiting', text: 'the planner is proposing on 1 decision' })
  })

  it('pending_decisions_offer_send_rulings_not_approve', () => {
    const spec = { ...plan().spec!, decisions: [decision({ proposal: 'drop it' }), decision({ title: 'Refund', proposal: 'keep', state: 'ruled', ruling: 'accepted' })] }
    const step = planStep(plan({ stage: 'mapped', spec, pendingDecisions: 2 }))
    expect(step.current).toBe('rule')
    expect(step.next).toMatchObject({ kind: 'action', action: 'send_rulings', label: 'Send rulings (2)' })
    expect(step.goto).toEqual({ tab: 'decisions', label: '1 to rule on' })
  })

  it('rulings_with_the_planner_wait', () => {
    const step = planStep(plan({ stage: 'mapped', pendingDecisions: 2, applyingRulings: true }))
    expect(step.next).toEqual({ kind: 'waiting', text: 'the planner is applying 2 rulings' })
  })

  it('a_stale_board_waits_for_the_re_map', () => {
    const step = planStep(plan({ stage: 'mapped', stale: true }))
    expect(step.current).toBe('map')
    expect(step.next).toMatchObject({ kind: 'waiting' })
  })

  it('a_clean_mapped_draft_offers_approve', () => {
    const step = planStep(plan({ stage: 'mapped', approvable: true }))
    expect(step.current).toBe('approve')
    expect(step.next).toMatchObject({ kind: 'action', action: 'approve' })
  })

  it('an_approved_plan_offers_implement_from_the_plan_session', () => {
    expect(planStep(plan({ stage: 'mapped', status: 'approved', commentable: false, implementable: true })).next).toMatchObject({ action: 'implement' })
    expect(planStep(plan({ stage: 'mapped', status: 'approved', commentable: false })).next).toMatchObject({ kind: 'waiting' })
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
    const base = { stage: 'verification' as const, status: 'approved' as const, commentable: false, verifiable: true }
    expect(planStep(plan(base)).next).toMatchObject({ action: 'verify', label: 'Verify' })
    expect(planStep(plan({ ...base, lastVerification: { at: 't', ok: false, text: 'failed' } })).next).toMatchObject({ label: 'Verify again' })
  })

  it('verified_with_amendments_offers_update_intent', () => {
    const intent = { path: 'plan/orders.intent.md', pending: 2, applied: 0, applicable: true, amendments: [] }
    const step = planStep(plan({ stage: 'verified', status: 'approved', commentable: false, intent }))
    expect(step.current).toBe('intent')
    expect(step.next).toMatchObject({ action: 'update_intent', label: 'Update intent (2)' })
  })

  it('verified_without_amendments_is_done', () => {
    expect(planStep(plan({ stage: 'verified', status: 'approved', commentable: false })).next).toEqual({ kind: 'done', text: 'verified' })
  })

  it('review_stays_reachable_on_a_mapped_draft', () => {
    expect(planStep(plan({ stage: 'mapped', approvable: true })).reached).toContain('review')
  })

  it('after_approval_only_passed_steps_are_reached', () => {
    const reached = planStep(plan({ stage: 'under_development', status: 'approved', commentable: false, tasks: [task('done')] })).reached
    expect(reached).toEqual(['plan', 'review', 'map', 'rule', 'approve', 'implement'])
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
    expect(tabFor('map', mapped)).toBe('tasks')
    expect(tabFor('approve', mapped)).toBe('spec')
    expect(tabFor('implement', mapped)).toBe('tasks')
  })
})

describe('tabs', () => {
  it('a_tab_is_present_once_it_has_content', () => {
    expect(presentTabs(plan())).toEqual(['spec'])
    const spec = { ...plan().spec!, decisions: [decision({ proposal: 'p' })] }
    const full = plan({
      spec,
      review: { rounds: [round({ submittedAt: 't', comments: [{ target: 'Cancel', text: 'no' }] })] },
      tasks: [task('open')],
      intent: { path: 'p', pending: 1, applied: 0, applicable: false, amendments: [] },
    })
    expect(presentTabs(full)).toEqual(['spec', 'review', 'decisions', 'tasks', 'intent'])
    expect(presentTabs(full).map((t) => tabLabel(t, full))).toEqual(['Spec', 'Review (1)', 'Decisions (1)', 'Tasks (1)', 'Intent (1)'])
  })

  it('the_tasks_tab_counts_tested_once_work_has_started', () => {
    expect(tabLabel('tasks', plan({ tasks: [task('tested'), task('in_progress'), task('open')] }))).toBe('Tasks (1 of 3)')
  })
})
