// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { PlanState, RunControls, ToWebview } from '../src/chat/protocol'
import type { Task } from '../src/agent/phases/tasks-file'
import { planState } from './plan-state-fixture'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {}, setState: () => {} })

// Test files share a worker, so the module registry is cleared first: what
// loads here is this file's own, bound to its stub and its document.
vi.resetModules()

const { ChatApp } = await import('../src/chat/webview/chat-app')

const PLAN = 'p'
const planner: RunControls = { sessionId: PLAN, mode: 'plan', title: 'Plan: Orders', profileName: 'Claude', live: false, settled: false }

const task = (state: Task['state']): Task => ({
  name: 'Cancel',
  text: '',
  delivers: [],
  files: [],
  newFiles: [],
  foreignFiles: [],
  context: [],
  how: '',
  proves: [],
  note: '',
  built: '',
  state,
  removed: false,
})

const building: Partial<PlanState> = { stage: 'under_development', status: 'approved', commentable: false, tasks: [task('in_progress')] }
const verified: Partial<PlanState> = { stage: 'verified', status: 'approved', commentable: false, tasks: [task('tested')] }

const send = (message: ToWebview) => window.dispatchEvent(new MessageEvent('message', { data: message }))

const state = (at: Partial<PlanState>): ToWebview => ({
  type: 'state',
  tab: { id: PLAN, title: 'Orders', mode: 'plan', access: 'scoped', profileName: 'Claude', status: 'idle' },
  runs: [planner],
  plan: planState(at),
  plans: [],
  chats: [],
  unfiled: 0,
  profiles: { names: ['Claude'], active: 'Claude' },
  models: [],
})

const openTab = (node: HTMLElement) => node.querySelector('.plan-tabs .tab.active')?.textContent
const pickTab = (node: HTMLElement, label: string) => [...node.querySelectorAll<HTMLElement>('.plan-tabs .tab')].find((t) => t.textContent === label)!.click()

function app(at: Partial<PlanState>): HTMLElement {
  const node = new ChatApp()
  document.body.appendChild(node)
  send(state(at))
  send({ type: 'transcript', sessionId: PLAN, runs: [{ ...planner, events: [] }] })
  return node
}

describe('the open tab follows the step', () => {
  it('the_cleanup_page_opens_when_the_tests_pass_on_a_reader_watching_the_build', () => {
    const node = app(building)
    expect(openTab(node)).toBe('Tasks (0 of 1)')

    send(state(verified))

    expect(openTab(node)).toBe('Cleanup')
    node.remove()
  })

  it('a_reader_who_opened_another_tab_is_left_reading_it', () => {
    const node = app(building)
    pickTab(node, 'Spec')

    send(state(verified))

    expect(openTab(node)).toBe('Spec')
    node.remove()
  })
})
