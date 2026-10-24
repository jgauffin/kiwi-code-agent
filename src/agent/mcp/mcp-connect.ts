import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig } from './mcp-config'
import type { McpConnection, McpConnector, McpToolInfo } from './mcp-connection'
import { toolResultText } from '../sdk-session/sdk-event-mapper'
import { truncate, type ToolOutput } from '../openai-session/tools/tool'

/**
 * Connects the own loop to a server the way the Claude engine's CLI would: a
 * stdio server is spawned in the workspace with the host's environment plus
 * its own, a remote one is reached with its headers.
 */
export function connectMcp(cwd: string, onStderr: (server: string, chunk: string) => void): McpConnector {
  return async (name, config, onClosed) => {
    const transport = transportFor(config, cwd)
    if (transport instanceof StdioClientTransport) {
      transport.stderr?.on('data', (chunk: Buffer | string) => onStderr(name, chunk.toString()))
    }
    const client = new Client({ name: 'kiwipow-agent', version: '0.0.1' }, { capabilities: {} })
    client.onclose = onClosed
    // The SDK's HTTP transport declares `sessionId?: string` but holds undefined; its own interface is stricter than it is.
    await client.connect(transport as Transport)
    return connection(client, transport instanceof StdioClientTransport ? transport : undefined)
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

function connection(client: Client, stdio: StdioClientTransport | undefined): McpConnection {
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
      return mcpToolOutput(await client.callTool({ name, arguments: args }, undefined, { signal }))
    },
    close: () => (stdio ? closeStdio(client, stdio) : client.close()),
  }
}

/** A server's tool result as either engine takes it: its text, and the images it returned kept whole for the model to see. */
export function mcpToolOutput(result: Record<string, unknown>): ToolOutput {
  const images = (Array.isArray(result.content) ? result.content : []).filter(isImageContent).map((part) => ({ mediaType: part.mimeType, data: part.data }))
  return { text: truncate(toolResultText(result.content)), isError: result.isError === true, ...(images.length > 0 ? { images } : {}) }
}

function isImageContent(part: unknown): part is { type: 'image'; data: string; mimeType: string } {
  if (typeof part !== 'object' || part === null) return false
  const { type, data, mimeType } = part as Record<string, unknown>
  return type === 'image' && typeof data === 'string' && typeof mimeType === 'string'
}

/**
 * The client ends the server's input and kills the process it spawned. On
 * Windows that process is often a launcher (`dotnet run`, `npx`, a `.cmd`)
 * whose child would outlive it and keep its build output locked, so a server
 * that has not exited on its own within a second goes as a whole tree.
 */
async function closeStdio(client: Client, transport: StdioClientTransport): Promise<void> {
  const pid = transport.pid
  const tree = process.platform === 'win32' && pid !== null ? setTimeout(() => killTree(pid), 1000) : undefined
  try {
    await client.close()
  } finally {
    clearTimeout(tree)
  }
}

function killTree(pid: number): void {
  spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => undefined)
}
