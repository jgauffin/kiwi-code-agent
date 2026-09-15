// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { PlanState } from '../src/chat/protocol'
import type { Spec } from '../src/agent/phases/spec-model'
import type { ReviewRound } from '../src/agent/phases/plan-review'
import type { Task } from '../src/agent/phases/tasks-file'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { PlanView } = await import('../src/chat/webview/plan-view')
const { ReviewActionEvent } = await import('../src/chat/webview/events')

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
  decisions: [],
  problems: [],
}

function plan(over: Partial<PlanState> = {}): PlanState {
  return {
    specPath: 'plan/orders.spec.md',
    tasksPath: 'plan/orders.tasks.md',
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
    pendingDecisions: 0,
    applyingRulings: false,
    ...over,
  }
}

const round = (over: Partial<ReviewRound>): ReviewRound => ({ number: 1, comments: [], strikes: [], ...over })
const task = (over: Partial<Task> = {}): Task => ({ name: 'Cancel', text: 'add it', delivers: ['Cancel command'], files: [], context: [], proves: [], state: 'open', removed: false, ...over })

function view(state: PlanState): InstanceType<typeof PlanView> {
  const node = new PlanView()
  document.body.appendChild(node)
  node.update(state)
  return node
}

const tabs = (node: HTMLElement) => [...node.querySelectorAll<HTMLElement>('.view-tabs .tab')].map((t) => t.textContent)
const buttons = (node: HTMLElement, label: string) => [...node.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === label)

describe('PlanView tabs', () => {
  it('a_tab_appears_once_there_is_something_on_it', () => {
    expect(tabs(view(plan()))).toEqual(['Spec'])
    const full = plan({
      review: { rounds: [round({ submittedAt: 't', comments: [{ target: 'Cancel command', text: 'no' }] })] },
      spec: { ...spec, decisions: [{ title: 'Shipped', on: [], finding: 'f', proposal: 'p', state: 'open', line: 0, end: 0 }] },
      tasks: [task()],
      intent: { path: 'plan/orders.intent.md', pending: 1, applied: 0, applicable: false, amendments: [] },
    })
    expect(tabs(view(full))).toEqual(['Spec', 'Review (1)', 'Decisions (1)', 'Tasks (1)', 'Intent (1)'])
  })

  it('the_tab_follows_the_step_when_it_changes_and_holds_otherwise', () => {
    const node = view(plan())
    expect(node.activeTab).toBe('spec')
    node.update(plan({ stage: 'mapped', tasks: [task()], spec: { ...spec, decisions: [{ title: 'Shipped', on: [], finding: 'f', proposal: 'p', state: 'open', line: 0, end: 0 }] }, pendingDecisions: 1 }))
    expect(node.activeTab).toBe('decisions')
    node.open('tasks')
    node.update(plan({ stage: 'mapped', tasks: [task(), task({ name: 'Refund' })], spec: { ...spec, decisions: [{ title: 'Shipped', on: [], finding: 'f', proposal: 'p', state: 'open', line: 0, end: 0 }] }, pendingDecisions: 1 }))
    expect(node.activeTab).toBe('tasks')
  })

  it('the_review_tab_lists_answers_with_resolve_and_scrolls_to_the_first', () => {
    const answered = { target: 'Cancel command', text: 'too vague', resolution: { kind: 'addressed' as const, text: 'rewritten' } }
    const node = view(plan({ stage: 'final_draft', review: { rounds: [round({ submittedAt: 't', comments: [answered] })] } }))
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    node.open('review', { scroll: true })
    expect(node.activeTab).toBe('review')
    expect(buttons(node, 'Resolve')).toHaveLength(1)
    expect(node.querySelector('.comment.attention')).not.toBeNull()
    expect(scrolled).toHaveBeenCalledOnce()
    let action: unknown
    node.addEventListener(ReviewActionEvent.type, (e) => (action = (e as InstanceType<typeof ReviewActionEvent>).action))
    buttons(node, 'Resolve')[0]!.click()
    expect(action).toEqual({ type: 'resolve_comment', comment: { round: 1, index: 0 } })
  })

  it('a_comment_names_its_rule_and_the_name_opens_it_on_the_spec', () => {
    const node = view(plan({ stage: 'under_review', review: { rounds: [round({ comments: [{ target: 'Refund on cancel', text: 'why' }] })] } }))
    node.open('review')
    const link = node.querySelector<HTMLButtonElement>('.comment .on .link.item')!
    expect(link.textContent).toBe('Refund on cancel')
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    link.click()
    expect(node.activeTab).toBe('spec')
    expect(scrolled).toHaveBeenCalledOnce()
    expect((scrolled.mock.instances[0] as HTMLElement).dataset.item).toBe('Refund on cancel')
  })

  it('submit_review_is_not_on_the_view', () => {
    const node = view(plan({ stage: 'under_review', review: { rounds: [round({ comments: [{ target: 'Cancel command', text: 'no' }] })] } }))
    node.open('review')
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
    node.update(plan({ body: '# Orders v2' }))
    expect(node.querySelector('textarea')!.value).toBe('half a thought')
  })

  it('a_decision_to_rule_on_is_marked_for_attention', () => {
    const decisions = [
      { title: 'Shipped', on: ['Cancel command'], finding: 'f', proposal: 'p', state: 'open' as const, line: 0, end: 0 },
      { title: 'Refund', on: [], finding: 'f', proposal: 'p', state: 'ruled' as const, ruling: 'accepted', line: 0, end: 0 },
    ]
    const node = view(plan({ stage: 'mapped', tasks: [task()], spec: { ...spec, decisions }, pendingDecisions: 2 }))
    expect(node.activeTab).toBe('decisions')
    expect(node.querySelectorAll('.decision.attention')).toHaveLength(1)
    expect(buttons(node, 'Accept proposal')).toHaveLength(1)
    expect(buttons(node, 'Change ruling')).toHaveLength(1)
  })

  it('the_intent_tab_shows_each_amendment_with_its_state', () => {
    const amendments = [
      { mode: 'append' as const, doc: 'docs/intent/orders.md', heading: 'Cancellation', from: 'Refund job', why: 'unsaid', text: 'Refunds run nightly.', applied: false, line: 0 },
      { mode: 'new' as const, doc: 'docs/intent/refunds.md', text: 'Refunds.', applied: true, line: 5 },
    ]
    const node = view(plan({ stage: 'verified', status: 'approved', commentable: false, tasks: [task({ state: 'tested' })], intent: { path: 'p', pending: 1, applied: 1, applicable: true, amendments } }))
    expect(node.activeTab).toBe('intent')
    const rows = [...node.querySelectorAll<HTMLElement>('.amendment')]
    expect(rows.map((r) => r.className)).toEqual(['amendment pending', 'amendment applied'])
    expect(rows[0]!.querySelector('.name')!.textContent).toBe('docs/intent/orders.md#Cancellation')
  })
})
