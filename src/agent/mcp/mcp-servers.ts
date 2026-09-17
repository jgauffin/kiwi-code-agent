import type { McpServers } from './mcp-config'
import type { CodeSession } from '../session/code-session'

/**
 * The workspace's MCP servers as one set: what a new session starts with, and
 * what every running session is handed when the file changes. A file that
 * cannot be read leaves the last good set in force.
 */
export class McpServerSet {
  private servers: Promise<McpServers>

  constructor(
    private readonly read: () => Promise<McpServers>,
    private readonly live: () => CodeSession[],
    private readonly report: (message: string) => void,
  ) {
    this.servers = this.readOr({})
  }

  /** The set as last read. */
  current(): Promise<McpServers> {
    return this.servers
  }

  /** The file changed: read it again and hand the set to every session that takes servers. */
  async refresh(): Promise<void> {
    const before = await this.servers
    const after = await this.readOr(before)
    this.servers = Promise.resolve(after)
    if (after === before) return
    await Promise.all(this.live().map((session) => session.mcp?.reload(after)))
  }

  /** The command: the file again, then every server in every running session tried afresh. */
  async reconnectAll(): Promise<void> {
    await this.refresh()
    const names = Object.keys(await this.servers)
    await Promise.all(this.live().flatMap((session) => names.map((name) => session.mcp?.reconnect(name))))
  }

  private async readOr(fallback: McpServers): Promise<McpServers> {
    try {
      return await this.read()
    } catch (error) {
      this.report(error instanceof Error ? error.message : String(error))
      return fallback
    }
  }
}
