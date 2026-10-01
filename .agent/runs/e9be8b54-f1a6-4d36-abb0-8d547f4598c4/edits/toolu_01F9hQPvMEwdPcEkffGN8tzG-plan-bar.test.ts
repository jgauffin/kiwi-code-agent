// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PlanState } from '../src/chat/protocol'
import type { Decision } from '../src/agent/phases/decisions'
import { planState as plan } from './plan-state-fixture'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { PlanBar } = await import('../src/chat/webview/plan-bar')
const { PlanTabs } = await import('../src/chat/webview/plan-tabs')
const events = await import('../src/chat/webview/events')

const decision = (over: Partial<Decision>): Decision => ({ title: 'Shipped orders', on: [], finding: 'code', proposals: ['drop'], state: 'open', line: 0, end: 0, ...over })

function bar(state: PlanState): InstanceType<typeof PlanBar> {
  const node = new PlanBar()
  document.body.appendChild(node)
  node.update(state)
  return node
}

const next = (node: HTMLElement) => node.querySelector<HTMLElement>('.next')
const dispatched = (node: HTMLElement, type: string, act: () => void): boolean => {
  let seen = false
  node.addEventListener(type, () => (seen = true))
  act()
  return seen
}

describe('PlanBar next step', () => {
  it('a_bar_action_is_a_button_that_dispatches_its_event', () => {
    const node = bar(plan({ approvable: true }))
    const slot = next(node)!
    expect(slot.tagName).toBe('BUTTON')
    expect(slot.textContent).toBe('Approve')
    expect(dispatched(node, events.SpecApprovedEvent.type, () => slot.click())).toBe(true)
  })

  it('submit_review_and_send_rulings_are_bar_buttons', () => {
    const submit = bar(plan({ stage: 'under_review', review: { rounds: [{ number: 1, comments: [{ target: 'Cancel', text: 'no' }], strikes: [] }] } }))
    expect(next(submit)!.textContent).toBe('Submit review (1)')
    expect(dispatched(submit, events.ReviewSubmittedEvent.type, () => next(submit)!.click())).toBe(true)

    const rulings = bar(plan({ stage: 'ruling', status: 'approved', decisions: [decision({ state: 'ruled', ruling: 'drop' })], pendingDecisions: 1 }))
    const button = rulings.querySelector<HTMLElement>('.next.send_rulings')!
    expect(button.textContent).toBe('Send rulings (1)')
    expect(dispatched(rulings, events.RulingsSentEvent.type, () => button.click())).toBe(true)
    expect(rulings.querySelector('.next.approve')).toBeNull()
  })

  it('an_act_on_a_row_is_a_link_that_asks_the_view_to_open_the_tab', () => {
    const answered = { target: 'Cancel', text: 'no', resolution: { kind: 'addressed' as const, text: 'ok' } }
    const node = bar(plan({ stage: 'final_draft', review: { rounds: [{ number: 1, submittedAt: 't', comments: [answered], strikes: [] }] } }))
    const link = node.querySelector<HTMLElement>('.next.goto')!
    expect(link.textContent).toContain('1 answer to read')
    let tab: string | undefined
    node.addEventListener(events.PlanFocusRequestedEvent.type, (e) => (tab = (e as InstanceType<typeof events.PlanFocusRequestedEvent>).tab))
    link.click()
    expect(tab).toBe('review')
  })

  it('an_open_decision_links_to_the_wizard_instead_of_offering_send_rulings', () => {
    const node = bar(plan({ stage: 'ruling', status: 'approved', decisions: [decision({}), decision({ title: 'Refund', state: 'ruled', ruling: 'keep' })], pendingDecisions: 2 }))
    expect(node.querySelector('.next.goto')!.textContent).toContain('1 to rule on')
    expect(node.querySelector('.next.send_rulings')).toBeNull()
  })

  it('waiting_is_text_and_yields_to_a_running_line', () => {
    const waiting = bar(plan({ stage: 'ruling', status: 'approved', pendingDecisions: 1, applyingRulings: true }))
    expect(next(waiting)!.tagName).toBe('SPAN')
    expect(next(waiting)!.textContent).toContain('applying 1 ruling')

    const running = bar(plan({ stage: 'checking', status: 'approved', check: { live: true, text: 'reading src' } }))
    expect(running.querySelector('.next.waiting')).toBeNull()
    expect(running.querySelector('.running')!.textContent).toBe('reading src')
    expect(running.querySelector('.stop')).not.toBeNull()
  })

  it('a_cleanup_line_says_which_run_is_reading', () => {
    const node = bar(plan({ stage: 'verified', status: 'approved', commentable: false, cleanup: { live: true, text: 'Read src/a.ts' } }))
    expect(node.querySelector('.running')!.textContent).toBe('Cleanup · Read src/a.ts')
    expect(node.querySelector('.stop')).not.toBeNull()
  })

  it('the_last_run_outcome_stays_beside_the_steps_until_the_stage_moves_on', () => {
    const node = bar(plan({ stage: 'under_development', status: 'approved', check: { live: false, text: 'Checked: the code is clear' } }))
    expect(node.querySelector('.ran')!.textContent).toBe('Checked: the code is clear')
    expect(node.querySelector('.running')).toBeNull()
  })

  it('a_run_that_failed_says_so_beside_the_steps_with_the_reason', () => {
    const node = bar(plan({ stage: 'under_development', status: 'approved', implementable: true, failure: { mode: 'implement', message: 'API error 401: invalid_token' } }))
    expect(node.querySelector('.failed')!.textContent).toBe('The implementer failed: API error 401: invalid_token')
  })

  it('repair_shows_beside_the_next_step_while_the_spec_is_off_contract', () => {
    const spec = { ...plan().spec!, problems: ['line 3: no name'] }
    const node = bar(plan({ spec, repairable: true }))
    expect(node.querySelector('.repair')!.textContent).toBe('Repair (1)')
    expect(next(node)).not.toBeNull()
  })

  it('a_stopped_check_is_offered_again_and_a_live_one_can_be_stopped', () => {
    const idle = bar(plan({ stage: 'checking', status: 'approved', atWork: false, checkable: true }))
    const again = idle.querySelector<HTMLElement>('.next.check')!
    expect(again.textContent).toBe('Check again')
    expect(dispatched(idle, events.SpecCheckRequestedEvent.type, () => again.click())).toBe(true)

    const running = bar(plan({ stage: 'checking', status: 'approved', check: { live: true, text: 'reading src' } }))
    expect(dispatched(running, events.SpecCheckStoppedEvent.type, () => running.querySelector<HTMLElement>('.stop')!.click())).toBe(true)
  })
})

