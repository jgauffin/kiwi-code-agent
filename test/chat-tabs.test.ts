// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { ModelOption, PlanState, RunControls, RunSection, ToWebview } from '../src/chat/protocol'
import type { SessionEvent } from '../src/agent/session/code-session'
import type { Effort } from '../src/agent/session/model-profile'

const sent: unknown[] = []
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => sent.push(m), setState: () => {} })

// Test files share a worker, so the module registry is cleared first: what
// loads here is this file's own, bound to its stub and its document.
vi.resetModules()

const { ChatApp } = await import('../src/chat/webview/chat-app')

function plan(): PlanState {
  return {
    specPath: 'specs/orders.spec.md',
    tasksPath: 'specs/orders.tasks.md',
    decisionsPath: 'specs/orders.decisions.md',
    stage: 'created',
    status: 'draft',
    body: '# Orders',
    spec: { title: 'Orders', goal: '', scenarios: [], questions: [], problems: [] },
    stale: false,
    repairable: false,
    checkable: false,
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
    atWork: true,
  }
}

const SESSION = 's1'
const CHECK = 's2'

const planRun = (): RunControls => ({ sessionId: SESSION, mode: 'plan', title: 'Plan: Orders', profileName: 'Claude', live: true, settled: false })
const checkRun = (): RunControls => ({ sessionId: CHECK, mode: 'reconcile', title: 'Check: Orders', profileName: 'Claude', live: true, settled: false })

const state = (runs: RunControls[] = [planRun()]): Extract<ToWebview, { type: 'state' }> => ({
  type: 'state',
  tab: { id: SESSION, title: 'Orders', mode: 'plan', access: 'scoped', profileName: 'Claude', status: 'idle' },
  runs,
  plan: plan(),
  plans: [],
  chats: [],
  unfiled: 0,
  profiles: { names: ['Claude'], active: 'Claude' },
  models: [],
})

/** `runs` carry a section's events and the controls the composer takes from the run it talks to. */
function app(runs: (RunSection & Partial<RunControls>)[] = [{ ...planRun(), events: [] }]) {
  const node = new ChatApp()
  document.body.appendChild(node)
  send(state(runs.map(({ events: _events, ...run }) => run as RunControls)))
  send({ type: 'transcript', sessionId: SESSION, runs: runs.map(({ effort: _effort, ...run }) => run) })
  return node
}

const send = (message: ToWebview) => window.dispatchEvent(new MessageEvent('message', { data: message }))
const event = (e: SessionEvent, run: RunControls = planRun()) => send({ type: 'event', sessionId: SESSION, run, event: e })

const tab = (node: HTMLElement, name: string) =>
  [...node.querySelectorAll<HTMLElement>('.plan-tabs .tab')].find((t) => t.textContent?.startsWith(name))!
const active = (node: HTMLElement) => node.querySelector<HTMLElement>('.plan-tabs .tab.active')!.textContent

const speaking: SessionEvent = { type: 'assistant_text', messageId: 'm1', delta: 'working' }

describe('chat tab while a plan tab is open', () => {
  it('the_conversation_moving_on_marks_the_chat_tab_instead_of_taking_over_the_view', () => {
    const node = app()
    expect(active(node)).toBe('Spec')

    event(speaking)

    expect(active(node)).toBe('Spec')
    expect(tab(node, 'Chat').classList.contains('moved')).toBe(true)
    node.remove()
  })

  it('opening_the_chat_clears_the_mark', () => {
    const node = app()
    event(speaking)

    tab(node, 'Chat').click()

    expect(active(node)).toBe('Chat · Plan')
    expect(tab(node, 'Chat').classList.contains('moved')).toBe(false)
    node.remove()
  })

  it('nothing_is_marked_while_the_reader_is_already_watching_the_chat', () => {
    const node = app()
    tab(node, 'Chat').click()

    event(speaking)

    expect(active(node)).toBe('Chat · Plan')
    expect(tab(node, 'Chat').classList.contains('moved')).toBe(false)
    node.remove()
  })
})

const sections = (node: HTMLElement) => [...node.querySelectorAll<HTMLDetailsElement>('.phase-chat:not([hidden]) .runs > .run')]
const section = (node: HTMLElement, sessionId: string) => node.querySelector<HTMLDetailsElement>(`.run[data-session="${sessionId}"]`)!

