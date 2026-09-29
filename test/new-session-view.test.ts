// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PickUp } from '../src/chat/webview/new-session-view'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { NewSessionView } = await import('../src/chat/webview/new-session-view')
// The card's row is only ever reached through the DOM, so the element has to be defined here too.
const { LinkedFilesRow } = await import('../src/chat/webview/linked-files-row')
const events = await import('../src/chat/webview/events')

const NOTHING: PickUp = { plans: [], chats: [], unfiled: 0 }

function view(profiles = { names: ['Claude', 'Kimi'], active: 'Claude' }, pickUp: PickUp = NOTHING) {
  const node = new NewSessionView()
  document.body.appendChild(node)
  node.update(profiles, pickUp)
  return node
}

const options = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent)

const card = (node: HTMLElement, name: 'chat' | 'plan' | 'docs') =>
  [...node.querySelectorAll<HTMLButtonElement>('.types button')][{ chat: 0, plan: 1, docs: 2 }[name]]!

function type(node: HTMLElement, selector: string, text: string): void {
  const field = node.querySelector<HTMLTextAreaElement>(selector)!
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('NewSessionView profile picker', () => {
  it('lists_every_profile_with_the_default_selected', () => {
    const node = view({ names: ['Claude', 'Kimi'], active: 'Kimi' })
    const profile = node.querySelector<HTMLSelectElement>('select[name=profile]')!
    expect(options(profile)).toEqual(['Claude', 'Kimi'])
    expect(profile.value).toBe('Kimi')
    node.remove()
  })

  it('picking_a_profile_dispatches_its_name', () => {
    const node = view()
    let seen: unknown
    node.addEventListener(events.DefaultProfileChangedEvent.type, (e) => (seen = e.name))
    const profile = node.querySelector<HTMLSelectElement>('select[name=profile]')!
    profile.value = 'Kimi'
    profile.dispatchEvent(new Event('change', { bubbles: true }))
    expect(seen).toBe('Kimi')
    node.remove()
  })

  it('a_changed_default_moves_the_selection_on_the_next_state', () => {
    const node = view()
    node.update({ names: ['Claude', 'Kimi'], active: 'Kimi' }, NOTHING)
    expect(node.querySelector<HTMLSelectElement>('select[name=profile]')!.value).toBe('Kimi')
    node.remove()
  })
})

describe('NewSessionView fields across cards', () => {
  it('the_prompt_typed_on_one_card_is_still_there_after_switching_to_the_other', () => {
    const node = view()
    type(node, '.chat-fields textarea[name=prompt]', 'Cancel an order after dispatch')
    card(node, 'plan').click()
    expect(node.querySelector<HTMLTextAreaElement>('.plan-fields textarea[name=prompt]')!.value).toBe(
      'Cancel an order after dispatch',
    )
    type(node, '.plan-fields input[name=feature]', 'Order cancellation')
    card(node, 'chat').click()
    card(node, 'plan').click()
    expect(node.querySelector<HTMLInputElement>('.plan-fields input[name=feature]')!.value).toBe('Order cancellation')
    node.remove()
  })

  it('a_render_from_arriving_state_keeps_what_is_half_typed', () => {
    const node = view()
    type(node, '.chat-fields textarea[name=prompt]', 'half a thou')
    node.update({ names: ['Claude'], active: 'Claude' }, NOTHING)
    expect(node.querySelector<HTMLTextAreaElement>('.chat-fields textarea[name=prompt]')!.value).toBe('half a thou')
    node.remove()
  })

  it('starting_a_session_empties_the_fields_so_the_next_one_does_not_repeat_the_prompt', () => {
    const node = view()
    card(node, 'plan').click()
    type(node, '.plan-fields input[name=feature]', 'Order cancellation')
    type(node, '.plan-fields textarea[name=prompt]', 'As a buyer I want to cancel')
    let seen: unknown
    node.addEventListener(events.NewSessionRequestedEvent.type, (e) => (seen = [e.mode, e.feature, e.prompt]))
    node.querySelector('.plan-fields')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(seen).toEqual(['plan', 'Order cancellation', 'As a buyer I want to cancel'])
    expect(node.querySelector<HTMLInputElement>('.plan-fields input[name=feature]')!.value).toBe('')
    expect(node.querySelector<HTMLTextAreaElement>('.plan-fields textarea[name=prompt]')!.value).toBe('')
    card(node, 'chat').click()
    expect(node.querySelector<HTMLTextAreaElement>('.chat-fields textarea[name=prompt]')!.value).toBe('')
    node.remove()
  })

  it('the_docs_card_starts_a_session_that_belongs_to_no_feature_and_takes_no_prompt', () => {
    const node = view()
    card(node, 'docs').click()
    // Nothing to fill in: the evaluation sweeps the docs, it is not aimed at anything.
    expect(node.querySelector('.docs-fields input, .docs-fields textarea')).toBeNull()
    let seen: unknown
    node.addEventListener(events.NewSessionRequestedEvent.type, (e) => (seen = [e.mode, e.feature, e.prompt, e.files]))
    node.querySelector('.docs-fields')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(seen).toEqual(['docs', undefined, undefined, []])
    node.remove()
  })

  it('the_docs_card_links_no_files_because_the_evaluation_may_not_read_one', () => {
    const node = view()
    card(node, 'docs').click()
    expect(node.querySelector('.docs-fields linked-files-row')).toBeNull()
    node.remove()
  })

  it('the_plan_card_links_files_too_so_a_doc_or_a_spec_can_be_named_for_the_planner', () => {
    const node = view()
    card(node, 'plan').click()
    type(node, '.plan-fields input[name=feature]', 'Order cancellation')
    type(node, '.plan-fields textarea[name=prompt]', 'As a buyer I want to cancel')
    const row = node.querySelector('.plan-fields linked-files-row') as InstanceType<typeof LinkedFilesRow>
    row.link('docs/intent/orders.md')
    let files: string[] | undefined
    node.addEventListener(events.NewSessionRequestedEvent.type, (e) => (files = e.files))
    node.querySelector('.plan-fields')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(files).toEqual(['docs/intent/orders.md'])
    node.remove()
  })

  it('the_button_that_links_a_file_stands_beside_the_one_that_starts_the_session', () => {
    const node = view()
    const submit = node.querySelector('.chat-fields .submit')!
    expect([...submit.children].map((c) => c.tagName.toLowerCase())).toEqual(['button', 'linked-files-row'])
    node.remove()
  })

  it('starting_a_chat_lets_go_of_the_files_linked_for_it', () => {
    const node = view()
    const row = node.querySelector('.chat-fields linked-files-row') as InstanceType<typeof LinkedFilesRow>
    row.link('src/orders/cancel.ts')
    let files: string[] | undefined
    node.addEventListener(events.NewSessionRequestedEvent.type, (e) => (files = e.files))
    node.querySelector('.chat-fields')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(files).toEqual(['src/orders/cancel.ts'])
    expect(row.paths).toEqual([])
    node.remove()
  })
})

const picks = (node: HTMLElement) => [...node.querySelectorAll<HTMLButtonElement>('.pick-up .pick')]

describe('NewSessionView pick-up list', () => {
  const waiting = {
    plans: [{ feature: 'Orders', status: 'approved' as const }],
    chats: [{ sessionId: 's9', title: 'Why does the cart double-count?', startedAt: '2026-01-02T10:00:00.000Z' }],
    unfiled: 2,
  }

  it('nothing_to_pick_up_leaves_the_screen_to_the_cards_alone', () => {
    const node = view()
    expect(node.querySelector('.pick-up')).toBeNull()
    node.remove()
  })

  it('every_piece_of_work_left_on_disk_is_offered', () => {
    const node = view(undefined, waiting)
    expect(picks(node).map((p) => p.querySelector('strong')!.textContent)).toEqual([
      '2 unfiled decisions',
      'Orders',
      'Why does the cart double-count?',
    ])
    node.remove()
  })

  it('picking_a_plan_asks_for_it_by_feature', () => {
    const node = view(undefined, waiting)
    let seen: unknown
    node.addEventListener(events.PlanResumeRequestedEvent.type, (e) => (seen = e.feature))
    picks(node)[1]!.click()
    expect(seen).toBe('Orders')
    node.remove()
  })

  it('picking_a_closed_chat_reopens_that_session_rather_than_starting_one', () => {
    const node = view(undefined, waiting)
    let seen: unknown
    node.addEventListener(events.SessionSelectedEvent.type, (e) => (seen = e.sessionId))
    picks(node)[2]!.click()
    expect(seen).toBe('s9')
    node.remove()
  })

  it('picking_the_unfiled_decisions_starts_the_session_that_files_them', () => {
    const node = view(undefined, waiting)
    let seen: unknown
    node.addEventListener(events.NewSessionRequestedEvent.type, (e) => (seen = e.mode))
    picks(node)[0]!.click()
    expect(seen).toBe('file-decisions')
    node.remove()
  })
})