describe('PlanBar steps', () => {
  it('marks_the_current_step_and_the_ones_behind_it_and_shows_rule_only_with_decisions', () => {
    const steps = (node: HTMLElement) => [...node.querySelectorAll<HTMLElement>('.step')].map((s) => `${s.textContent}:${s.className.replace('step ', '')}`)
    expect(steps(bar(plan({ approvable: true })))).toEqual(['Plan:done', 'Review:done', 'Approve:current yours', 'Implement:future', 'Verify:future', 'Cleanup:future'])
    const ruling = bar(plan({ stage: 'ruling', status: 'approved', commentable: false, decisions: [decision({})], pendingDecisions: 1 }))
    expect(steps(ruling)).toEqual(['Plan:done', 'Review:done', 'Approve:done', 'Rule:current yours', 'Implement:future', 'Verify:future', 'Cleanup:future'])
  })

  it('the_current_step_is_marked_yours_only_while_the_act_is_the_devs', () => {
    const running = bar(plan({ stage: 'checking', status: 'approved', check: { live: true, text: 'reading src' } }))
    expect(running.querySelector('.step.current')).not.toBeNull()
    expect(running.querySelector('.step.yours')).toBeNull()
    const offered = bar(plan({ stage: 'verified', status: 'approved', commentable: false, atWork: false, cleanupSweep: { units: [{ path: 'src/a.ts', line: 1, name: 'a', kind: 'function', lines: 60, threshold: 25 }] } }))
    expect(offered.querySelector('.step.current.yours')!.textContent).toBe('Cleanup')
  })

  it('a_question_in_a_run_is_a_blocked_link_that_opens_the_chat', () => {
    const node = bar(plan({ stage: 'under_development', status: 'approved', commentable: false, blocked: { on: 'answer', mode: 'implement' } }))
    const link = node.querySelector<HTMLElement>('.next.goto.blocked')!
    expect(link.textContent).toContain('Question from the implementer')
    let tab: string | undefined
    node.addEventListener(events.PlanFocusRequestedEvent.type, (e) => (tab = (e as InstanceType<typeof events.PlanFocusRequestedEvent>).tab))
    link.click()
    expect(tab).toBe('chat')
  })

  it('a_reached_step_is_a_button_that_names_itself', () => {
    const node = bar(plan({ approvable: true }))
    let step: string | undefined
    node.addEventListener(events.PlanStepSelectedEvent.type, (e) => (step = (e as InstanceType<typeof events.PlanStepSelectedEvent>).step))
    const review = [...node.querySelectorAll<HTMLElement>('.step')].find((s) => s.textContent === 'Review')!
    expect(review.tagName).toBe('BUTTON')
    review.click()
    expect(step).toBe('review')
    expect([...node.querySelectorAll<HTMLElement>('.step')].find((s) => s.textContent === 'Verify')!.tagName).toBe('SPAN')
  })
})

