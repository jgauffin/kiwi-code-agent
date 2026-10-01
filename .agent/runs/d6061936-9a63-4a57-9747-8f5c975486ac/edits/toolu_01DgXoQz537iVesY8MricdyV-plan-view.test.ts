// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanState } from '../src/chat/protocol'
import type { Spec } from '../src/agent/phases/spec-model'
import type { ReviewRound } from '../src/agent/phases/plan-review'
import type { Task } from '../src/agent/phases/tasks-file'
import type { CleanupProgress } from '../src/chat/cleanup-progress'
import { planState } from './plan-state-fixture'

// The webview talks to the host through this handle, acquired when its modules load.
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { PlanView } = await import('../src/chat/webview/plan-view')
const { CleanupDecidedEvent, PlanFocusRequestedEvent, ReviewActionEvent } = await import('../src/chat/webview/events')
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

const plan = (over: Partial<PlanState> = {}): PlanState => planState({ spec, ...over })

const round = (over: Partial<ReviewRound>): ReviewRound => ({ number: 1, comments: [], strikes: [], ...over })
const task = (over: Partial<Task> = {}): Task => ({ name: 'Cancel', text: 'add it', delivers: ['Cancel command'], files: [], newFiles: [], foreignFiles: [], context: [], how: '', proves: [], note: '', built: '', state: 'open', removed: false, ...over })

function view(state: PlanState, tab: Tab = 'spec'): InstanceType<typeof PlanView> {
  const node = new PlanView()
  document.body.appendChild(node)
  node.update(state, tab)
  return node
}

const buttons = (node: HTMLElement, label: string) => [...node.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === label)

/** Every error Relaxjs reports lands here first, whichever of its bundles reported it. */
const relaxErrors: Error[] = ((globalThis as Record<string, unknown>).relaxErrors ??= [] as Error[]) as Error[]

