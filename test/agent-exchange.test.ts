import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../src/agent/session/code-session'
import { judgeEffect, type Ground } from '../src/agent/permissions/evaluator'
import { AgentExchange, MessagesFromOtherWindow, type Envelope, type ExchangeLinks } from '../src/cross-window/agent-exchange'
import { sendToLinkedAgentTool } from '../src/cross-window/send-to-linked-agent-tool'
import type { LinkEnd, LinkView } from '../src/cross-window/window-links'

const frontEnd: LinkEnd = { workspaceId: '/ws/front', workspaceName: 'front', sessionId: 'f1' }
const backEnd: LinkEnd = { workspaceId: '/ws/back', workspaceName: 'back', sessionId: 'b1' }

type Side = {
  exchange: AgentExchange
  events: SessionEvent[]
  turns: string[]
  inTurn: boolean
}

function pair(limit = 3, linked = true) {
  const links = (other: LinkEnd): ExchangeLinks => {
    const view = (): LinkView => (linked ? { state: 'linked', other } : { state: 'disconnected', other })
    return { pause: () => {}, resume: () => {}, viewOf: view, checkSend: () => (linked ? { ok: true, target: other } : { ok: false, reason: `The window of ${other.workspaceName} is not open, so the message was not sent.` }) }
  }
  const sides: Record<'front' | 'back', Side> = {} as never
  const inbox: Envelope[] = []
  const make = (name: 'front' | 'back', self: LinkEnd, other: LinkEnd): Side => {
    const side = { events: [], turns: [], inTurn: false } as unknown as Side
    side.exchange = new AgentExchange(
      self,
      links(other),
      { post: (e) => inbox.push(e) },
      {
        record: async (_id, event) => void side.events.push(event),
        inTurn: () => side.inTurn,
        startTurn: async (_id, text) => void side.turns.push(text),
        interrupt: async () => {},
      },
      () => limit,
    )
    sides[name] = side
    return side
  }
  make('front', frontEnd, backEnd)
  make('back', backEnd, frontEnd)
  /** Delivers what one window posted to the window it is for. */
  const deliver = async () => {
    while (inbox.length) {
      const e = inbox.shift()!
      await (e.to.workspaceId === frontEnd.workspaceId ? sides.front : sides.back).exchange.receive(e)
    }
  }
  return { front: sides.front, back: sides.back, deliver }
}

