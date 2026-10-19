import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Envelope } from '../src/cross-window/agent-exchange'
import { FileMailbox } from '../src/cross-window/file-mailbox'

const front = { workspaceId: 'ws-front', workspaceName: 'front', sessionId: 'f1' }
const back = { workspaceId: 'ws-back', workspaceName: 'back', sessionId: 'b1' }
const message = (text: string, count: number): Envelope => ({ kind: 'message', from: front, to: back, text, count })

describe('file mailbox between windows', () => {
  const roots: string[] = []
  const mailbox = () => {
    const root = mkdtempSync(join(tmpdir(), 'kiwi-mail-'))
    roots.push(root)
    return { root, sender: new FileMailbox(root), receiver: new FileMailbox(root) }
  }
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('envelopes_reach_only_the_workspace_they_are_for_in_the_order_sent', () => {
    const { sender, receiver } = mailbox()
    sender.post(message('first', 1))
    sender.post(message('second', 2))
    expect(receiver.take('ws-front')).toEqual([])
    expect(receiver.take('ws-back')).toEqual([message('first', 1), message('second', 2)])
  })

  it('an_envelope_is_taken_once_and_leaves_nothing_behind', () => {
    const { root, sender, receiver } = mailbox()
    sender.post(message('only once', 1))
    expect(receiver.take('ws-back')).toHaveLength(1)
    expect(receiver.take('ws-back')).toEqual([])
    expect(readdirSync(join(root, 'ws-back'))).toEqual([])
  })

  it('a_workspace_nobody_wrote_to_has_nothing_waiting', () => {
    expect(mailbox().receiver.take('ws-none')).toEqual([])
  })
})