describe('PlanView', () => {
  // A template that cannot resolve a path renders empty and reports rather than throwing, so a
  // mistyped binding would otherwise show up as a blank element with no reason for it. Read the
  // global rather than captureRelaxErrors: @relax.js/core/testing and /html are separate bundles
  // with a handler slot each, so the capture never sees what a template reports.
  beforeEach(() => (relaxErrors.length = 0))
  afterEach(() => expect(relaxErrors.map((e) => e.message)).toEqual([]))

  it('shows_the_tab_it_is_given_and_falls_back_to_the_spec_when_that_tab_has_nothing', () => {
    const node = view(plan({ tasks: [task()] }), 'tasks')
    expect(node.querySelector('.tasks')).not.toBeNull()
    node.update(plan(), 'tasks')
    expect(node.querySelector('.tasks')).toBeNull()
    expect(node.querySelector('.scenario')).not.toBeNull()
  })

  const detailed = () =>
    task({
      group: 'Cancelling an order',
      state: 'in_progress',
      text: 'add the cancel command',
      files: ['src/orders/cancel.ts', 'src/orders/cancel.test.ts'],
      context: ['src/orders/order.ts'],
      how: '- add `cancel()` beside `ship()`',
    })

  it('the_tasks_tab_says_what_each_task_does_and_which_paths_it_changes_and_reads', () => {
    const node = view(plan({ stage: 'under_development', status: 'approved', commentable: false, tasks: [detailed()] }), 'tasks')
    expect(node.querySelector('.group > .heading')?.textContent).toBe('Cancelling an order')
    expect(node.querySelector('.task .name')?.textContent).toBe('Cancel')
    expect(node.querySelector('.task .badge.state')?.textContent).toBe('in progress')
    expect(node.querySelector('.task .line > .text')?.textContent).toBe('Cancel: add the cancel command')
    const paths = [...node.querySelectorAll<HTMLElement>('.task .paths')]
    expect(paths.map((p) => p.querySelector('.kind')?.textContent)).toEqual(['changes', 'reads'])
    expect([...node.querySelectorAll('.task ul.files > li')].map((li) => li.textContent)).toEqual(['src/orders/cancel.ts', 'src/orders/cancel.test.ts'])
    expect([...node.querySelectorAll('.task ul.context > li')].map((li) => li.textContent)).toEqual(['src/orders/order.ts'])
    expect(node.querySelector('.task .delivers')).toBeNull()
  })

  it('a_blocked_task_says_what_stands_in_its_way', () => {
    const blocked = task({ state: 'blocked', blockedReason: 'the API moved' })
    const node = view(plan({ stage: 'under_development', status: 'approved', commentable: false, tasks: [blocked] }), 'tasks')
    expect(node.querySelector('.task .badge.state')?.textContent).toBe('blocked: the API moved')
  })

  const verified = () => ({ stage: 'verified' as const, status: 'approved' as const, commentable: false, tasks: [task({ state: 'tested' })] })
  const sweepUnits = [
    {
      path: 'src/orders/cancel.ts',
      line: 12,
      name: 'cancel',
      kind: 'function' as const,
      breaches: [
        { measure: 'complexity' as const, value: 22, limit: 15 },
        { measure: 'lines' as const, value: 61, limit: 60 },
      ],
    },
    { path: 'src/orders/order.ts', line: 3, name: 'Order', kind: 'type' as const, breaches: [{ measure: 'lines' as const, value: 240, limit: 200 }] },
  ]

  it('the_units_the_sweep_found_are_offered_on_the_cleanup_tab_by_file_and_not_on_the_tasks_tab', () => {
    const state = plan({ ...verified(), cleanupSweep: { units: sweepUnits } })
    expect(view(state, 'tasks').querySelector('.cleanup')).toBeNull()

    const node = view(state, 'cleanup')
    const rows = [...node.querySelectorAll<HTMLElement>('.cleanup .unit')]
    expect(rows.map((r) => r.querySelector('.name')?.textContent)).toEqual(['cancel', 'Order'])
    expect(rows[0]!.textContent).toContain('function, complexity 22, limit 15; 61 lines, limit 60')
    expect(rows[1]!.textContent).toContain('type, 240 lines, limit 200')
    expect(rows[1]!.querySelector('.link.file')?.textContent).toBe(':3')
    expect([...node.querySelectorAll('.cleanup .pick .link.file')].map((l) => l.textContent)).toEqual(['src/orders/cancel.ts', 'src/orders/order.ts'])

    const decided: string[] = []
    node.addEventListener(CleanupDecidedEvent.type, (e) => decided.push((e as InstanceType<typeof CleanupDecidedEvent>).decision))
    for (const [label, expected] of [['Clean up all', 'run'], ['Later', 'postpone'], ['Skip', 'skip']] as const) {
      buttons(node, label)[0]!.click()
      expect(decided.at(-1)).toBe(expected)
    }
  })

  it('every_file_starts_picked_and_a_split_is_limited_to_the_files_left_picked', () => {
    const node = view(plan({ ...verified(), cleanupSweep: { units: sweepUnits } }), 'cleanup')
    const boxes = () => [...node.querySelectorAll<HTMLInputElement>('.cleanup input[type=checkbox]')]
    expect(boxes().map((b) => b.checked)).toEqual([true, true])

    let paths: string[] | undefined
    node.addEventListener(CleanupDecidedEvent.type, (e) => (paths = (e as InstanceType<typeof CleanupDecidedEvent>).paths))
    boxes()[0]!.click()
    expect(node.querySelector('.cleanup .count')?.textContent).toBe('1 of 2 files')
    buttons(node, 'Clean up selected (1)')[0]!.click()
    expect(paths).toEqual(['src/orders/order.ts'])
    buttons(node, 'Clean up all')[0]!.click()
    expect(paths).toEqual(['src/orders/cancel.ts', 'src/orders/order.ts'])
  })

  it('the_toggle_selects_none_when_something_is_picked_and_all_when_nothing_is', () => {
    const node = view(plan({ ...verified(), cleanupSweep: { units: sweepUnits } }), 'cleanup')
    buttons(node, 'Select none')[0]!.click()
    expect([...node.querySelectorAll<HTMLInputElement>('.cleanup input[type=checkbox]')].map((b) => b.checked)).toEqual([false, false])
    expect(buttons(node, 'Clean up selected (0)')[0]!.disabled).toBe(true)
    buttons(node, 'Select all')[0]!.click()
    expect([...node.querySelectorAll<HTMLInputElement>('.cleanup input[type=checkbox]')].map((b) => b.checked)).toEqual([true, true])
  })

  it('a_settled_cleanup_offers_nothing_and_says_where_it_stands', () => {
    const units = sweepUnits.slice(0, 1)
    const skipped = view(plan({ ...verified(), cleanupSweep: { units }, cleanupDecision: 'skipped' }), 'cleanup')
    expect(skipped.querySelectorAll('.cleanup .unit')).toHaveLength(0)
    expect(buttons(skipped, 'Clean up all')).toHaveLength(0)
    expect(skipped.querySelector('.cleanup .note')?.textContent).toContain('skipped')

    const running = view(plan({ ...verified(), cleanupSweep: { units }, cleanup: { live: true, text: 'Read src/orders/cancel.ts' } }), 'cleanup')
    expect(running.querySelector('.cleanup .running')?.textContent).toBe('Read src/orders/cancel.ts')
    expect(buttons(running, 'Clean up all')).toHaveLength(0)
  })

  const progress = (over: Partial<CleanupProgress> = {}): CleanupProgress => ({
    units: [
      { ...sweepUnits[0]!, state: 'within' },
      { ...sweepUnits[1]!, state: 'working' },
    ],
    newFiles: ['src/orders/cancel-refund.ts'],
    movesFile: 'specs/unfiled-moves.md',
    activity: 'Edit src/orders/order.ts',
    stage: 'splitting',
    ...over,
  })
  const running = () => ({ ...verified(), cleanupDecision: 'done' as const, cleanup: { live: true, text: 'Edit src/orders/order.ts' } })

  it('while_a_cleanup_runs_the_tab_follows_the_split_unit_by_unit', () => {
    const node = view(plan({ ...running(), cleanupProgress: progress() }), 'cleanup')

    expect(node.querySelector('.cleanup .headline')?.textContent).toBe('Splitting: 1 of 2 units within limit')
    expect(node.querySelector('.cleanup .activity')?.textContent).toBe('Edit src/orders/order.ts')
    const rows = [...node.querySelectorAll<HTMLElement>('.cleanup .progress .unit')]
    expect(rows.map((r) => [r.querySelector('.name')?.textContent, r.querySelector('.state')?.textContent])).toEqual([
      ['cancel', 'within limit'],
      ['Order', 'working'],
    ])
    expect([...node.querySelectorAll('.cleanup .split-into .link.file')].map((l) => l.textContent)).toEqual(['src/orders/cancel-refund.ts'])
    expect(node.querySelector('.cleanup .moves .link.file')?.textContent).toBe('specs/unfiled-moves.md')
    expect(node.querySelector('.cleanup .running')).toBeNull()
  })

  it('a_question_from_the_cleanup_links_to_the_chat_it_waits_in', () => {
    const node = view(plan({ ...running(), cleanupProgress: progress({ stage: 'asking' }) }), 'cleanup')
    const focused: string[] = []
    node.addEventListener(PlanFocusRequestedEvent.type, (e) => focused.push((e as InstanceType<typeof PlanFocusRequestedEvent>).tab))

    buttons(node, 'Waiting on your answer')[0]!.click()

    expect(focused).toEqual(['chat'])
  })

  it('after_the_run_the_tab_says_what_is_still_over_and_how_the_tests_went', () => {
    const done = progress({
      stage: 'done',
      outcome: 'Tests passed: 12 passed',
      units: [
        { ...sweepUnits[0]!, state: 'within' },
        { ...sweepUnits[1]!, state: 'over' },
      ],
    })
    const node = view(plan({ ...verified(), cleanupDecision: 'done', cleanup: { live: false, text: 'Cleanup left 1 unit over the limit; Tests passed' }, cleanupProgress: done }), 'cleanup')

    expect(node.querySelector('.cleanup .headline')?.textContent).toBe('Tests passed: 12 passed')
    expect([...node.querySelectorAll('.cleanup .progress .unit .state')].map((s) => s.textContent)).toEqual(['within limit', 'still over'])
  })

  it('the_how_block_is_on_the_task_folded_away', () => {
    const node = view(plan({ stage: 'under_development', status: 'approved', commentable: false, tasks: [detailed()] }), 'tasks')
    const how = node.querySelector<HTMLDetailsElement>('.task details.how')!
    expect(how.open).toBe(false)
    expect(how.querySelector('summary')?.textContent).toBe('how')
    expect(how.textContent).toContain('cancel()')
  })

  it('a_task_without_context_or_how_shows_neither', () => {
    const node = view(plan({ stage: 'under_development', status: 'approved', commentable: false, tasks: [task({ files: ['src/orders/cancel.ts'] })] }), 'tasks')
    expect(node.querySelector('.task ul.context')).toBeNull()
    expect(node.querySelector('.task details.how')).toBeNull()
    expect(node.querySelectorAll('.task .paths')).toHaveLength(1)
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
    const node = view(plan({ stage: 'ruling', status: 'approved', commentable: false, decisions, pendingDecisions: 2 }), 'decisions')
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

  it('a_ruled_decision_shows_its_choice_and_the_header_is_the_only_way_to_the_next_one', () => {
    const decisions = [
      { title: 'Refund', on: [], finding: 'f', proposals: ['queue it'], state: 'ruled' as const, ruling: 'queue it', line: 0, end: 0 },
      { title: 'Shipped', on: [], finding: 'f', proposals: ['refuse it'], state: 'ruled' as const, ruling: 'do both', line: 0, end: 0 },
    ]
    const node = view(plan({ stage: 'ruling', status: 'approved', commentable: false, decisions, pendingDecisions: 2 }), 'decisions')
    expect(node.querySelector('.wizard .left')!.textContent).toBe('all ruled')
    expect(node.querySelector('.decision .title')!.textContent).toBe('Refund')
    expect(node.querySelector('.option.chosen .text')!.textContent).toBe('queue it')
    // Titles under the options would read as further ways to settle the decision on screen.
    expect(node.querySelector('.steps')).toBeNull()
    buttons(node, 'Next')[0]!.click()
    expect(node.querySelector('.decision .title')!.textContent).toBe('Shipped')
    expect(node.querySelector('.option.own.chosen .text')!.textContent).toBe('do both')
    expect(node.querySelector('.decision .ruling .text')!.textContent).toBe('do both')
  })

  it('an_own_ruling_box_opens_empty_on_the_next_decision_and_rules_that_one', () => {
    const open = (title: string) => ({ title, on: [], finding: 'f', proposals: ['refuse it'], state: 'open' as const, line: 0, end: 0 })
    const state = (decisions: PlanState['decisions']) => plan({ stage: 'ruling', status: 'approved', commentable: false, decisions, pendingDecisions: 2 })
    const node = view(state([open('Refund'), open('Shipped')]), 'decisions')
    const actions: unknown[] = []
    node.addEventListener(ReviewActionEvent.type, (e) => actions.push((e as InstanceType<typeof ReviewActionEvent>).action))

    node.querySelector<HTMLButtonElement>('.option.own')!.click()
    node.querySelector('textarea')!.value = 'do both'
    buttons(node, 'Rule')[0]!.click()
    node.update(state([{ ...open('Refund'), state: 'ruled', ruling: 'do both' } as never, open('Shipped')]), 'decisions')

    expect(node.querySelector('.decision .title')!.textContent).toBe('Shipped')
    node.querySelector<HTMLButtonElement>('.option.own')!.click()
    const area = node.querySelector('textarea')!
    expect(area.value).toBe('')
    area.value = 'queue it'
    buttons(node, 'Rule')[0]!.click()
    expect(actions).toEqual([
      { type: 'rule_decision', decision: 'Refund', ruling: 'do both' },
      { type: 'rule_decision', decision: 'Shipped', ruling: 'queue it' },
    ])
  })

  it('the_card_shows_the_rules_as_the_spec_has_them_beside_what_the_code_does', () => {
    const decisions = [
      { title: 'Shipped', on: ['Cancel command', 'Shipped order', 'Renamed away'], finding: '`Order.cancel` refuses it', proposals: [], state: 'open' as const, line: 0, end: 0 },
    ]
    const node = view(plan({ stage: 'ruling', status: 'approved', commentable: false, decisions, pendingDecisions: 1 }), 'decisions')
    const rules = [...node.querySelectorAll('.sides .spec .rule')].map((r) => r.textContent)
    expect(rules).toEqual(['Cancel command: an open order can be cancelled', 'Shipped order: refused', 'Renamed away'])
    expect(node.querySelector('.sides .finding .text')!.innerHTML).toContain('<code>Order.cancel</code>')
    // The names head the spec side, so the row of links above the finding is gone.
    expect(node.querySelector('.decision > .on')).toBeNull()
    let asked: InstanceType<typeof PlanFocusRequestedEvent> | undefined
    node.addEventListener(PlanFocusRequestedEvent.type, (e) => (asked = e as InstanceType<typeof PlanFocusRequestedEvent>))
    node.querySelector<HTMLButtonElement>('.sides .spec .rule .name')!.click()
    expect(asked?.where).toEqual({ item: 'Cancel command' })
  })

  it('an_option_shows_the_rules_new_text_without_repeating_the_name_of_the_rule_it_rewrites', () => {
    const proposal = '**Cancel command**: an open order can be cancelled *until* it ships'
    const decisions = [{ title: 'Shipped', on: ['Cancel command'], finding: 'f', proposals: [proposal], state: 'open' as const, line: 0, end: 0 }]
    const node = view(plan({ stage: 'ruling', status: 'approved', commentable: false, decisions, pendingDecisions: 1 }), 'decisions')
    const text = node.querySelector('.option.change .text')!
    expect(text.textContent).toBe('an open order can be cancelled until it ships')
    expect(text.innerHTML).toContain('<em>until</em>')
    expect(node.querySelector('.option.change .rule')).toBeNull()
    let action: unknown
    node.addEventListener(ReviewActionEvent.type, (e) => (action = (e as InstanceType<typeof ReviewActionEvent>).action))
    node.querySelector<HTMLButtonElement>('.option.change')!.click()
    // The ruling is the proposal as the file has it; only the card leaves the lead-in off.
    expect(action).toEqual({ type: 'rule_decision', decision: 'Shipped', ruling: proposal })
  })

  it('the_planners_pick_sits_under_the_options_and_names_one_by_its_number', () => {
    const decisions = [
      {
        title: 'Shipped',
        on: ['Cancel command'],
        finding: 'f',
        proposals: ['refuse it', 'allow it'],
        recommendation: { choice: 2, because: 'the `Order` already carries the shipment' },
        state: 'open' as const,
        line: 0,
        end: 0,
      },
    ]
    const node = view(plan({ stage: 'ruling', status: 'approved', commentable: false, decisions, pendingDecisions: 1 }), 'decisions')
    expect([...node.querySelectorAll('.option.change .index')].map((i) => i.textContent)).toEqual(['1', '2'])
    const pick = node.querySelector('.recommendation')!
    expect(pick.querySelector('.which')!.textContent).toBe('Option 2')
    expect(pick.querySelector('.because')!.innerHTML).toContain('<code>Order</code>')
    // Read after every option, not marked on one: the options come first in the card.
    expect([...node.querySelectorAll('.options > *')].at(-1)).toBe(pick)
    expect(node.querySelector('.option.chosen')).toBeNull()
  })

  it('an_option_names_the_rule_it_rewrites_only_when_the_options_rewrite_different_rules', () => {
    const on = ['Cancel command', 'Shipped order']
    const sameRule = [{ title: 'Shipped', on, finding: 'f', proposals: ['**Shipped order**: refused', '**Shipped order**: refused with a reason'], state: 'open' as const, line: 0, end: 0 }]
    const node = view(plan({ stage: 'ruling', status: 'approved', commentable: false, decisions: sameRule, pendingDecisions: 1 }), 'decisions')
    expect(node.querySelector('.option.change .rule')).toBeNull()
    const twoRules = [{ ...sameRule[0]!, proposals: ['**Shipped order**: refused', '**Cancel command**: cancelled until it ships'] }]
    node.update(plan({ stage: 'ruling', status: 'approved', commentable: false, decisions: twoRules, pendingDecisions: 1 }), 'decisions')
    expect([...node.querySelectorAll('.option.change .rule')].map((r) => r.textContent)).toEqual(['Shipped order', 'Cancel command'])
    expect(node.querySelector('.option.change .text')!.textContent).toBe('refused')
  })

  it('settled_decisions_fold_into_history_with_the_ruling_as_the_record', () => {
    const decisions = [
      { title: 'F1', on: ['B5'], finding: 'the code counts nothing', proposals: ['say keywords'], state: 'applied' as const, ruling: 'keep', line: 0, end: 0 },
      { title: 'F2', on: [], finding: 'gone', proposals: [], state: 'withdrawn' as const, line: 0, end: 0 },
    ]
    const node = view(plan({ stage: 'ruling', status: 'approved', commentable: false, decisions }), 'decisions')
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
