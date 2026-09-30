import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateClaudeMcpServers } from '../src/agent/mcp/migrate-claude-mcp'

const newHome = () => mkdtemp(join(tmpdir(), 'home-'))
const readServers = async (home: string) => JSON.parse(await readFile(join(home, '.mcp.json'), 'utf8')) as unknown

describe('migrating Claude Code MCP servers', () => {
  it('claudes_user_servers_become_the_users_mcp_json', async () => {
    const home = await newHome()
    const servers = {
      docs: { command: 'node', args: ['server.js'] },
      remote: { type: 'streamable-http', url: 'https://x.test/${TOKEN}' },
    }
    await writeFile(join(home, '.claude.json'), JSON.stringify({ numStartups: 4, mcpServers: servers, projects: {} }))
    expect(await migrateClaudeMcpServers(home)).toEqual(['docs', 'remote'])
    // Verbatim, so an unexpanded placeholder stays one and is expanded when the file is read.
    expect(await readServers(home)).toEqual({ mcpServers: servers })
  })

  it('an_existing_user_file_is_left_alone_so_the_move_happens_once', async () => {
    const home = await newHome()
    await writeFile(join(home, '.claude.json'), '{"mcpServers":{"docs":{"command":"node"}}}')
    await writeFile(join(home, '.mcp.json'), '{"mcpServers":{}}')
    expect(await migrateClaudeMcpServers(home)).toEqual([])
    expect(await readServers(home)).toEqual({ mcpServers: {} })
  })

  it('no_claude_settings_no_servers_and_project_servers_are_left_where_they_are', async () => {
    const home = await newHome()
    expect(await migrateClaudeMcpServers(home)).toEqual([])
    await writeFile(join(home, '.claude.json'), JSON.stringify({ projects: { 'C:/work': { mcpServers: { local: { command: 'node' } } } } }))
    expect(await migrateClaudeMcpServers(home)).toEqual([])
  })

  it('a_name_the_format_refuses_is_left_out_rather_than_written_into_a_broken_file', async () => {
    const home = await newHome()
    await writeFile(join(home, '.claude.json'), '{"mcpServers":{"a__b":{"command":"x"},"kiwi":{"command":"x"},"docs":{"command":"node"}}}')
    expect(await migrateClaudeMcpServers(home)).toEqual(['docs'])
    expect(await readServers(home)).toEqual({ mcpServers: { docs: { command: 'node' } } })
  })

  it('broken_claude_settings_name_the_file', async () => {
    const home = await newHome()
    await writeFile(join(home, '.claude.json'), 'not json')
    await expect(migrateClaudeMcpServers(home)).rejects.toThrow(/\.claude\.json/)
  })
})
