// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { NewSessionView } = await import('../src/chat/webview/new-session-view')
const events = await import('../src/chat/webview/events')

function view(profiles = { names: ['Claude', 'Kimi'], active: 'Claude', plan: '' }) {
  const node = new NewSessionView()
  document.body.appendChild(node)
  node.update([], profiles)
  return node
}

const options = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent)

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
