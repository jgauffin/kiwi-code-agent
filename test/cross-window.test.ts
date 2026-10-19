import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../src/agent/session/code-session'
import type { PersonsWord } from '../src/agent/session/session-manager'
import type { Envelope } from '../src/cross-window/agent-exchange'
import { CrossWindow, type LinkPrompts, type LinkedSessions, type Mailbox } from '../src/cross-window/cross-window'
import { emptyLinkState, type LinkStore, type SharedLinkState } from '../src/cross-window/window-links'

/** The sessions of one window, interrupting the way the session manager does: the person's Stop holds the other agent. */
class FakeSessions implements LinkedSessions {
  readonly events: SessionEvent[] = []
  readonly turns: string[] = []
  readonly removedListeners: Array<(id: string) => void> = []
  ended = 0
  exchange: PersonsWord | undefined
  constructor(private readonly records: Array<{ id: string; mode: string }>) {}
  get = (id: string) => this.records.find((r) => r.id === id)
  list = () => this.records
  record = async (_id: string, event: SessionEvent) => void this.events.push(event)
  isInTurn = () => false
  startTurnFromAgent = async (_id: string, text: string) => void this.turns.push(text)
  endTurn = async () => void this.ended++
  interrupt = (id: string) => this.exchange?.personInterrupted(id)
  attachExchange = (exchange: PersonsWord) => void (this.exchange = exchange)
  onRemoved = (listener: (id: string) => void) => void this.removedListeners.push(listener)
}

function memoryStore(): LinkStore {
  let json = JSON.stringify(emptyLinkState())
  return { read: () => JSON.parse(json) as SharedLinkState, write: (s) => void (json = JSON.stringify(s)) }
}

function memoryMailbox(): Mailbox {
  const boxes = new Map<string, Envelope[]>()
  return {
    post: (e) => void boxes.set(e.to.workspaceId, [...(boxes.get(e.to.workspaceId) ?? []), e]),
    take: (id) => {
      const taken = boxes.get(id) ?? []
      boxes.delete(id)
      return taken
    },
  }
}

function setup() {
  const store = memoryStore()
  const mailbox = memoryMailbox()
  let shownCode = ''
  const make = (name: string, records: Array<{ id: string; mode: string }>, prompts: LinkPrompts) => {
    const sessions = new FakeSessions(records)
    let changes = 0
    const window = new CrossWindow({
      store,
      mailbox,
      self: { workspaceId: `ws-${name}`, workspaceName: name },
      sessions,
      onLocalMachine: () => true,
      limit: () => 10,
      prompts,
      changed: () => void changes++,
    })
    window.heartbeat()
    return { window, sessions, changes: () => changes }
  }
  const front = make('front', [{ id: 'f1', mode: 'chat' }, { id: 'p1', mode: 'plan' }], {
    pickWay: async () => 'create',
    showCode: async (code) => void (shownCode = code),
    askCode: async () => undefined,
  })
  const back = make('back', [{ id: 'b1', mode: 'chat' }], {
    pickWay: async () => 'enter',
    showCode: async () => {},
    askCode: async () => shownCode,
  })
  return { front, back }
}

async function linked() {
  const sides = setup()
  await sides.front.window.act('f1', 'link')
  await sides.back.window.act('b1', 'link')
  return sides
}

describe('cross-window chat in a window', () => {
  it('a_code_shown_in_one_window_and_entered_in_the_other_links_the_two_chat_sessions', async () => {
    const { front, back } = await linked()
    expect(front.window.viewOf('f1')).toEqual({ state: 'linked', workspace: 'back', paused: false })
    expect(back.window.viewOf('b1')).toEqual({ state: 'linked', workspace: 'front', paused: false })
  })

  it('only_a_chat_session_shows_a_link', () => {
    const { front } = setup()
    expect(front.window.viewOf('p1')).toBeUndefined()
    expect(front.window.viewOf('f1')).toEqual({ state: 'none' })
  })

  it('a_message_one_agent_sends_starts_a_turn_for_the_other_once_its_window_polls', async () => {
    const { front, back } = await linked()
    expect((await front.window.exchange.send('f1', 'POST /orders now returns orderId')).ok).toBe(true)
    await back.window.poll()
    expect(back.sessions.turns).toHaveLength(1)
    expect(back.sessions.turns[0]).toContain('POST /orders now returns orderId')
  })

  it('after_a_pause_and_resume_the_other_agent_still_starts_a_turn_on_a_message', async () => {
    const { front, back } = await linked()
    await front.window.act('f1', 'pause')
    await back.window.poll()
    expect(front.sessions.ended).toBe(1)
    expect(back.sessions.ended).toBe(1)
    await back.window.act('b1', 'resume')
    await front.window.exchange.send('f1', 'carry on with the rename')
    await back.window.poll()
    expect(back.sessions.turns).toHaveLength(1)
  })

  it('a_link_change_made_in_the_other_window_shows_here_on_the_next_poll', async () => {
    const { front, back } = await linked()
    await front.window.poll()
    const before = front.changes()
    await back.window.act('b1', 'unlink')
    await front.window.poll()
    expect(front.changes()).toBe(before + 1)
    expect(front.window.viewOf('f1')).toEqual({ state: 'ended', workspace: 'back', paused: false })
  })

  it('a_deleted_session_ends_its_link_for_the_other_side', async () => {
    const { front, back } = await linked()
    for (const listener of front.sessions.removedListeners) listener('f1')
    expect(back.window.viewOf('b1')).toMatchObject({ state: 'ended' })
  })

  it('backing_out_of_entering_a_code_links_nothing', async () => {
    const { back } = setup()
    await back.window.act('b1', 'link')
    expect(back.window.viewOf('b1')).toEqual({ state: 'none' })
  })
})
