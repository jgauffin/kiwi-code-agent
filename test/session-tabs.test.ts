// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ResumablePlan, SessionTab } from '../src/chat/protocol'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { SessionTabs } = await import('../src/chat/webview/session-tabs')
const events = await import('../src/chat/webview/events')

const TABS: SessionTab[] = [{ id: 's1', title: 'Orders', mode: 'plan', profileName: 'Claude', status: 'idle', active: true }]

function bar(plans: ResumablePlan[] = [{ feature: 'Order cancellation', status: 'draft' }]) {
  const node = new SessionTabs()
  document.body.appendChild(node)
  node.update(TABS, false, plans)
  return node
}

const opener = (node: HTMLElement) => node.querySelector<HTMLButtonElement>('.menu .old')!
const plans = (node: HTMLElement) => [...node.querySelectorAll<HTMLButtonElement>('.menu .plan')]

describe('SessionTabs resume menu', () => {
  it('the_plans_stay_out_of_the_way_until_the_icon_is_clicked', () => {
    const node = bar()
    expect(node.querySelector('.menu .plans')).toBeNull()

    opener(node).click()

    expect(plans(node).map((p) => p.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Order cancellation draft: review, check or approve',
    ])
    node.remove()
  })

  it('picking_a_plan_asks_for_it_and_closes_the_menu', () => {
    const node = bar()
    let seen: unknown
    node.addEventListener(events.PlanResumeRequestedEvent.type, (e) => (seen = e.feature))

    opener(node).click()
    plans(node)[0]!.click()

    expect(seen).toBe('Order cancellation')
    expect(node.querySelector('.menu .plans')).toBeNull()
    node.remove()
  })

  it('a_click_past_the_open_menu_closes_it', () => {
    const node = bar()
    opener(node).click()

    document.body.click()

    expect(node.querySelector('.menu .plans')).toBeNull()
    node.remove()
  })

  it('state_arriving_while_the_menu_is_open_leaves_it_open', () => {
    const node = bar()
    opener(node).click()

    node.update(TABS, false, [{ feature: 'Order cancellation', status: 'approved' }])

    expect(plans(node)[0]!.classList.contains('approved')).toBe(true)
    node.remove()
  })

  it('with_nothing_to_pick_up_the_menu_says_so_rather_than_showing_empty', () => {
    const node = bar([])
    opener(node).click()

    expect(node.querySelector('.menu .empty')!.textContent).toContain('No plan under plan/')
    node.remove()
  })
})
