import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../src/agent/session/code-session'
import { AgentExchange, type Envelope } from '../src/cross-window/agent-exchange'
import { WindowLinks, emptyLinkState, type LinkStore, type SharedLinkState } from '../src/cross-window/window-links'
import type { ClockPort } from '../src/remote-control/pairing'

type Side = { name: string; links: WindowLinks; exchange: AgentExchange; events: SessionEvent[]; turns: string[]; interrupted: number; sessionId: string }

function linkedPair() {
  let json = JSON.stringify(emptyLinkState())
  const store: LinkStore = { read: () => JSON.parse(json) as SharedLinkState, write: (s) => void (json = JSON.stringify(s)) }
  const clock: ClockPort = { now: () => 1000 }
  const inbox: Envelope[] = []
  const sides: Record<string, Side> = {}
  const make = (name: string, sessionId: string): Side => {
    const self = { workspaceId: `/ws/${name}`, workspaceName: name }
    const links = new WindowLinks(store, self, { modeOf: () => 'chat', onLocalMachine: () => true }, clock, () => '123456')
    links.heartbeat()
    const side = { name, links, events: [], turns: [], interrupted: 0, sessionId } as unknown as Side
    side.exchange = new AgentExchange(
      self,
      links,
      { post: (e) => inbox.push(e) },
      {
        record: async (_id, event) => void side.events.push(event),
        inTurn: () => false,
        startTurn: async (_id, text) => void side.turns.push(text),
        interrupt: async () => void side.interrupted++,
      },
      () => 10,
    )
    sides[name] = side
    return side
  }
  const front = make('front', 'f1')
  const back = make('back', 'b1')
  front.links.requestCode('f1')
  back.links.enterCode('b1', '123456')
  const deliver = async () => {
    while (inbox.length) {
      const e = inbox.shift()!
      await (e.to.workspaceName === 'front' ? front : back).exchange.receive(e)
    }
  }
  return { front, back, deliver }
}

describe('pausing to redirect', () => {
  it('pausing_from_either_window_ends_both_agents_turns_and_both_windows_show_it_paused', async () => {
    const { front, back, deliver } = linkedPair()
    await back.exchange.pause('b1')
    await deliver()
    expect(back.interrupted).toBe(1)
    expect(front.interrupted).toBe(1)
    expect(front.links.viewOf('f1')).toMatchObject({ state: 'linked', paused: true })
    expect(back.links.viewOf('b1')).toMatchObject({ state: 'linked', paused: true })
  })

  it('while_paused_a_message_from_one_agent_to_the_other_is_refused_with_the_reason_and_starts_no_turn', async () => {
    const { front, back, deliver } = linkedPair()
    await front.exchange.pause('f1')
    await deliver()
    const outcome = await front.exchange.send('f1', 'carry on')
    await deliver()
    expect(outcome).toEqual({ ok: false, reason: expect.stringContaining('paused') })
    expect(back.turns).toEqual([])
    expect((await back.exchange.send('b1', 'hello')).ok).toBe(false)
    expect(front.turns).toEqual([])
  })

  it('a_message_the_person_writes_while_paused_is_heard_and_starts_turns_as_unpaused', async () => {
    const { front, back, deliver } = linkedPair()
    await front.exchange.pause('f1')
    await deliver()
    // The person's message in the session goes through the manager, which asks the exchange for anything held.
    expect(front.exchange.personSpoke('f1')).toBeUndefined()
    await deliver()
    expect(front.links.viewOf('f1')).toMatchObject({ state: 'linked', paused: true })
    expect(back.events).toEqual([])
  })

  it('resuming_from_either_window_lets_the_agents_reach_each_other_and_delivers_nothing_refused_during_the_pause', async () => {
    const { front, back, deliver } = linkedPair()
    await front.exchange.pause('f1')
    await deliver()
    await front.exchange.send('f1', 'refused while paused')
    back.exchange.resume('b1')
    await deliver()
    expect(back.turns).toEqual([])
    expect(front.links.viewOf('f1').state === 'linked' && (front.links.viewOf('f1') as { paused?: true }).paused).toBeFalsy()
    expect((await front.exchange.send('f1', 'after resume')).ok).toBe(true)
    await deliver()
    expect(back.turns).toHaveLength(1)
    expect(back.turns[0]).toContain('after resume')
    expect(back.turns[0]).not.toContain('refused while paused')
  })
})
