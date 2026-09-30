// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PlanState, RunControls, ToWebview } from '../src/chat/protocol'
import type { SessionEvent } from '../src/agent/session/code-session'
import { planState } from './plan-state-fixture'

const sent: unknown[] = []
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => sent.push(m), setState: () => {} })

const { ChatApp } = await import('../src/chat/webview/chat-app')

const PLAN = 'p'
const TASK_A = 'ta'
const TASK_B = 'tb'
const CLEANUP = 'c'

const run = (sessionId: string, over: Partial<RunControls>): RunControls => ({ sessionId, mode: 'plan', title: sessionId, profileName: 'Claude', live: false, settled: false, ...over })
const planner = (over: Partial<RunControls> = {}) => run(PLAN, { title: 'Plan: Orders', ...over })
const task = (sessionId: string, name: string, over: Partial<RunControls> = {}) => run(sessionId, { mode: 'implement', title: `Task: ${name}`, task: name, ...over })
const cleanup = (over: Partial<RunControls> = {}) => run(CLEANUP, { mode: 'cleanup', title: 'Cleanup: Orders', ...over })

const implementing: Partial<PlanState> = { stage: 'under_development', status: 'approved' }
const cleaning: Partial<PlanState> = { stage: 'verified', status: 'implemented' }

const send = (message: ToWebview) => window.dispatchEvent(new MessageEvent('message', { data: message }))

function state(at: Partial<PlanState> | undefined, runs: RunControls[]): Extract<ToWebview, { type: 'state' }> {
  return {
    type: 'state',
    tab: { id: runs[0]!.sessionId, title: 'Orders', mode: runs[0]!.mode, profileName: 'Claude', status: 'idle' },
    runs,
    ...(at ? { plan: planState(at) } : {}),
    plans: [],
    chats: [],
    unfiled: 0,
    profiles: { names: ['Claude'], active: 'Claude' },
    models: [],
  }
}

function app(at: Partial<PlanState> | undefined, runs: RunControls[], events: Record<string, SessionEvent[]> = {}) {
  const node = new ChatApp()
  document.body.appendChild(node)
  send(state(at, runs))
  send({ type: 'transcript', sessionId: runs[0]!.sessionId, runs: runs.map((r) => ({ ...r, events: events[r.sessionId] ?? [] })) })
  sent.length = 0
  return node
}

const said = (text: string): SessionEvent => ({ type: 'assistant_message', messageId: text, text })
const openChat = (node: HTMLElement) => [...node.querySelectorAll<HTMLElement>('.plan-tabs .tab')].find((t) => t.textContent?.startsWith('Chat'))!.click()
const step = (node: HTMLElement, label: string) => [...node.querySelectorAll<HTMLElement>('.plan-bar .step')].find((s) => s.textContent === label)!
const chat = (node: HTMLElement) => node.querySelector<HTMLElement>('.phase-chat:not([hidden])')!
const shownRuns = (node: HTMLElement) => [...chat(node).querySelectorAll<HTMLElement>('.run:not([hidden])')].map((s) => s.dataset.session)
const switchTo = (node: HTMLElement, sessionId: string) => chat(node).querySelector<HTMLButtonElement>(`.run-switch button[data-session="${sessionId}"]`)!.click()
const recipient = (node: HTMLElement) => node.querySelector('chat-composer .recipient')?.textContent
const textarea = (node: HTMLElement) => node.querySelector<HTMLTextAreaElement>('chat-composer textarea')!

