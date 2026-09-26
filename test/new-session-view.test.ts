// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { NewSessionView } = await import('../src/chat/webview/new-session-view')
// The card's row is only ever reached through the DOM, so the element has to be defined here too.
const { LinkedFilesRow } = await import('../src/chat/webview/linked-files-row')
const events = await import('../src/chat/webview/events')

function view(profiles = { names: ['Claude', 'Kimi'], active: 'Claude', plan: '' }) {
  const node = new NewSessionView()
  document.body.appendChild(node)
  node.update([], profiles)
  return node
}

const options = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent)

const card = (node: HTMLElement, name: 'chat' | 'plan' | 'resume' | 'docs') =>
  [...node.querySelectorAll<HTMLButtonElement>('.types button')][{ chat: 0, plan: 1, resume: 2, docs: 3 }[name]]!

function type(node: HTMLElement, selector: string, text: string): void {
  const field = node.querySelector<HTMLTextAreaElement>(selector)!
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('NewSessionView model pickers', () => {
  it('lists_every_profile_with_the_defaults_selected', () => {
    const node = view({ names: ['Claude', 'Kimi'], active: 'Kimi', plan: 'Claude' })
    const work = node.querySelector<HTMLSelectElement>('select[name=work]')!
    const plan = node.querySelector<HTMLSelectElement>('select[name=plan]')!
    expect(options(work)).toEqual(['Claude', 'Kimi'])
    expect(work.value).toBe('Kimi')
    expect(options(plan)).toEqual(['Same as model', 'Claude', 'Kimi'])
    expect(plan.value).toBe('Claude')
    node.remove()
  })

  it('an_empty_plan_profile_reads_as_same_as_model', () => {
    const node = view()
    expect(node.querySelector<HTMLSelectElement>('select[name=plan]')!.value).toBe('')
    node.remove()
  })

  it('picking_a_profile_dispatches_the_role_and_name', () => {
    const node = view()
    let seen: unknown
    node.addEventListener(events.DefaultProfileChangedEvent.type, (e) => (seen = [e.role, e.name]))
    const plan = node.querySelector<HTMLSelectElement>('select[name=plan]')!
    plan.value = 'Kimi'
    plan.dispatchEvent(new Event('change', { bubbles: true }))
    expect(seen).toEqual(['plan', 'Kimi'])
    node.remove()
  })

  it('a_changed_default_moves_the_selection_on_the_next_state', () => {
    const node = view()
    node.update([], { names: ['Claude', 'Kimi'], active: 'Kimi', plan: '' })
    expect(node.querySelector<HTMLSelectElement>('select[name=work]')!.value).toBe('Kimi')
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
    node.update([{ feature: 'Order cancellation', status: 'draft' }], { names: ['Claude'], active: 'Claude', plan: '' })
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
