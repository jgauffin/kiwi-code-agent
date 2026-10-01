// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PlanState, RunRef, RunSection, ToWebview } from '../src/chat/protocol'
import type { SessionEvent } from '../src/agent/session/code-session'

const sent: unknown[] = []
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => sent.push(m), setState: () => {} })

const { ChatApp } = await import('../src/chat/webview/chat-app')

function plan(): PlanState {
  return {
    specPath: 'plan/orders.spec.md',
    tasksPath: 'plan/orders.tasks.md',
    decisionsPath: 'plan/orders.decisions.md',
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
    phaseProfiles: [],
  }
}

const SESSION = 's1'
const CHECK = 's2'
const IMPLEMENT = 's6'

const planRun = (current = true): RunRef => ({ sessionId: SESSION, mode: 'plan', title: 'Plan: Orders', current })
const checkRun = (current = true): RunRef => ({ sessionId: CHECK, mode: 'reconcile', title: 'Check: Orders', current })
const implementRun = (current = true): RunRef => ({ sessionId: IMPLEMENT, mode: 'implement', title: 'Implement: Orders', current })

const state = (): Extract<ToWebview, { type: 'state' }> => ({
  type: 'state',
  tab: { id: SESSION, title: 'Orders', mode: 'plan', profileName: 'Claude', status: 'idle' },
  plan: plan(),
  plans: [],
  chats: [],
  unfiled: 0,
  profiles: { names: ['Claude'], active: 'Claude' },
  models: [],
})

function app(runs: RunSection[] = [{ ...planRun(), events: [] }]) {
  const node = new ChatApp()
  document.body.appendChild(node)
  send(state())
  send({ type: 'transcript', sessionId: SESSION, runs })
  return node
}

const send = (message: ToWebview) => window.dispatchEvent(new MessageEvent('message', { data: message }))
const event = (e: SessionEvent, run: RunRef = planRun()) => send({ type: 'event', sessionId: SESSION, run, event: e })

const tab = (node: HTMLElement, name: string) =>
  [...node.querySelectorAll<HTMLElement>('.plan-tabs .tab')].find((t) => t.textContent === name)!
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

    expect(active(node)).toBe('Chat')
    expect(tab(node, 'Chat').classList.contains('moved')).toBe(false)
    node.remove()
  })

  it('nothing_is_marked_while_the_reader_is_already_watching_the_chat', () => {
    const node = app()
    tab(node, 'Chat').click()

    event(speaking)

    expect(active(node)).toBe('Chat')
    expect(tab(node, 'Chat').classList.contains('moved')).toBe(false)
    node.remove()
  })
})

const sections = (node: HTMLElement) => [...node.querySelectorAll<HTMLDetailsElement>('.runs > .run')]
const section = (node: HTMLElement, sessionId: string) => node.querySelector<HTMLDetailsElement>(`.run[data-session="${sessionId}"]`)!

describe('the runs of one feature under one tab', () => {
  it('every_run_has_its_own_conversation_and_only_the_current_one_is_open', () => {
    const node = app([
      { ...planRun(false), events: [] },
      { ...checkRun(), events: [] },
    ])
    tab(node, 'Chat').click()

    expect(sections(node).map((s) => s.querySelector('.run-head')?.textContent)).toEqual(['Plan: Orders', 'Check: Orders'])
    expect(sections(node).map((s) => s.open)).toEqual([false, true])
    node.remove()
  })

  it('an_event_lands_in_the_run_that_sent_it_and_marks_that_run_when_it_is_folded_away', () => {
    const node = app([
      { ...planRun(false), events: [] },
      { ...checkRun(), events: [] },
    ])
    tab(node, 'Chat').click()

    event(speaking, planRun(false))

    expect(section(node, SESSION).classList.contains('moved')).toBe(true)
    expect(section(node, SESSION).querySelector('.transcript')!.textContent).toContain('working')
    expect(section(node, CHECK).querySelector('.transcript')!.textContent).not.toContain('working')
    node.remove()
  })

  it('a_run_that_starts_while_the_tab_is_open_takes_the_floor', () => {
    const node = app()
    tab(node, 'Chat').click()

    event(speaking, checkRun())

    expect(sections(node).map((s) => s.dataset.session)).toEqual([SESSION, CHECK])
    expect(section(node, CHECK).open).toBe(true)
    expect(section(node, SESSION).open).toBe(false)
    node.remove()
  })

  it('the_run_the_host_says_takes_typing_is_the_only_one_open', () => {
    const node = app([
      { ...planRun(false), events: [] },
      { ...checkRun(), events: [] },
    ])
    tab(node, 'Chat').click()

    // The check closed without a last word: the state alone says the planner has the floor again.
    send({ ...state(), currentRun: SESSION })

    expect(sections(node).map((s) => s.open)).toEqual([true, false])
    expect(section(node, SESSION).classList.contains('current')).toBe(true)
    node.remove()
  })

  it('reading_an_earlier_run_is_not_folded_away_while_the_current_one_streams', () => {
    const node = app([
      { ...planRun(false), events: [] },
      { ...checkRun(), events: [] },
    ])
    tab(node, 'Chat').click()
    section(node, SESSION).open = true

    event(speaking, checkRun())

    expect(section(node, SESSION).open).toBe(true)
    node.remove()
  })

  it('an_answer_is_addressed_to_the_run_that_asked', () => {
    const node = app([
      { ...planRun(false), events: [] },
      { ...checkRun(), events: [] },
    ])
    tab(node, 'Chat').click()
    sent.length = 0

    event({ type: 'permission_request', requestId: 'r1', toolUseId: 't1', toolName: 'Write', input: { file_path: 'a.ts' } }, planRun(false))
    section(node, SESSION).querySelector<HTMLButtonElement>('button')!.click()

    // The card sits in the planner's section, so the decision goes there and not to the run holding the floor.
    expect(posted(sent, 'permission')).toMatchObject({ sessionId: SESSION, requestId: 'r1' })
    node.remove()
  })
})