function submit(node: HTMLElement, text: string): Record<string, unknown> | undefined {
  textarea(node).value = text
  node.querySelector('chat-composer form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  return sent.find((m): m is Record<string, unknown> => (m as { type?: string }).type === 'send')
}

describe('the chat follows the phase picked on the stepper', () => {
  it('picking_plan_while_a_task_builds_shows_the_planner_and_sends_to_it', () => {
    const node = app(implementing, [planner(), task(TASK_A, 'A', { live: true })], { [PLAN]: [said('the spec is written')] })
    openChat(node)
    expect(shownRuns(node)).toEqual([TASK_A])

    step(node, 'Plan').click()

    expect(shownRuns(node)).toEqual([PLAN])
    expect(chat(node).textContent).toContain('the spec is written')
    expect(recipient(node)).toBe('To: planner')
    expect(submit(node, 'why this rule?')).toMatchObject({ sessionId: PLAN, text: 'why this rule?' })
    node.remove()
  })

  it('picking_a_step_while_the_chat_is_open_keeps_the_chat_open', () => {
    const node = app(implementing, [planner(), task(TASK_A, 'A', { live: true })])
    openChat(node)

    step(node, 'Plan').click()

    expect(node.querySelector('.plan-tabs .tab.active')?.textContent).toBe('Chat · Plan')
    node.remove()
  })

  it('a_run_of_another_phase_that_speaks_marks_its_step_instead_of_taking_over', () => {
    const node = app(implementing, [planner(), task(TASK_A, 'A', { live: true })])
    openChat(node)

    send({ type: 'event', sessionId: PLAN, run: planner(), event: said('a late thought') })

    expect(shownRuns(node)).toEqual([TASK_A])
    expect(step(node, 'Plan').classList.contains('moved')).toBe(true)
    node.remove()
  })

  it('a_question_in_another_phase_opens_that_phases_chat_on_the_card', () => {
    const question: SessionEvent = { type: 'question_request', requestId: 'q1', request: { questions: [{ question: 'Which?', header: 'Q', options: [], multiSelect: false }] } as never }
    const node = app({ ...implementing, blocked: { on: 'answer', mode: 'plan' } }, [planner(), task(TASK_A, 'A', { live: true })], { [PLAN]: [question] })

    node.querySelector<HTMLButtonElement>('.plan-bar .next.goto')!.click()

    expect(shownRuns(node)).toEqual([PLAN])
    expect(step(node, 'Plan').classList.contains('selected')).toBe(true)
    node.remove()
  })
})

describe('the implement chat names the task it talks to', () => {
  it('the_task_being_built_is_the_one_typed_to', () => {
    const node = app(implementing, [planner(), task(TASK_A, 'A'), task(TASK_B, 'B', { live: true })])
    openChat(node)

    expect(shownRuns(node)).toEqual([TASK_B])
    expect(recipient(node)).toBe('To: task B')
    expect(submit(node, 'go on')).toMatchObject({ sessionId: TASK_B })
    node.remove()
  })

  it('picking_another_task_in_the_switcher_sends_to_that_task_alone', () => {
    const node = app(implementing, [planner(), task(TASK_A, 'A'), task(TASK_B, 'B', { live: true })])
    openChat(node)

    switchTo(node, TASK_A)

    expect(shownRuns(node)).toEqual([TASK_A])
    expect(recipient(node)).toBe('To: task A')
    expect(submit(node, 'what blocked you?')).toMatchObject({ sessionId: TASK_A })
    node.remove()
  })

  it('a_task_run_starting_never_takes_the_pick_away_from_the_reader', () => {
    const runs = [planner(), task(TASK_A, 'A'), task(TASK_B, 'B', { live: true })]
    const node = app(implementing, runs)
    openChat(node)
    switchTo(node, TASK_A)

    send(state(implementing, [...runs.slice(0, 2), task(TASK_B, 'B', { settled: true }), task('tc', 'C', { live: true })]))

    expect(recipient(node)).toBe('To: task A')
    expect(chat(node).querySelector('.run-switch button[data-session="tc"]')?.textContent).toContain('building')
    node.remove()
  })

  it('a_settled_task_is_read_but_takes_no_input', () => {
    const node = app(implementing, [planner(), task(TASK_A, 'A', { settled: true })], { [TASK_A]: [said('task A is tested')] })
    openChat(node)

    expect(chat(node).textContent).toContain('task A is tested')
    expect(textarea(node).disabled).toBe(true)
    expect(node.querySelector('chat-composer .refusal')?.textContent).toContain('Task "A" is settled')
    expect(submit(node, 'more')).toBeUndefined()
    node.remove()
  })
})

describe('the cleanup chat', () => {
  it('a_running_cleanup_is_shown_and_typed_to', () => {
    const node = app(cleaning, [planner(), task(TASK_A, 'A', { settled: true }), cleanup({ live: true })])
    openChat(node)

    send({ type: 'event', sessionId: PLAN, run: cleanup({ live: true }), event: said('splitting run()') })

    expect(shownRuns(node)).toEqual([CLEANUP])
    expect(chat(node).textContent).toContain('splitting run()')
    expect(recipient(node)).toBe('To: cleanup')
    expect(submit(node, 'keep parse together')).toMatchObject({ sessionId: CLEANUP })
    node.remove()
  })

  it('a_finished_cleanup_still_takes_input', () => {
    const node = app(cleaning, [planner(), cleanup()])
    openChat(node)

    expect(textarea(node).disabled).toBe(false)
    expect(submit(node, 'split report too')).toMatchObject({ sessionId: CLEANUP })
    node.remove()
  })

  it('with_no_cleanup_run_the_chat_says_what_starts_one', () => {
    const node = app({ ...cleaning, cleanupSweep: { units: [] } }, [planner(), task(TASK_A, 'A', { settled: true })])
    openChat(node)

    expect(chat(node).querySelector('.empty')?.textContent).toContain('No cleanup has run')
    expect(textarea(node).disabled).toBe(true)
    node.remove()
  })
})

describe('a tab with no feature', () => {
  it('sends_to_its_one_session', () => {
    const node = app(undefined, [run('s', { mode: 'chat', title: 'Untitled' })])

    expect(submit(node, 'hello')).toMatchObject({ sessionId: 's', text: 'hello' })
    node.remove()
  })
})