describe('PlanTabs', () => {
  const labels = (node: HTMLElement) => [...node.querySelectorAll<HTMLElement>('.tab')].map((t) => `${t.textContent}${t.classList.contains('active') ? '*' : ''}`)

  it('a_tab_appears_once_there_is_something_on_it_and_chat_is_always_last', () => {
    const node = new PlanTabs()
    document.body.appendChild(node)
    node.update(plan(), 'spec')
    expect(labels(node)).toEqual(['Spec*', 'Chat'])
    node.update(plan({ decisions: [decision({})], review: { rounds: [{ number: 1, submittedAt: 't', comments: [{ target: 'Cancel', text: 'no' }], strikes: [] }] } }), 'chat')
    expect(labels(node)).toEqual(['Spec', 'Review (1)', 'Decisions (1)', 'Chat*'])
  })

  it('the_tab_holding_the_devs_act_is_marked', () => {
    const answered = { target: 'Cancel', text: 'no', resolution: { kind: 'addressed' as const, text: 'ok' } }
    const node = new PlanTabs()
    document.body.appendChild(node)
    node.update(plan({ stage: 'final_draft', review: { rounds: [{ number: 1, submittedAt: 't', comments: [answered], strikes: [] }] } }), 'spec')
    const marked = () => [...node.querySelectorAll<HTMLElement>('.tab.attention')].map((t) => t.textContent)
    expect(marked()).toEqual(['Review (1)'])
    node.update(plan({ blocked: { on: 'answer', mode: 'plan' } }), 'spec', true)
    expect(marked()).toEqual(['Chat'])
    expect(node.querySelector('.tab.moved')).toBeNull()
  })

  it('picking_a_tab_names_it', () => {
    const node = new PlanTabs()
    document.body.appendChild(node)
    node.update(plan(), 'spec')
    let picked: string | undefined
    node.addEventListener(events.PlanViewSelectedEvent.type, (e) => (picked = (e as InstanceType<typeof events.PlanViewSelectedEvent>).view))
    ;[...node.querySelectorAll<HTMLElement>('.tab')].find((t) => t.textContent === 'Chat')!.click()
    expect(picked).toBe('chat')
  })
})
