// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ResumableChat, ResumablePlan, SessionTab } from '../src/chat/protocol'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { SessionTabs } = await import('../src/chat/webview/session-tabs')
const events = await import('../src/chat/webview/events')

const TABS: SessionTab[] = [{ id: 's1', title: 'Orders', mode: 'plan', profileName: 'Claude', status: 'idle', active: true }]
const PLAN: ResumablePlan = { feature: 'Order cancellation', status: 'draft' }
const CHAT: ResumableChat = { sessionId: 's9', title: 'Why does the importer retry twice', startedAt: '2026-09-27T09:15:00.000Z' }

function bar(plans: ResumablePlan[] = [PLAN], chats: ResumableChat[] = [CHAT], unfiled = 0) {
  const node = new SessionTabs()
  document.body.appendChild(node)
  node.update(TABS, false, { plans, chats, unfiled })
  return node
}

const opener = (node: HTMLElement) => node.querySelector<HTMLButtonElement>('.menu .old')!
const picks = (node: HTMLElement) => [...node.querySelectorAll<HTMLButtonElement>('.menu .pick')]
const names = (node: HTMLElement) => picks(node).map((p) => p.querySelector('strong')!.textContent)

describe('SessionTabs resume menu', () => {
  it('stays_out_of_the_way_until_the_icon_is_clicked', () => {
    const node = bar()
    expect(node.querySelector('.menu .picks')).toBeNull()

    opener(node).click()

    expect(names(node)).toEqual(['Order cancellation', 'Why does the importer retry twice'])
    node.remove()
  })

  it('the_plans_come_before_the_chats_and_each_says_which_it_is', () => {
    const node = bar()
    opener(node).click()

    expect(picks(node).map((p) => p.className)).toEqual(['pick plan draft', 'pick chat'])
    node.remove()
  })

  it('picking_a_plan_asks_for_it_and_closes_the_menu', () => {
    const node = bar()
    let seen: unknown
    node.addEventListener(events.PlanResumeRequestedEvent.type, (e) => (seen = e.feature))

    opener(node).click()
    picks(node)[0]!.click()

    expect(seen).toBe('Order cancellation')
    expect(node.querySelector('.menu .picks')).toBeNull()
    node.remove()
  })

  it('picking_a_chat_switches_to_the_session_it_stands_for', () => {
    const node = bar()
    let seen: unknown
    node.addEventListener(events.SessionSelectedEvent.type, (e) => (seen = e.sessionId))

    opener(node).click()
    picks(node)[1]!.click()

    expect(seen).toBe('s9')
    expect(node.querySelector('.menu .picks')).toBeNull()
    node.remove()
  })

  it('a_click_past_the_open_menu_closes_it', () => {
    const node = bar()
    opener(node).click()

    document.body.click()

    expect(node.querySelector('.menu .picks')).toBeNull()
    node.remove()
  })

  it('state_arriving_while_the_menu_is_open_leaves_it_open', () => {
    const node = bar()
    opener(node).click()

    node.update(TABS, false, { plans: [{ ...PLAN, status: 'approved' }], chats: [CHAT], unfiled: 0 })

    expect(picks(node)[0]!.classList.contains('approved')).toBe(true)
    node.remove()
  })

  it('with_nothing_to_pick_up_the_menu_says_so_rather_than_showing_empty', () => {
    const node = bar([], [])
    opener(node).click()

    expect(node.querySelector('.menu .empty')!.textContent).toContain('Nothing to pick up')
    node.remove()
  })

  it('unfiled_decisions_show_their_count_on_the_closed_menu_and_come_first_when_it_opens', () => {
    const node = bar([PLAN], [], 3)
    expect(opener(node).querySelector('.count')!.textContent).toBe('3')

    opener(node).click()

    expect(names(node)).toEqual(['3 unfiled decisions', 'Order cancellation'])
    node.remove()
  })

  it('picking_the_unfiled_decisions_asks_for_a_filing_session', () => {
    const node = bar([], [], 1)
    let seen: unknown
    node.addEventListener(events.NewSessionRequestedEvent.type, (e) => (seen = e.mode))

    opener(node).click()
    picks(node)[0]!.click()

    expect(seen).toBe('file-decisions')
    expect(node.querySelector('.menu .picks')).toBeNull()
    node.remove()
  })

  it('with_nothing_unfiled_the_menu_shows_no_count', () => {
    const node = bar()
    expect(opener(node).querySelector('.count')).toBeNull()
    node.remove()
  })
})
