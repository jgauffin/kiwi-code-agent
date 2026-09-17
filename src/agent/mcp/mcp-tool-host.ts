import type { McpServerConfig, McpServers } from './mcp-config'
import { mcpTool, type McpConnection, type McpConnector } from './mcp-connection'
import type { McpServerState } from '../session/code-session'
import type { Tool } from '../openai-session/tools/tool'

type Server = {
  config: McpServerConfig
  connection: McpConnection | undefined
  tools: Tool[]
  state: McpServerState
}

/**
 * The own loop's MCP client side: one connection per server, its tools
 * offered under `mcp__<server>__<tool>`. A server that cannot be reached is
 * a status, not a failure of the session.
 */
export class McpToolHost {
  private readonly servers = new Map<string, Server>()

  constructor(private readonly connect: McpConnector) {}

  /** Closes what is open and connects this set, in the order given. */
  async load(servers: McpServers): Promise<void> {
    await this.close()
    for (const [name, config] of Object.entries(servers)) {
      this.servers.set(name, { config, connection: undefined, tools: [], state: { name, status: 'pending' } })
    }
    await Promise.all([...this.servers.keys()].map((name) => this.open(name)))
  }

  /** One server again, from scratch; an unknown name is nothing to do. */
  async reconnect(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server) return
    await this.shut(server)
    await this.open(name)
  }

  tools(): Tool[] {
    return [...this.servers.values()].flatMap((s) => s.tools)
  }

  statuses(): McpServerState[] {
    return [...this.servers.values()].map((s) => s.state)
  }

  async close(): Promise<void> {
    await Promise.all([...this.servers.values()].map((s) => this.shut(s)))
    this.servers.clear()
  }

  private async open(name: string): Promise<void> {
    const server = this.servers.get(name)!
    try {
      const connection = await this.connect(name, server.config)
      server.connection = connection
      server.tools = (await connection.listTools()).map((info) => mcpTool(name, info, connection))
      server.state = { name, status: 'connected' }
    } catch (error) {
      server.tools = []
      server.state = { name, status: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** A connection that will not close is let go of anyway: its tools are gone either way. */
  private async shut(server: Server): Promise<void> {
    const { connection } = server
    server.connection = undefined
    server.tools = []
    if (connection) await connection.close().catch(() => undefined)
  }
}
