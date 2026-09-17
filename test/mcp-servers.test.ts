import { describe, expect, it } from 'vitest'
import type { McpServers } from '../src/agent/mcp/mcp-config'
import { McpServerSet } from '../src/agent/mcp/mcp-servers'
import type { CodeSession, McpControl } from '../src/agent/session/code-session'

const docs = { type: 'stdio' as const, command: 'x' }
const other = { type: 'stdio' as const, command: 'y' }

function fakeSession(withMcp: boolean) {
  const reloads: McpServers[] = []
  const reconnects: string[] = []
  const mcp: McpControl = {
    reload: async (servers) => void reloads.push(servers),
    reconnect: async (name) => void reconnects.push(name),
  }
  const session = { id: 's', mcp: withMcp ? mcp : undefined } as unknown as CodeSession
  return { session, reloads, reconnects }
}

function setUp(reads: (McpServers | Error)[], live: CodeSession[]) {
  const reported: string[] = []
  const set = new McpServerSet(
    async () => {
      const next = reads.shift()
      if (next === undefined) throw new Error('no read scripted')
      if (next instanceof Error) throw next
      return next
    },
    () => live,
    (message) => void reported.push(message),
  )
  return { set, reported }
}

describe('McpServerSet', () => {
  it('the_current_set_is_the_file_as_last_read', async () => {
    const { set } = setUp([{ docs }], [])
    expect(await set.current()).toEqual({ docs })
  })

  it('a_refresh_pushes_the_new_set_to_every_live_session_that_takes_servers', async () => {
    const a = fakeSession(true)
    const b = fakeSession(false)
    const { set } = setUp([{ docs }, { docs, other }], [a.session, b.session])
    await set.current()
    await set.refresh()
    expect(await set.current()).toEqual({ docs, other })
    expect(a.reloads).toEqual([{ docs, other }])
  })

  it('a_broken_file_keeps_the_last_good_set_and_is_reported', async () => {
    const a = fakeSession(true)
    const { set, reported } = setUp([{ docs }, new Error('.mcp.json: not valid JSON')], [a.session])
    await set.current()
    await set.refresh()
    expect(await set.current()).toEqual({ docs })
    expect(a.reloads).toEqual([])
    expect(reported).toEqual(['.mcp.json: not valid JSON'])
  })

  it('reconnect_all_re_reads_the_file_and_then_tries_every_server_in_every_live_session', async () => {
    const a = fakeSession(true)
    const { set } = setUp([{ docs }, { docs, other }], [a.session])
    await set.current()
    await set.reconnectAll()
    expect(a.reloads).toEqual([{ docs, other }])
    expect(a.reconnects).toEqual(['docs', 'other'])
  })
})
