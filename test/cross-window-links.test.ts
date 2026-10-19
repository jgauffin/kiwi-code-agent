import { describe, expect, it } from 'vitest'
import { CODE_TTL_MS, type ClockPort } from '../src/remote-control/pairing'
import { PRESENCE_TTL_MS, WindowLinks, emptyLinkState, type LinkStore, type SharedLinkState } from '../src/cross-window/window-links'

function sharedStore(): LinkStore {
  let json = JSON.stringify(emptyLinkState())
  return { read: () => JSON.parse(json) as SharedLinkState, write: (s) => void (json = JSON.stringify(s)) }
}

function fakeClock(): ClockPort & { advance: (ms: number) => void } {
  let now = 1000
  return { now: () => now, advance: (ms) => (now += ms) }
}

function window(store: LinkStore, clock: ClockPort, name: string, modes: Record<string, string> = { s1: 'chat', s2: 'chat' }, local = true) {
  let n = 0
  const links = new WindowLinks(store, { workspaceId: `/ws/${name}`, workspaceName: name }, { modeOf: (id) => modes[id], onLocalMachine: () => local }, clock, () => `${name}-${n++}`)
  links.heartbeat()
  return links
}

function setup() {
  const store = sharedStore()
  const clock = fakeClock()
  return { store, clock, front: window(store, clock, 'front'), back: window(store, clock, 'back') }
}

describe('linking two sessions', () => {
  it('only_a_chat_session_produces_or_accepts_a_code', () => {
    const store = sharedStore()
    const clock = fakeClock()
    const plan = window(store, clock, 'front', { s1: 'plan' })
    const back = window(store, clock, 'back')
    expect(() => plan.requestCode('s1')).toThrow(/chat session/)
    const { code } = back.requestCode('s1')
    expect(() => plan.enterCode('s1', code)).toThrow(/chat session/)
  })

  it('a_code_produced_in_one_window_links_a_chat_session_of_another_when_entered', () => {
    const { front, back } = setup()
    const { code } = front.requestCode('s1')
    expect(back.enterCode('s2', code)).toMatchObject({ state: 'linked', other: { workspaceName: 'front', sessionId: 's1' } })
    expect(front.viewOf('s1')).toMatchObject({ state: 'linked', other: { workspaceName: 'back', sessionId: 's2' } })
  })

  it('a_code_is_spent_after_linking_one_session', () => {
    const store = sharedStore()
    const clock = fakeClock()
    const front = window(store, clock, 'front')
    const back = window(store, clock, 'back')
    const third = window(store, clock, 'third')
    const { code } = front.requestCode('s1')
    back.enterCode('s2', code)
    expect(() => third.enterCode('s1', code)).toThrow(/not valid/)
  })

  it('a_code_nobody_uses_expires_on_its_own', () => {
    const { front, back, clock } = setup()
    const { code } = front.requestCode('s1')
    clock.advance(CODE_TTL_MS)
    expect(() => back.enterCode('s2', code)).toThrow(/expired/)
  })

  it('a_window_on_a_remote_host_refuses_a_code_with_the_reason', () => {
    const store = sharedStore()
    const clock = fakeClock()
    const front = window(store, clock, 'front')
    const remote = window(store, clock, 'remote', undefined, false)
    const { code } = front.requestCode('s1')
    expect(() => remote.enterCode('s2', code)).toThrow(/remote, container or WSL/)
  })

  it('a_code_entered_in_the_workspace_that_produced_it_is_refused_with_the_reason', () => {
    const { front } = setup()
    const { code } = front.requestCode('s1')
    expect(() => front.enterCode('s2', code)).toThrow(/this workspace/)
    expect(front.viewOf('s2').state).toBe('none')
  })

  it('a_linked_session_must_unlink_before_it_takes_another_code', () => {
    const store = sharedStore()
    const clock = fakeClock()
    const front = window(store, clock, 'front')
    const back = window(store, clock, 'back')
    const other = window(store, clock, 'other')
    back.enterCode('s2', front.requestCode('s1').code)
    expect(() => front.requestCode('s1')).toThrow(/already linked/)
    const { code } = other.requestCode('s1')
    expect(() => back.enterCode('s2', code)).toThrow(/already linked/)
    back.unlink('s2')
    expect(back.enterCode('s2', code).state).toBe('linked')
  })

  it('a_link_survives_a_reload_and_shows_disconnected_on_the_other_side_meanwhile', () => {
    const { store, clock, front, back } = setup()
    back.enterCode('s2', front.requestCode('s1').code)
    back.leave()
    expect(front.viewOf('s1').state).toBe('disconnected')
    const reloaded = window(store, clock, 'back')
    expect(reloaded.viewOf('s2').state).toBe('linked')
    expect(front.viewOf('s1').state).toBe('linked')
  })

  it('a_window_not_heard_from_shows_as_disconnected', () => {
    const { front, back, clock } = setup()
    back.enterCode('s2', front.requestCode('s1').code)
    clock.advance(PRESENCE_TTL_MS)
    front.heartbeat()
    expect(front.viewOf('s1').state).toBe('disconnected')
  })

  it('a_message_for_a_disconnected_side_is_refused_with_the_reason', () => {
    const { front, back } = setup()
    back.enterCode('s2', front.requestCode('s1').code)
    expect(front.checkSend('s1')).toMatchObject({ ok: true, target: { sessionId: 's2' } })
    back.leave()
    expect(front.checkSend('s1')).toMatchObject({ ok: false, reason: expect.stringContaining('back') })
  })

  it('either_side_can_unlink_and_both_show_ended_and_cannot_send', () => {
    const { front, back } = setup()
    back.enterCode('s2', front.requestCode('s1').code)
    back.unlink('s2')
    expect(front.viewOf('s1').state).toBe('ended')
    expect(back.viewOf('s2').state).toBe('ended')
    expect(front.checkSend('s1').ok).toBe(false)
    expect(back.checkSend('s2').ok).toBe(false)
  })

  it('a_deleted_linked_session_ends_the_link_and_the_other_side_shows_it_ended', () => {
    const { front, back } = setup()
    back.enterCode('s2', front.requestCode('s1').code)
    front.sessionRemoved('s1')
    expect(back.viewOf('s2').state).toBe('ended')
  })
})
