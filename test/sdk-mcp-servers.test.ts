import { describe, expect, it } from 'vitest'
import type { McpServerConfig, McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpToolInfo } from '../src/agent/mcp/mcp-connection'
import { McpToolCache } from '../src/agent/mcp/mcp-tool-cache'
import { McpToolHost } from '../src/agent/mcp/mcp-tool-host'
import { AsyncQueue } from '../src/agent/session/async-queue'
import type { SessionEvent } from '../src/agent/session/code-session'
import { SdkMcpServers } from '../src/agent/sdk-session/sdk-mcp-servers'
import { fakeConnector, memoryStore } from './fake-mcp'

const echo: McpToolInfo = { name: 'echo', inputSchema: { type: 'object' } }
const shout: McpToolInfo = { name: 'shout', inputSchema: { type: 'object' } }
const docs = { type: 'stdio' as const, command: 'x' }
const other = { type: 'stdio' as const, command: 'y' }

describe('SdkMcpServers', () => {
  it('a_server_kept_across_a_reload_keeps_the_instance_the_engine_talks_to_and_it_tells_of_rebuilt_tools', async () => {
    const tools: Record<string, McpToolInfo[]> = { docs: [echo], other: [echo] }
    const fake = fakeConnector(tools)
    const host = new McpToolHost(fake.connect, new McpToolCache(memoryStore()))
    const servers = new SdkMcpServers(undefined, new AsyncQueue<SessionEvent>())
    const handed: Record<string, McpServerConfig>[] = []
    const control = servers.control(host, { docs }, async (set) => void handed.push(set))
    await host.ready('docs')

    const instance = (servers.all().docs as McpSdkServerConfigWithInstance).instance
    const [engineEnd, proxyEnd] = InMemoryTransport.createLinkedPair()
    await instance.connect(proxyEnd)
    const engine = new Client({ name: 'engine', version: '1' })
    await engine.connect(engineEnd)
    const changed = new Promise<void>((resolve) => engine.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve()))
    await engine.listTools()

    await control.reload({ docs, other })
    expect((handed[0]!.docs as McpSdkServerConfigWithInstance).instance).toBe(instance)

    tools.docs = [echo, shout]
    await engine.callTool({ name: 'echo', arguments: {} })
    await changed
    expect((await engine.listTools()).tools.map((t) => t.name)).toEqual(['echo', 'shout'])
    await engine.close()
  })
})
