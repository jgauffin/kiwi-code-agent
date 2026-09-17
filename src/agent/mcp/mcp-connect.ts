import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig } from './mcp-config'
import type { McpConnection, McpConnector, McpToolInfo } from './mcp-connection'
import { toolResultText } from '../sdk-session/sdk-event-mapper'
import { truncate } from '../openai-session/tools/tool'

/**
 * Connects the own loop to a server the way the Claude engine's CLI would: a
 * stdio server is spawned in the workspace with the host's environment plus
 * its own, a remote one is reached with its headers.
 */
export function connectMcp(cwd: string, onStderr: (server: string, chunk: string) => void): McpConnector {
  return async (name, config) => {
    const transport = transportFor(config, cwd)
    if (transport instanceof StdioClientTransport) {
      transport.stderr?.on('data', (chunk: Buffer | string) => onStderr(name, chunk.toString()))
    }
    const client = new Client({ name: 'kiwi-agent', version: '0.0.1' }, { capabilities: {} })
    // The SDK's HTTP transport declares `sessionId?: string` but holds undefined; its own interface is stricter than it is.
    await client.connect(transport as Transport)
    return connection(client)
  }
}

function transportFor(config: McpServerConfig, cwd: string): StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport {
  switch (config.type) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        ...(config.args ? { args: config.args } : {}),
        env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
        cwd,
        stderr: 'pipe',
      })
    case 'sse':
      return new SSEClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } })
    case 'http':
      return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } })
  }
}

function connection(client: Client): McpConnection {
  return {
    async listTools() {
      const tools: McpToolInfo[] = []
      let cursor: string | undefined
      do {
        const page = await client.listTools(cursor ? { cursor } : {})
        for (const t of page.tools) {
          tools.push({ name: t.name, ...(t.description ? { description: t.description } : {}), inputSchema: t.inputSchema })
        }
        cursor = page.nextCursor
      } while (cursor)
      return tools
    },
    async callTool(name, args, signal) {
      const result = await client.callTool({ name, arguments: args }, undefined, { signal })
      return { text: truncate(toolResultText(result.content)), isError: result.isError === true }
    },
    close: () => client.close(),
  }
}
