import type { McpControl, SessionEvent } from '../session/code-session'
import type { McpServers } from '../mcp/mcp-config'
import type { McpToolHost } from '../mcp/mcp-tool-host'
import type { ToolDefinition } from './chat-messages'
import { toDefinition, type Tool } from './tools/tool'
import { errorMessage } from '../../error-message'

/** The built-in tools plus what the MCP servers offer now; swapped as one when the servers change. */
export class SessionMcp {
  private current: Tool[]
  private currentDefinitions: ToolDefinition[]
  /** MCP changes run one after another; a turn waits for the one in flight before it starts. */
  private chain: Promise<void> = Promise.resolve()
  readonly control: McpControl | undefined

  constructor(
    private readonly builtIn: Tool[],
    private readonly mcp: { host: McpToolHost; servers: McpServers } | undefined,
    private readonly emit: (event: SessionEvent) => void,
    private readonly reportError: (message: string) => void,
  ) {
    this.current = builtIn
    this.currentDefinitions = builtIn.map(toDefinition)
    if (mcp) {
      this.control = {
        reload: (servers) => this.apply(() => mcp.host.load(servers)),
        start: (name) => this.apply(() => mcp.host.start(name)),
        stop: (name) => this.apply(() => mcp.host.stop(name)),
      }
    }
  }

  get tools(): Tool[] {
    return this.current
  }

  get definitions(): ToolDefinition[] {
    return this.currentDefinitions
  }

  /** Settles once the change in flight has; a turn's first round then sees the servers' tools. */
  settled(): Promise<void> {
    return this.chain
  }

  /** Begins watching the host and loads the workspace's servers. */
  start(): void {
    const { mcp } = this
    if (!mcp) return
    mcp.host.watch(() => this.changed())
    void this.apply(() => mcp.host.load(mcp.servers))
  }

  /** One MCP change at a time; a turn waits for the one in flight, so its first round sees the servers' tools. */
  private apply(change: () => Promise<void>): Promise<void> {
    this.chain = this.chain
      .then(change)
      .catch((error: unknown) => this.reportError(`MCP servers: ${errorMessage(error)}`))
      .then(() => this.changed())
    return this.chain
  }

  /**
   * A server started, stopped or listed other tools. A round in flight keeps
   * the definitions it was sent; the next round sees the new set, and a call
   * to a tool that went away fails like any unknown tool.
   */
  private changed(): void {
    const host = this.mcp!.host
    this.current = [...this.builtIn, ...host.tools()]
    this.currentDefinitions = this.current.map(toDefinition)
    this.emit({ type: 'mcp_servers', servers: host.statuses() })
  }
}
