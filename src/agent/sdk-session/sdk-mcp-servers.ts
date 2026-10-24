import type { McpSdkServerConfigWithInstance, McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { McpControl, SessionEvent } from '../session/code-session'
import type { AsyncQueue } from '../session/async-queue'
import type { McpServers } from '../mcp/mcp-config'
import type { McpToolHost } from '../mcp/mcp-tool-host'
import { mcpProxy, type McpProxy } from '../mcp/mcp-proxy-server'
import { errorMessage } from '../../error-message'

/** The servers the engine is handed: the own in-process one, and a proxy for each of the workspace's. */
export class SdkMcpServers {
  /** The workspace's servers as the engine is handed them, by name. */
  private proxies: Map<string, McpProxy> = new Map()

  constructor(
    private readonly ownServer: McpSdkServerConfigWithInstance | undefined,
    private readonly output: AsyncQueue<SessionEvent>,
  ) {}

  /** Every server the engine runs with: the own one, then the workspace's. */
  all(): Record<string, McpServerConfig> {
    return {
      ...(this.ownServer ? { [this.ownServer.name]: this.ownServer } : {}),
      ...Object.fromEntries([...this.proxies].map(([name, proxy]) => [name, proxy.config])),
    }
  }

  /** Takes the servers into the host before the engine starts, so its first look at their tools waits on them. */
  control(host: McpToolHost, servers: McpServers, handToEngine: (servers: Record<string, McpServerConfig>) => Promise<unknown>): McpControl {
    host.watch(() => {
      for (const proxy of this.proxies.values()) proxy.refresh()
      this.report(host)
    })
    const load = (next: McpServers): Promise<void> => {
      const loading = host.load(next)
      // A server kept across a reload keeps its proxy: the engine connects a
      // name's instance only the first time it sees the name, so a new one
      // would never reach it, nor tell it the server's tools changed.
      this.proxies = new Map(Object.keys(next).map((name) => [name, this.proxies.get(name) ?? mcpProxy(name, host)]))
      return loading
    }
    load(servers).catch((error: unknown) => this.failed(error))
    return {
      reload: async (next) => {
        const loading = load(next)
        await handToEngine(this.all())
        await loading
        this.report(host)
      },
      start: async (name) => {
        await host.start(name)
        this.report(host)
      },
      stop: async (name) => {
        await host.stop(name)
        this.report(host)
      },
    }
  }

  /** The workspace's servers as the host holds them; the own server is not the user's business. */
  report(host: McpToolHost): void {
    if (!this.output.isEnded) this.output.push({ type: 'mcp_servers', servers: host.statuses() })
  }

  private failed(error: unknown): void {
    if (!this.output.isEnded) this.output.push({ type: 'error', message: `MCP servers: ${errorMessage(error)}`, fatal: false })
  }
}