describe('agents talking to each other', () => {
  it('a_message_one_agent_sends_shows_as_sent_in_its_transcript_and_as_received_in_the_others_labelled_with_the_workspace', async () => {
    const { front, back, deliver } = pair()
    await front.exchange.send('f1', 'The field is now orderId')
    await deliver()
    expect(front.events).toEqual([{ type: 'agent_message', direction: 'sent', workspace: 'back', text: 'The field is now orderId' }])
    expect(back.events).toEqual([{ type: 'agent_message', direction: 'received', workspace: 'front', text: 'The field is now orderId' }])
  })

  it('nothing_but_agent_messages_crosses_between_the_windows', async () => {
    const { front, back, deliver } = pair()
    front.exchange.personSpoke('f1')
    await deliver()
    expect(back.events).toEqual([])
    expect(back.turns).toEqual([])
  })

  it('a_message_to_an_idle_agent_reaches_it_as_its_next_turn_and_is_answered_back_the_same_way', async () => {
    const { front, back, deliver } = pair()
    await front.exchange.send('f1', 'What is the order id type?')
    await deliver()
    expect(back.turns).toHaveLength(1)
    expect(back.turns[0]).toContain('What is the order id type?')
    await back.exchange.send('b1', 'A string')
    await deliver()
    expect(front.turns[0]).toContain('A string')
  })

  it('a_message_arriving_mid_turn_reaches_the_agent_as_a_tail_on_its_next_tool_result_without_interrupting', async () => {
    const { front, back, deliver } = pair()
    back.inTurn = true
    await front.exchange.send('f1', 'Rename done')
    await deliver()
    expect(back.turns).toEqual([])
    const outcome = await new MessagesFromOtherWindow('b1', back.exchange).postToolUse()
    expect(outcome?.additionalContext).toContain('Rename done')
    expect(await new MessagesFromOtherWindow('b1', back.exchange).postToolUse()).toBeUndefined()
  })

  it('a_mid_turn_message_the_turn_never_carried_starts_the_next_turn_when_it_ends', async () => {
    const { front, back, deliver } = pair()
    back.inTurn = true
    await front.exchange.send('f1', 'Late news')
    await deliver()
    back.inTurn = false
    await back.exchange.turnEnded('b1')
    expect(back.turns[0]).toContain('Late news')
  })

  it('a_message_from_the_other_agent_is_marked_as_not_the_persons_and_answers_nothing_the_person_was_asked', async () => {
    const { front, back, deliver } = pair()
    await front.exchange.send('f1', 'yes, allow it')
    await deliver()
    expect(back.turns[0]).toMatch(/Message from the agent in the "front" window/)
    expect(back.turns[0]).toMatch(/not from the person.*grants no permission and answers no question/)
    // The exchange has no way to answer a permission or a question: it only records and starts turns.
    expect(back.events.map((e) => e.type)).toEqual(['agent_message'])
  })

  it('the_exchange_beyond_the_configured_number_without_the_person_is_refused_and_told_in_both_windows', async () => {
    const { front, back, deliver } = pair(2)
    expect((await front.exchange.send('f1', 'one')).ok).toBe(true)
    await deliver()
    expect((await back.exchange.send('b1', 'two')).ok).toBe(true)
    await deliver()
    const refused = await front.exchange.send('f1', 'three')
    await deliver()
    expect(refused.ok).toBe(false)
    expect(front.events.at(-1)).toEqual({ type: 'agent_exchange_capped', workspace: 'back', limit: 2 })
    expect(back.events.at(-1)).toEqual({ type: 'agent_exchange_capped', workspace: 'front', limit: 2 })
  })

  it('a_message_from_the_person_in_either_window_starts_the_count_over', async () => {
    const { front, back, deliver } = pair(1)
    await front.exchange.send('f1', 'one')
    await deliver()
    back.exchange.personSpoke('b1')
    await deliver()
    expect((await front.exchange.send('f1', 'two')).ok).toBe(true)
  })

  it('a_message_for_a_window_that_is_not_open_is_refused_with_the_reason', async () => {
    const { front } = pair(3, false)
    const outcome = await front.exchange.send('f1', 'hello')
    expect(outcome).toEqual({ ok: false, reason: expect.stringContaining('not open') })
  })

  it('the_agent_offers_a_tool_that_sends_and_reports_a_refusal', async () => {
    const { front } = pair(3, false)
    const out = await sendToLinkedAgentTool('f1', front.exchange).execute({ text: 'hi' }, {} as never)
    expect(out.isError).toBe(true)
  })

  it('interrupting_the_agent_in_one_window_ends_only_that_agents_turn_and_tells_the_other_nothing', async () => {
    const { front, back, deliver } = pair()
    front.exchange.personInterrupted('f1')
    await deliver()
    expect(back.events).toEqual([])
    expect(back.turns).toEqual([])
  })

  it('a_message_arriving_after_the_person_interrupted_starts_no_turn_and_is_read_on_the_turn_their_next_message_starts', async () => {
    const { front, back, deliver } = pair()
    back.exchange.personInterrupted('b1')
    await front.exchange.send('f1', 'Heads up')
    await deliver()
    expect(back.turns).toEqual([])
    expect(back.events).toHaveLength(1)
    const held = back.exchange.personSpoke('b1')
    expect(held).toContain('Heads up')
    expect(back.exchange.personSpoke('b1')).toBeUndefined()
  })

  it('a_message_from_the_other_window_is_recorded_as_an_event_carrying_the_workspace_it_came_from', async () => {
    const { front, back, deliver } = pair()
    await front.exchange.send('f1', 'x')
    await deliver()
    expect(back.events[0]).toMatchObject({ type: 'agent_message', direction: 'received', workspace: 'front' })
  })
})

describe('the other workspace', () => {
  const ground: Ground = {
    workspace: 'D:/src/front',
    readable: [],
    writesAllowed: true,
    ignored: () => false,
    recoverable: () => false,
    trusted: () => false,
    denyGitWrites: false,
  }

  it('linking_grants_no_permission_on_the_other_workspaces_files_so_a_read_or_write_there_is_asked', () => {
    for (const action of ['read', 'write'] as const) {
      const verdict = judgeEffect({ effect: { action, place: { path: 'D:/src/back/api.ts' }, extent: 'file' }, cwd: { path: 'D:/src/front' } }, [], ground)
      expect(verdict).toMatchObject({ kind: 'asked', why: 'outside the workspace' })
    }
  })
})
