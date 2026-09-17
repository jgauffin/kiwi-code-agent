import { describe, expect, it } from 'vitest'
import type { McpConnection, McpConnector, McpToolInfo } from '../src/agent/mcp/mcp-connection'
import { McpToolHost } from '../src/agent/mcp/mcp-tool-host'
import { toDefinition } from '../src/agent/openai-session/tools/tool'
import { ReadTracker } from '../src/agent/openai-session/tools/read-tracker'

const echo: McpToolInfo = { name: 'echo', description: 'Echoes', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }

/** Scripted servers: each name lists its tools, or throws on connect. */
function fakeConnector(servers: Record<string, McpToolInfo[] | Error>) {
  const connects: string[] = []
  const closed: string[] = []
  const calls: { server: string; tool: string; args: unknown }[] = []
  const connect: McpConnector = async (name) => {
    connects.push(name)
    const tools = servers[name] ?? new Error(`unknown ${name}`)
    if (tools instanceof Error) throw tools
    const connection: McpConnection = {
      listTools: async () => tools,
      callTool: async (tool, args) => {
        calls.push({ server: name, tool, args })
        return { text: `${name}:${tool}`, isError: false }
      },
      close: async () => void closed.push(name),
    }
    return connection
  }
  return { connect, connects, closed, calls }
}

const ctx = { cwd: '/w', signal: new AbortController().signal, files: new ReadTracker() }

describe('McpToolHost', () => {
  it('tools_are_named_after_their_server_and_carry_the_server_s_json_schema', async () => {
    const fake = fakeConnector({ docs: [echo] })
    const host = new McpToolHost(fake.connect)
    await host.load({ docs: { type: 'stdio', command: 'x' } })
    const [tool] = host.tools()
    expect(tool!.name).toBe('mcp__docs__echo')
    expect(tool!.readOnly).toBe(false)
    expect(toDefinition(tool!)).toEqual({ name: 'mcp__docs__echo', description: 'Echoes', parameters: echo.inputSchema })
    expect(await tool!.execute({ value: 'hi' }, ctx)).toEqual({ text: 'docs:echo', isError: false })
    expect(fake.calls).toEqual([{ server: 'docs', tool: 'echo', args: { value: 'hi' } }])
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'connected' }])
  })

  it('a_server_that_fails_to_connect_is_a_failed_status_and_the_others_still_load', async () => {
    const fake = fakeConnector({ docs: [echo], broken: new Error('spawn nope ENOENT') })
    const host = new McpToolHost(fake.connect)
    await host.load({ docs: { type: 'stdio', command: 'x' }, broken: { type: 'stdio', command: 'nope' } })
    expect(host.statuses()).toEqual([
      { name: 'docs', status: 'connected' },
      { name: 'broken', status: 'failed', error: 'spawn nope ENOENT' },
    ])
    expect(host.tools().map((t) => t.name)).toEqual(['mcp__docs__echo'])
  })

  it('a_reload_closes_the_old_connections_and_a_reconnect_touches_one_server_only', async () => {
    const fake = fakeConnector({ docs: [echo], other: [echo] })
    const host = new McpToolHost(fake.connect)
    await host.load({ docs: { type: 'stdio', command: 'x' }, other: { type: 'stdio', command: 'y' } })
    await host.load({ docs: { type: 'stdio', command: 'x' } })
    expect(fake.closed).toEqual(['docs', 'other'])
    expect(host.tools().map((t) => t.name)).toEqual(['mcp__docs__echo'])

    await host.reconnect('docs')
    expect(fake.closed).toEqual(['docs', 'other', 'docs'])
    expect(fake.connects).toEqual(['docs', 'other', 'docs', 'docs'])
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'connected' }])

    await host.reconnect('unknown')
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'connected' }])
  })

  it('close_ends_every_connection', async () => {
    const fake = fakeConnector({ docs: [echo] })
    const host = new McpToolHost(fake.connect)
    await host.load({ docs: { type: 'stdio', command: 'x' } })
    await host.close()
    expect(fake.closed).toEqual(['docs'])
    expect(host.tools()).toEqual([])
  })
})
