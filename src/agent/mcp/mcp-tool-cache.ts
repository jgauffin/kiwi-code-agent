import { createHash } from 'node:crypto'
import type { McpServerConfig } from './mcp-config'
import type { McpToolInfo } from './mcp-connection'

/** Where the lists are kept: the workspace's own state, so another workspace's server of the same name never answers. */
export interface McpToolStore {
  get<T>(key: string): T | undefined
  update(key: string, value: unknown): PromiseLike<void>
}

type Entry = { config: string; tools: McpToolInfo[] }

const KEY = 'mcpToolLists'

/**
 * The tools each server listed when it last ran, so a session can offer them
 * without starting the server. A list holds only for the configuration it was
 * read under; the configuration is kept as a hash, since it carries the
 * secrets its environment expanded into it.
 */
export class McpToolCache {
  constructor(private readonly store: McpToolStore) {}

  read(name: string, config: McpServerConfig): McpToolInfo[] | undefined {
    const entry = this.entries()[name]
    return entry?.config === fingerprint(config) ? entry.tools : undefined
  }

  async write(name: string, config: McpServerConfig, tools: McpToolInfo[]): Promise<void> {
    await this.store.update(KEY, { ...this.entries(), [name]: { config: fingerprint(config), tools } })
  }

  private entries(): Record<string, Entry> {
    return this.store.get<Record<string, Entry>>(KEY) ?? {}
  }
}

const fingerprint = (config: McpServerConfig): string => createHash('sha256').update(JSON.stringify(config)).digest('hex')