describe('the chat holds the conversations of the step the flow is at', () => {
  const TASK_1 = 's3'
  const TASK_2 = 's4'
  const CLEANUP = 's5'
  const taskRun = (sessionId: string, current: boolean): RunRef => ({ sessionId, mode: 'implement', title: `Task ${sessionId}`, current })
  const cleanupRun = (current = false): RunRef => ({ sessionId: CLEANUP, mode: 'cleanup', title: 'Cleanup: Orders', current })
  const shown = (node: HTMLElement) => sections(node).filter((s) => !s.hidden).map((s) => s.dataset.session)

  function appAt(at: Partial<PlanState>, runs: RunSection[]) {
    const node = new ChatApp()
    document.body.appendChild(node)
    send({ ...state(), plan: { ...plan(), ...at } })
    send({ type: 'transcript', sessionId: SESSION, runs })
    return node
  }

  const implementing: Partial<PlanState> = { stage: 'under_development', status: 'approved' }
  const cleaning: Partial<PlanState> = { stage: 'verified', status: 'implemented' }

  it('cleanup_shows_only_the_refactorings', () => {
    const node = appAt(cleaning, [
      { ...planRun(false), events: [] },
      { ...implementRun(true), events: [] },
      { ...cleanupRun(), events: [] },
    ])
    tab(node, 'Chat').click()

    expect(shown(node)).toEqual([CLEANUP])
    node.remove()
  })

  it('implementation_shows_the_tasks_with_only_the_running_one_open', () => {
    const node = appAt(implementing, [
      { ...planRun(false), events: [] },
      { ...checkRun(false), events: [] },
      { ...implementRun(false), events: [] },
      { ...taskRun(TASK_1, false), events: [] },
      { ...taskRun(TASK_2, true), events: [] },
    ])
    tab(node, 'Chat').click()

    expect(shown(node)).toEqual([IMPLEMENT, TASK_1, TASK_2])
    expect(sections(node).filter((s) => !s.hidden).map((s) => s.open)).toEqual([false, false, true])
    node.remove()
  })

  it('opening_the_chat_again_folds_what_the_reader_opened_back_to_the_running_task', () => {
    const node = appAt(implementing, [
      { ...taskRun(TASK_1, false), events: [] },
      { ...taskRun(TASK_2, true), events: [] },
    ])
    tab(node, 'Chat').click()
    section(node, TASK_1).open = true

    tab(node, 'Spec').click()
    tab(node, 'Chat').click()

    expect(section(node, TASK_1).open).toBe(false)
    expect(section(node, TASK_2).open).toBe(true)
    node.remove()
  })

  it('a_run_outside_the_step_that_speaks_is_shown_so_nobody_answers_into_a_hidden_conversation', () => {
    const node = appAt(cleaning, [
      { ...implementRun(true), events: [] },
      { ...cleanupRun(), events: [] },
    ])
    tab(node, 'Chat').click()
    expect(shown(node)).toEqual([CLEANUP])

    event(speaking, implementRun(true))

    expect(shown(node)).toEqual([IMPLEMENT, CLEANUP])
    node.remove()
  })

  it('a_step_with_no_conversation_of_its_own_shows_the_run_that_takes_typing', () => {
    const node = appAt(cleaning, [
      { ...planRun(false), events: [] },
      { ...implementRun(true), events: [] },
    ])
    tab(node, 'Chat').click()

    expect(shown(node)).toEqual([IMPLEMENT])
    node.remove()
  })
})

function posted(sent: unknown[], type: string): Record<string, unknown> | undefined {
  return sent.find((m): m is Record<string, unknown> => typeof m === 'object' && m !== null && (m as { type?: string }).type === type)
}

describe("the composer's model switch follows the session it belongs to", () => {
  const composerOf = (node: HTMLElement) => node.querySelector('chat-composer')!

  it('B9_a_chat_sessions_composer_offers_every_registered_model_switchable_at_any_point_independent_of_any_features_phase_choices', () => {
    const node = new ChatApp()
    document.body.appendChild(node)
    send({
      ...state(),
      tab: { id: SESSION, title: 'Untitled', mode: 'chat', profileName: 'Careful', status: 'idle' },
      plan: undefined,
      models: [
        { name: 'Careful', engine: 'claude-sdk', model: 'opus' },
        { name: 'Fast', engine: 'claude-sdk', model: 'sonnet' },
      ],
    })
    send({ type: 'transcript', sessionId: SESSION, runs: [] })

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
})