describe('the planner and its checks in the plan chat', () => {
  const withCheck = (): RunSection[] => [
    { ...planRun(), events: [] },
    { ...checkRun(), events: [] },
  ]

  it('every_run_has_its_own_conversation_and_only_the_planner_is_open', () => {
    const node = app(withCheck())
    tab(node, 'Chat').click()

    expect(sections(node).map((s) => s.querySelector('.run-head')?.textContent)).toEqual(['Plan: Orders', 'Check: Orders'])
    expect(sections(node).map((s) => s.open)).toEqual([true, false])
    node.remove()
  })

  it('an_event_lands_in_the_run_that_sent_it_and_marks_that_run_when_it_is_folded_away', () => {
    const node = app(withCheck())
    tab(node, 'Chat').click()

    event(speaking, checkRun())

    expect(section(node, CHECK).classList.contains('moved')).toBe(true)
    expect(section(node, CHECK).querySelector('.transcript')!.textContent).toContain('working')
    expect(section(node, SESSION).querySelector('.transcript')!.textContent).not.toContain('working')
    node.remove()
  })

  it('a_check_that_starts_folds_in_beside_the_planner_which_stays_the_one_typed_to', () => {
    const node = app()
    tab(node, 'Chat').click()

    event(speaking, checkRun())

    expect(sections(node).map((s) => s.dataset.session)).toEqual([SESSION, CHECK])
    expect(section(node, SESSION).open).toBe(true)
    expect(node.querySelector('chat-composer .recipient')?.textContent).toBe('To: planner')
    node.remove()
  })

  it('reading_the_check_is_not_folded_away_while_the_planner_streams', () => {
    const node = app(withCheck())
    tab(node, 'Chat').click()
    section(node, CHECK).open = true

    event(speaking)

    expect(section(node, CHECK).open).toBe(true)
    node.remove()
  })

  it('opening_the_chat_again_folds_what_the_reader_opened_back_to_the_planner', () => {
    const node = app(withCheck())
    tab(node, 'Chat').click()
    section(node, CHECK).open = true

    tab(node, 'Spec').click()
    tab(node, 'Chat').click()

    expect(section(node, CHECK).open).toBe(false)
    expect(section(node, SESSION).open).toBe(true)
    node.remove()
  })

  it('an_answer_is_addressed_to_the_run_that_asked', () => {
    const node = app(withCheck())
    tab(node, 'Chat').click()
    sent.length = 0

    event({ type: 'permission_request', requestId: 'r1', toolUseId: 't1', toolName: 'Write', input: { file_path: 'a.ts' } }, checkRun())
    section(node, CHECK).querySelector<HTMLButtonElement>('button')!.click()

    // The card sits in the check's section, so the decision goes there and not to the planner the composer reaches.
    expect(posted(sent, 'permission')).toMatchObject({ sessionId: CHECK, requestId: 'r1' })
    node.remove()
  })
})

function posted(sent: unknown[], type: string): Record<string, unknown> | undefined {
  return sent.find((m): m is Record<string, unknown> => typeof m === 'object' && m !== null && (m as { type?: string }).type === type)
}

describe("the composer's model switch follows the session it belongs to", () => {
  const composerOf = (node: HTMLElement) => node.querySelector('chat-composer')!

  /** A tab showing one chat session, on `Careful`, with the models the host offers it. */
  function chatApp(models: ModelOption[], effort?: Effort): HTMLElement {
    const node = new ChatApp()
    document.body.appendChild(node)
    const run: RunControls = { sessionId: SESSION, mode: 'chat', title: 'Untitled', profileName: 'Careful', live: false, settled: false }
    const { plan: _plan, ...rest } = state([run])
    send({
      ...rest,
      tab: { id: SESSION, title: 'Untitled', mode: 'chat', access: 'scoped', profileName: 'Careful', status: 'idle', ...(effort ? { effort } : {}) },
      models,
    })
    send({ type: 'transcript', sessionId: SESSION, runs: [] })
    return node
  }

  const THINKERS: ModelOption[] = [
    { name: 'Careful', efforts: ['low', 'medium', 'high'] },
    { name: 'Fast', efforts: ['low', 'medium', 'high'] },
  ]

  it('B9_a_chat_sessions_composer_offers_every_registered_model_switchable_at_any_point_independent_of_any_features_phase_choices', () => {
    const node = chatApp([
      { name: 'Careful', efforts: [] },
      { name: 'Fast', efforts: [] },
    ])

    const select = composerOf(node).querySelector<HTMLSelectElement>('select[name=model]')
    expect(select).not.toBeNull()
    expect([...select!.options].map((o) => o.value)).toEqual(['Careful', 'Fast'])
    expect(select!.value).toBe('Careful')

    select!.value = 'Fast'
    select!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(posted(sent, 'set_session_model')).toEqual({ type: 'set_session_model', name: 'Fast' })
    node.remove()
  })

  it("E2_a_plan_sessions_composer_names_its_current_phases_profile_and_offers_no_switch_there", () => {
    const node = app()

    const composer = composerOf(node)
    expect(composer.querySelector('select[name=model]')).toBeNull()
    expect(composer.querySelector('.model-current')?.textContent).toBe('Claude')
    node.remove()
  })

  it('B14_the_effort_levels_the_chosen_model_takes_are_offered_and_a_pick_is_sent_as_the_sessions_effort', () => {
    const node = chatApp(THINKERS)
    sent.length = 0

    const select = composerOf(node).querySelector<HTMLSelectElement>('select[name=effort]')!
    expect([...select.options].map((o) => o.value)).toEqual(['', 'low', 'medium', 'high'])

    select.value = 'high'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    expect(posted(sent, 'set_session_effort')).toEqual({ type: 'set_session_effort', effort: 'high' })
    node.remove()
  })

  it('B14_a_model_whose_effort_levels_are_not_known_is_offered_no_effort_switch', () => {
    const node = chatApp([{ name: 'Careful', efforts: [] }])

    expect(composerOf(node).querySelector('select[name=effort]')).toBeNull()
    node.remove()
  })

  it('B15_the_switch_rests_on_the_models_own_default_until_a_level_is_picked_and_going_back_to_it_sends_no_level', () => {
    const node = chatApp(THINKERS, 'high')
    sent.length = 0
    const select = composerOf(node).querySelector<HTMLSelectElement>('select[name=effort]')!
    expect(select.value).toBe('high')

    select.value = ''
    select.dispatchEvent(new Event('change', { bubbles: true }))

    expect(posted(sent, 'set_session_effort')).toEqual({ type: 'set_session_effort' })
    node.remove()
  })

  it('E3_a_plan_phase_shows_the_effort_its_profile_sets_as_text_beside_the_profile_name', () => {
    const node = app([{ ...planRun(), effort: 'high', events: [] }])

    const composer = composerOf(node)
    expect(composer.querySelector('select[name=effort]')).toBeNull()
    expect(composer.querySelector('.effort-current')?.textContent?.trim()).toBe('high effort')
    node.remove()
  })
})
