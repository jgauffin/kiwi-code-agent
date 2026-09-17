// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { PlanState } from '../src/chat/protocol'
import type { Spec } from '../src/agent/phases/spec-model'
import type { ReviewRound } from '../src/agent/phases/plan-review'
import type { Task } from '../src/agent/phases/tasks-file'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { PlanView } = await import('../src/chat/webview/plan-view')
const { PlanFocusRequestedEvent, ReviewActionEvent } = await import('../src/chat/webview/events')
type Tab = Parameters<InstanceType<typeof PlanView>['update']>[1]

const spec: Spec = {
  title: 'Orders',
  goal: 'Orders can be cancelled.',
  scenarios: [
    {
      title: 'Cancelling an order',
      intro: '',
      behaviours: [
        { name: 'Cancel command', text: 'an open order can be cancelled', removed: false, edges: [{ name: 'Shipped order', text: 'refused', removed: false }] },
        { name: 'Refund on cancel', text: 'the payment is refunded', removed: false, edges: [] },
      ],
    },
  ],
  questions: [],
  problems: [],
}

function plan(over: Partial<PlanState> = {}): PlanState {
  return {
    specPath: 'plan/orders.spec.md',
    tasksPath: 'plan/orders.tasks.md',
    decisionsPath: 'plan/orders.decisions.md',
    stage: 'created',
    status: 'draft',
    body: '# Orders',
    spec,
    stale: false,
    repairable: false,
    mappable: true,
    implementable: false,
    verifiable: false,
    tasks: [],
    review: { rounds: [] },
    commentable: true,
    approvable: false,
    decisions: [],
    pendingDecisions: 0,
    applyingRulings: false,
    reviewingDocs: false,
    ...over,
  }
}

const round = (over: Partial<ReviewRound>): ReviewRound => ({ number: 1, comments: [], strikes: [], ...over })
const task = (over: Partial<Task> = {}): Task => ({ name: 'Cancel', text: 'add it', delivers: ['Cancel command'], files: [], context: [], how: '', proves: [], state: 'open', removed: false, ...over })

function view(state: PlanState, tab: Tab = 'spec'): InstanceType<typeof PlanView> {
  const node = new PlanView()
  document.body.appendChild(node)
  node.update(state, tab)
  return node
}

const buttons = (node: HTMLElement, label: string) => [...node.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === label)

