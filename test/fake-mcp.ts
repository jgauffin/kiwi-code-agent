import type { McpConnection, McpConnector, McpToolInfo } from '../src/agent/mcp/mcp-connection'
import type { McpToolStore } from '../src/agent/mcp/mcp-tool-cache'

/** Scripted servers: each name lists its tools, or throws on connect; `kill` ends one from outside, as a rebuild would. */
export function fakeConnector(servers: Record<string, McpToolInfo[] | Error>) {
  const connects: string[] = []
  const closed: string[] = []
  const calls: { server: string; tool: string; args: unknown }[] = []
  const kills = new Map<string, () => void>()
  const connect: McpConnector = async (name, _config, onClosed) => {
    connects.push(name)
    const tools = servers[name] ?? new Error(`unknown ${name}`)
    if (tools instanceof Error) throw tools
    let alive = true
    const connection: McpConnection = {
      listTools: async () => tools,
      callTool: async (tool, args) => {
        if (!alive) throw new Error('Connection closed')
        calls.push({ server: name, tool, args })
        return { text: `${name}:${tool}`, isError: false }
      },
      close: async () => {
        closed.push(name)
        alive = false
        onClosed()
      },
    }
    kills.set(name, () => {
      alive = false
      onClosed()
    })
    return connection
  }
  const kill = (name: string): void => kills.get(name)?.()
  return { connect, connects, closed, calls, kill }
}

/** The workspace state the tool lists are kept in, held in memory. */
export function memoryStore(): McpToolStore {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => void values.set(key, value),
  }
}
