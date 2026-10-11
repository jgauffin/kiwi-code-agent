import type { McpConnection, McpConnector, McpToolInfo } from '../src/agent/mcp/mcp-connection'
import type { McpToolStore } from '../src/agent/mcp/mcp-tool-cache'

/** Scripted servers: each name lists its tools, or throws on connect. */
export function fakeConnector(servers: Record<string, McpToolInfo[] | Error>) {
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

/** The workspace state the tool lists are kept in, held in memory. */
export function memoryStore(): McpToolStore {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => void values.set(key, value),
  }
}