describe('PlanView', () => {
  it('shows_the_tab_it_is_given_and_falls_back_to_the_spec_when_that_tab_has_nothing', () => {
    const node = view(plan({ tasks: [task()] }), 'tasks')
    expect(node.querySelector('.tasks')).not.toBeNull()
    node.update(plan(), 'tasks')
    expect(node.querySelector('.tasks')).toBeNull()
    expect(node.querySelector('.scenario')).not.toBeNull()
  })

  it('the_tasks_tab_shows_scenario_state_and_files_and_keeps_the_implementers_detail_off_it', () => {
    const detailed = task({
      group: 'Cancelling an order',
      state: 'in_progress',
      files: ['src/orders/cancel.ts', 'src/orders/cancel.test.ts'],
      context: ['src/orders/order.ts'],
      how: '- add `cancel()` beside `ship()`',
    })
    const node = view(plan({ stage: 'under_development', status: 'approved', commentable: false, tasks: [detailed] }), 'tasks')
    expect(node.querySelector('.group > .heading')?.textContent).toBe('Cancelling an order')
    expect(node.querySelector('.task .name')?.textContent).toBe('Cancel')
    expect(node.querySelector('.task .badge.state')?.textContent).toBe('in progress')
    expect([...node.querySelectorAll('.task ul.files > li')].map((li) => li.textContent)).toEqual(['src/orders/cancel.ts', 'src/orders/cancel.test.ts'])
    const text = node.querySelector('.task')!.textContent ?? ''
    expect(text).not.toContain('add it')
    expect(text).not.toContain('src/orders/order.ts')
    expect(text).not.toContain('cancel()')
    expect(node.querySelector('.task .delivers')).toBeNull()
  })

  it('the_review_tab_lists_answers_with_resolve_and_lands_on_the_first', () => {
    const answered = { target: 'Cancel command', text: 'too vague', resolution: { kind: 'addressed' as const, text: 'rewritten' } }
    const node = view(plan({ stage: 'final_draft', review: { rounds: [round({ submittedAt: 't', comments: [answered] })] } }), 'review')
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    node.land({ scroll: true })
    expect(buttons(node, 'Resolve')).toHaveLength(1)
    expect(node.querySelector('.comment.attention')).not.toBeNull()
    expect(scrolled).toHaveBeenCalledOnce()
    let action: unknown
    node.addEventListener(ReviewActionEvent.type, (e) => (action = (e as InstanceType<typeof ReviewActionEvent>).action))
    buttons(node, 'Resolve')[0]!.click()
    expect(action).toEqual({ type: 'resolve_comment', comment: { round: 1, index: 0 } })
  })

  it('a_comment_names_its_rule_and_the_name_asks_for_it_on_the_spec', () => {
    const node = view(plan({ stage: 'under_review', review: { rounds: [round({ comments: [{ target: 'Refund on cancel', text: 'why' }] })] } }), 'review')
    const link = node.querySelector<HTMLButtonElement>('.comment .on .link.item')!
    expect(link.textContent).toBe('Refund on cancel')
    let asked: InstanceType<typeof PlanFocusRequestedEvent> | undefined
    node.addEventListener(PlanFocusRequestedEvent.type, (e) => (asked = e as InstanceType<typeof PlanFocusRequestedEvent>))
    link.click()
    expect(asked?.tab).toBe('spec')
    expect(asked?.where).toEqual({ item: 'Refund on cancel' })
  })

  it('landing_on_an_item_scrolls_its_row', () => {
    const node = view(plan())
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    node.land({ item: 'refund on cancel' })
    expect((scrolled.mock.instances[0] as HTMLElement).dataset.item).toBe('Refund on cancel')
  })

  it('submit_review_is_not_on_the_view', () => {
    const node = view(plan({ stage: 'under_review', review: { rounds: [round({ comments: [{ target: 'Cancel command', text: 'no' }] })] } }), 'review')
    expect(buttons(node, 'Submit review')).toHaveLength(0)
    expect(buttons(node, 'Edit')).toHaveLength(1)
    expect(buttons(node, 'Remove')).toHaveLength(1)
  })

  it('an_open_comment_box_survives_a_redraw', () => {
    const node = view(plan())
    buttons(node, 'Comment')[1]!.click()
    const area = node.querySelector('textarea')!
    area.value = 'half a thought'
    area.dispatchEvent(new Event('input'))
    node.update(plan({ body: '# Orders v2' }), 'spec')
    expect(node.querySelector('textarea')!.value).toBe('half a thought')
  })

  it('the_wizard_shows_the_first_open_decision_with_every_way_to_settle_it', () => {
    const decisions = [
      { title: 'Refund', on: [], finding: 'f', proposals: ['queue it'], state: 'ruled' as const, ruling: 'keep', line: 0, end: 0 },
      { title: 'Shipped', on: ['Cancel command'], finding: 'the code refuses; the spec allows', proposals: ['refuse it', 'allow it'], state: 'open' as const, line: 0, end: 0 },
    ]
    const node = view(plan({ stage: 'mapped', tasks: [task()], decisions, pendingDecisions: 2 }), 'decisions')
    expect(node.querySelector('.wizard .count')!.textContent).toBe('Decision 2 of 2')
    expect(node.querySelector('.decision .title')!.textContent).toBe('Shipped')
    expect(node.querySelectorAll('.decision.attention')).toHaveLength(1)
    const options = [...node.querySelectorAll<HTMLElement>('.option')].map((o) => `${o.querySelector('.kind')!.textContent}: ${o.querySelector('.text')!.textContent}`)
    expect(options).toEqual(['Change the spec: refuse it', 'Change the spec: allow it', 'Keep the spec: the code changes', 'Own ruling: say what should happen'])
    let action: unknown
    node.addEventListener(ReviewActionEvent.type, (e) => (action = (e as InstanceType<typeof ReviewActionEvent>).action))
    node.querySelector<HTMLButtonElement>('.option.change')!.click()
    expect(action).toEqual({ type: 'rule_decision', decision: 'Shipped', ruling: 'refuse it' })
    node.querySelector<HTMLButtonElement>('.option.keep')!.click()
    expect(action).toEqual({ type: 'rule_decision', decision: 'Shipped', ruling: 'keep' })
  })

  it('a_ruled_decision_shows_its_choice_and_can_be_reached_from_the_steps', () => {
    const decisions = [
      { title: 'Refund', on: [], finding: 'f', proposals: ['queue it'], state: 'ruled' as const, ruling: 'queue it', line: 0, end: 0 },
      { title: 'Shipped', on: [], finding: 'f', proposals: ['refuse it'], state: 'ruled' as const, ruling: 'do both', line: 0, end: 0 },
    ]
    const node = view(plan({ stage: 'mapped', tasks: [task()], decisions, pendingDecisions: 2 }), 'decisions')
    expect(node.querySelector('.wizard .left')!.textContent).toBe('all ruled')
    expect(node.querySelector('.decision .title')!.textContent).toBe('Refund')
    expect(node.querySelector('.option.chosen .text')!.textContent).toBe('queue it')
    expect([...node.querySelectorAll('.steps .step')].map((s) => s.className)).toEqual(['step ruled current', 'step ruled'])
    ;[...node.querySelectorAll<HTMLButtonElement>('.steps .link')].find((b) => b.textContent === 'Shipped')!.click()
    expect(node.querySelector('.decision .title')!.textContent).toBe('Shipped')
    expect(node.querySelector('.option.own.chosen .text')!.textContent).toBe('do both')
    expect(node.querySelector('.decision .ruling .text')!.textContent).toBe('do both')
  })

  it('settled_decisions_fold_into_history_with_the_ruling_as_the_record', () => {
    const decisions = [
      { title: 'F1', on: ['B5'], finding: 'the code counts nothing', proposals: ['say keywords'], state: 'applied' as const, ruling: 'keep', line: 0, end: 0 },
      { title: 'F2', on: [], finding: 'gone', proposals: [], state: 'withdrawn' as const, line: 0, end: 0 },
    ]
    const node = view(plan({ stage: 'mapped', tasks: [task()], decisions }), 'decisions')
    expect(node.querySelectorAll('.decisions > .decision')).toHaveLength(0)
    expect(node.querySelector('.wizard')).toBeNull()
    const history = node.querySelector<HTMLDetailsElement>('.history')!
    expect(history.open).toBe(false)
    expect(history.querySelector('summary')!.textContent).toBe('1 applied, 1 withdrawn')
    const applied = history.querySelector('.decision.settled.applied')!
    expect(applied.querySelector('.ruling .text')!.textContent).toBe('keep the spec; the code changes')
    expect(applied.querySelector('.foot .title')!.textContent).toBe('F1')
    expect(node.querySelectorAll('.option')).toHaveLength(0)
  })
})
