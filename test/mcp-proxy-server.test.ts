import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpConnector, McpToolInfo } from '../src/agent/mcp/mcp-connection'
import { mcpProxy } from '../src/agent/mcp/mcp-proxy-server'
import { McpToolCache } from '../src/agent/mcp/mcp-tool-cache'
import { McpToolHost } from '../src/agent/mcp/mcp-tool-host'
import { fakeConnector, memoryStore } from './fake-mcp'

const echo: McpToolInfo = { name: 'echo', description: 'Echoes', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }
const docs = { type: 'stdio' as const, command: 'x' }

/** The engine's side of the proxy: an MCP client talking to it in memory. */
async function engineClient(host: McpToolHost) {
  const proxy = mcpProxy('docs', host)
  const [engineEnd, proxyEnd] = InMemoryTransport.createLinkedPair()
  await proxy.config.instance.connect(proxyEnd)
  const client = new Client({ name: 'engine', version: '1' })
  await client.connect(engineEnd)
  return client
}

describe('mcpProxy', () => {
  it('the_engine_is_offered_remembered_tools_without_the_server_being_started', async () => {
    const store = memoryStore()
    await new McpToolHost(fakeConnector({ docs: [echo] }).connect, new McpToolCache(store)).load({ docs })
    const fake = fakeConnector({ docs: [echo] })
    const host = new McpToolHost(fake.connect, new McpToolCache(store))
    await host.load({ docs })
    const client = await engineClient(host)
    const { tools } = await client.listTools()
    expect(tools.map((t) => ({ name: t.name, description: t.description }))).toEqual([{ name: 'echo', description: 'Echoes' }])
    expect(fake.connects).toEqual([])
    await client.close()
  })

  it('the_engine_s_first_look_at_a_server_never_seen_waits_until_it_has_listed_its_tools', async () => {
    const host = new McpToolHost(fakeConnector({ docs: [echo] }).connect, new McpToolCache(memoryStore()))
    const loading = host.load({ docs })
    const client = await engineClient(host)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['echo'])
    await loading
    await client.close()
  })

  it('a_call_from_the_engine_starts_the_server_and_runs_the_tool_there', async () => {
    const store = memoryStore()
    await new McpToolHost(fakeConnector({ docs: [echo] }).connect, new McpToolCache(store)).load({ docs })
    const fake = fakeConnector({ docs: [echo] })
    const host = new McpToolHost(fake.connect, new McpToolCache(store))
    await host.load({ docs })
    const client = await engineClient(host)
    const result = await client.callTool({ name: 'echo', arguments: { value: 'hi' } })
    expect(result).toMatchObject({ content: [{ type: 'text', text: 'docs:echo' }], isError: false })
    expect(fake.calls).toEqual([{ server: 'docs', tool: 'echo', args: { value: 'hi' } }])
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'connected' }])
    await client.close()
  })

  it('an_image_a_server_tool_returns_reaches_the_engine_as_an_image_not_a_placeholder', async () => {
    const connector: McpConnector = async () => ({
      listTools: async () => [echo],
      callTool: async () => ({ text: 'Crafter\n[image]', isError: false, images: [{ mediaType: 'image/png', data: 'iVBORw0K' }] }),
      close: async () => undefined,
    })
    const host = new McpToolHost(connector, new McpToolCache(memoryStore()))
    await host.load({ docs })
    const client = await engineClient(host)
    const result = await client.callTool({ name: 'echo', arguments: {} })
    expect(result.content).toEqual([
      { type: 'text', text: 'Crafter\n[image]' },
      { type: 'image', data: 'iVBORw0K', mimeType: 'image/png' },
    ])
    await client.close()
  })
})
