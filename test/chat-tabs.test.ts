// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PlanState, RunRef, RunSection, ToWebview } from '../src/chat/protocol'
import type { SessionEvent } from '../src/agent/session/code-session'

const sent: unknown[] = []
;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => sent.push(m) })

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
    mappable: true,
    remappable: false,
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
const IMPLEMENT = 's2'

const planRun = (current = true): RunRef => ({ sessionId: SESSION, mode: 'plan', title: 'Plan: Orders', current })
const implementRun = (current = true): RunRef => ({ sessionId: IMPLEMENT, mode: 'implement', title: 'Implement: Orders', current })

function app(runs: RunSection[] = [{ ...planRun(), events: [] }]) {
  const node = new ChatApp()
  document.body.appendChild(node)
  send({
    type: 'state',
    tabs: [{ id: SESSION, title: 'Orders', mode: 'plan', profileName: 'Claude', status: 'idle', active: true }],
    plan: plan(),
    plans: [],
    profiles: { names: ['Claude'], active: 'Claude' },
    models: [],
  })
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
      { ...implementRun(), events: [] },
    ])
    tab(node, 'Chat').click()

    expect(sections(node).map((s) => s.querySelector('.run-head')?.textContent)).toEqual(['Plan: Orders', 'Implement: Orders'])
    expect(sections(node).map((s) => s.open)).toEqual([false, true])
    node.remove()
  })

  it('an_event_lands_in_the_run_that_sent_it_and_marks_that_run_when_it_is_folded_away', () => {
    const node = app([
      { ...planRun(false), events: [] },
      { ...implementRun(), events: [] },
    ])
    tab(node, 'Chat').click()

    event(speaking, planRun(false))

    expect(section(node, SESSION).classList.contains('moved')).toBe(true)
    expect(section(node, SESSION).querySelector('.transcript')!.textContent).toContain('working')
    expect(section(node, IMPLEMENT).querySelector('.transcript')!.textContent).not.toContain('working')
    node.remove()
  })

  it('a_run_that_starts_while_the_tab_is_open_takes_the_floor', () => {
    const node = app()
    tab(node, 'Chat').click()

    event(speaking, implementRun())

    expect(sections(node).map((s) => s.dataset.session)).toEqual([SESSION, IMPLEMENT])
    expect(section(node, IMPLEMENT).open).toBe(true)
    expect(section(node, SESSION).open).toBe(false)
    node.remove()
  })

  it('an_answer_is_addressed_to_the_run_that_asked', () => {
    const node = app([
      { ...planRun(false), events: [] },
      { ...implementRun(), events: [] },
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

function posted(sent: unknown[], type: string): Record<string, unknown> | undefined {
  return sent.find((m): m is Record<string, unknown> => typeof m === 'object' && m !== null && (m as { type?: string }).type === type)
}
