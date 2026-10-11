import type { McpServerConfig, McpServers } from './mcp-config'
import { mcpTool, type McpConnection, type McpConnector, type McpToolInfo } from './mcp-connection'
import type { McpToolCache } from './mcp-tool-cache'
import type { McpServerState } from '../session/code-session'
import { fail, type Tool, type ToolOutput } from '../openai-session/tools/tool'
import { errorMessage } from '../../error-message'

type Server = {
  config: McpServerConfig
  connection: McpConnection | undefined
  /** The start in flight; a second caller waits on the same one rather than spawning the server twice. */
  starting: Promise<void> | undefined
  /** What the server listed when it last ran, live or remembered. */
  tools: McpToolInfo[]
  state: McpServerState
}

/**
 * The workspace's MCP servers as a session holds them, on either engine. A
 * server whose tools are remembered is not started until one of them is
 * called; one never seen before is started once to learn them. A server that
 * cannot be reached is a status, not a failure of the session.
 */
export class McpToolHost {
  private servers = new Map<string, Server>()
  private readonly listeners: (() => void)[] = []

  constructor(
    private readonly connect: McpConnector,
    private readonly cache: McpToolCache,
  ) {}

  /** Called on every change of a server's status or tools. */
  watch(listener: () => void): void {
    this.listeners.push(listener)
  }

  /**
   * Closes what is open and takes this set, in the order given. The set is in
   * force as soon as this is called, so a server's tools can be asked for
   * while it is still being started.
   */
  async load(servers: McpServers): Promise<void> {
    const previous = [...this.servers.values()]
    this.servers = new Map()
    const learning: string[] = []
    for (const [name, config] of Object.entries(servers)) {
      const known = this.cache.read(name, config)
      if (!known) learning.push(name)
      this.servers.set(name, { config, connection: undefined, starting: undefined, tools: known ?? [], state: { name, status: known ? 'stopped' : 'pending' } })
    }
    await Promise.all([...previous.map((s) => this.shut(s)), ...learning.map((name) => this.start(name))])
    this.changed()
  }

  /** Starts one server unless it runs already; an unknown name is nothing to do. */
  start(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server || server.connection) return Promise.resolve()
    server.starting ??= this.open(name, server).finally(() => (server.starting = undefined))
    return server.starting
  }

  /** Ends one server's process; its tools stay offered and the next call starts it again. */
  async stop(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server) return
    if (server.starting) await server.starting
    await this.shut(server)
    server.state = { name, status: 'stopped' }
    this.changed()
  }

  /** Waits for the start in flight, so a server's tools are not asked for before it has listed them. */
  async ready(name: string): Promise<void> {
    await this.servers.get(name)?.starting
  }

  /** Runs one of a server's tools, starting the server first. */
  async call(name: string, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutput> {
    if (!this.servers.has(name)) return fail(`MCP server ${name} is no longer configured.`)
    await this.start(name)
    const server = this.servers.get(name)
    if (!server?.connection) return fail(`MCP server ${name} could not be started: ${server?.state.error ?? 'it was removed'}`)
    return server.connection.callTool(tool, args, signal)
  }

  /** Every server's tools as the own loop runs them. */
  tools(): Tool[] {
    return [...this.servers.entries()].flatMap(([name, s]) => s.tools.map((info) => mcpTool(name, info, (tool, args, signal) => this.call(name, tool, args, signal))))
  }

  /** One server's tools as it lists them; nothing for an unknown name. */
  toolsOf(name: string): McpToolInfo[] {
    return this.servers.get(name)?.tools ?? []
  }

  names(): string[] {
    return [...this.servers.keys()]
  }

  statuses(): McpServerState[] {
    return [...this.servers.values()].map((s) => s.state)
  }

  async close(): Promise<void> {
    await Promise.all([...this.servers.values()].map((s) => this.shut(s)))
    this.servers.clear()
  }

  private async open(name: string, server: Server): Promise<void> {
    server.state = { name, status: 'pending' }
    this.changed()
    let listed: McpToolInfo[] | undefined
    try {
      const connection = await this.connect(name, server.config)
      listed = await connection.listTools()
      if (this.servers.get(name) !== server) {
        // The set was replaced while this one started; nobody holds it any more.
        await connection.close().catch(() => undefined)
        return
      }
      server.connection = connection
      server.tools = listed
      server.state = { name, status: 'connected' }
    } catch (error) {
      server.state = { name, status: 'failed', error: errorMessage(error) }
    }
    this.changed()
    if (server.connection && listed) await this.cache.write(name, server.config, listed)
  }

  /** A connection that will not close is let go of anyway: its process is no longer this session's. */
  private async shut(server: Server): Promise<void> {
    const { connection } = server
    server.connection = undefined
    if (connection) await connection.close().catch(() => undefined)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}
