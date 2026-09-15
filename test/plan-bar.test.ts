// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PlanState } from '../src/chat/protocol'
import type { Decision } from '../src/agent/phases/decisions'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { PlanBar } = await import('../src/chat/webview/plan-bar')
const { PlanStepper } = await import('../src/chat/webview/plan-stepper')
const events = await import('../src/chat/webview/events')

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

const decision = (over: Partial<Decision>): Decision => ({ title: 'Shipped orders', on: [], finding: 'code', proposal: 'drop', state: 'open', line: 0, end: 0, ...over })

function bar(state: PlanState): InstanceType<typeof PlanBar> {
  const node = new PlanBar()
  document.body.appendChild(node)
  node.update(state, 'plan')
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
    const node = bar(plan({ stage: 'mapped', approvable: true }))
    const slot = next(node)!
    expect(slot.tagName).toBe('BUTTON')
    expect(slot.textContent).toBe('Approve')
    expect(dispatched(node, events.SpecApprovedEvent.type, () => slot.click())).toBe(true)
  })

  it('submit_review_and_send_rulings_are_bar_buttons', () => {
    const submit = bar(plan({ stage: 'under_review', review: { rounds: [{ number: 1, comments: [{ target: 'Cancel', text: 'no' }], strikes: [] }] } }))
    expect(next(submit)!.textContent).toBe('Submit review (1)')
    expect(dispatched(submit, events.ReviewSubmittedEvent.type, () => next(submit)!.click())).toBe(true)

    const spec = { ...plan().spec!, decisions: [decision({})] }
    const rulings = bar(plan({ stage: 'mapped', spec, pendingDecisions: 1 }))
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

  it('decisions_to_rule_on_link_beside_send_rulings', () => {
    const spec = { ...plan().spec!, decisions: [decision({}), decision({ title: 'Refund', state: 'ruled', ruling: 'accepted' })] }
    const node = bar(plan({ stage: 'mapped', spec, pendingDecisions: 2 }))
    expect(node.querySelector('.next.goto')!.textContent).toContain('1 to rule on')
    expect(node.querySelector('.next.send_rulings')).not.toBeNull()
  })

  it('waiting_is_text_and_yields_to_a_running_line', () => {
    const waiting = bar(plan({ stage: 'mapped', pendingDecisions: 1, applyingRulings: true }))
    expect(next(waiting)!.tagName).toBe('SPAN')
    expect(next(waiting)!.textContent).toContain('applying 1 ruling')

    const running = bar(plan({ mapping: { live: true, text: 'reading src' } }))
    expect(running.querySelector('.next.waiting')).toBeNull()
    expect(running.querySelector('.status.running')!.textContent).toBe('reading src')
  })

  it('repair_shows_beside_the_next_step_while_the_spec_is_off_contract', () => {
    const spec = { ...plan().spec!, problems: ['line 3: no name'] }
    const node = bar(plan({ spec, repairable: true }))
    expect(node.querySelector('.repair')!.textContent).toBe('Repair (1)')
    expect(next(node)).not.toBeNull()
  })
})

describe('PlanStepper', () => {
  function stepper(state: PlanState): InstanceType<typeof PlanStepper> {
    const node = new PlanStepper()
    document.body.appendChild(node)
    node.update(state)
    return node
  }

  it('marks_the_current_step_and_the_ones_behind_it', () => {
    const node = stepper(plan({ stage: 'mapped', approvable: true }))
    const classes = [...node.querySelectorAll<HTMLElement>('.step')].map((s) => `${s.textContent}:${s.className.replace('step ', '')}`)
    expect(classes).toEqual(['Plan:done', 'Review:done', 'Map:done', 'Rule:done', 'Approve:current', 'Implement:future', 'Verify:future', 'Intent:future'])
  })

  it('a_reached_step_is_a_button_that_names_itself', () => {
    const node = stepper(plan({ stage: 'mapped', approvable: true }))
    let step: string | undefined
    node.addEventListener(events.PlanStepSelectedEvent.type, (e) => (step = (e as InstanceType<typeof events.PlanStepSelectedEvent>).step))
    const review = [...node.querySelectorAll<HTMLElement>('.step')].find((s) => s.textContent === 'Review')!
    expect(review.tagName).toBe('BUTTON')
    review.click()
    expect(step).toBe('review')
    expect([...node.querySelectorAll<HTMLElement>('.step')].find((s) => s.textContent === 'Verify')!.tagName).toBe('SPAN')
  })
})
