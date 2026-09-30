import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readOptional } from '../workspace-files'
import { isUsableServerName, userMcpConfigPath } from './mcp-config'

const CLAUDE_CONFIG_FILE = '.claude.json'

/**
 * Claude Code keeps the user's servers in `~/.claude.json`, its own settings
 * file, rather than in the `.mcp.json` format it reads per workspace and every
 * other tool understands. They are copied into `~/.mcp.json` so both read the
 * same list.
 *
 * The copy happens only when there is no `~/.mcp.json` yet: that file's
 * existence is the record of the move, so a server the user then removes stays
 * removed. Servers are copied verbatim, `${VAR}` placeholders and all.
 *
 * Returns the names copied, empty when there was nothing to do.
 */
export async function migrateClaudeMcpServers(home: string = homedir()): Promise<string[]> {
  if ((await readOptional(userMcpConfigPath(home))) !== undefined) return []
  const text = await readOptional(join(home, CLAUDE_CONFIG_FILE))
  if (text === undefined) return []
  const servers = claudeServers(text)
  const names = Object.keys(servers)
  if (names.length === 0) return []
  await writeFile(userMcpConfigPath(home), `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`, 'utf8')
  return names
}

/** The `mcpServers` of Claude Code's settings, without the names `.mcp.json` refuses. */
function claudeServers(text: string): Record<string, unknown> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`${CLAUDE_CONFIG_FILE}: not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const servers = (json as { mcpServers?: unknown } | null)?.mcpServers
  if (typeof servers !== 'object' || servers === null) return {}
  return Object.fromEntries(Object.entries(servers).filter(([name]) => isUsableServerName(name)))
}
