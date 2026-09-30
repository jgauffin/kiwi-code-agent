import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandEnv, parseMcpConfig, readMcpConfig } from '../src/agent/mcp/mcp-config'

const env = { TOKEN: 'secret', HOME_DIR: '/home/x' }

describe('mcp config', () => {
  it('a_stdio_server_without_a_type_is_stdio', () => {
    const servers = parseMcpConfig('{"mcpServers":{"docs":{"command":"node","args":["server.js"]}}}', env)
    expect(servers).toEqual({ docs: { type: 'stdio', command: 'node', args: ['server.js'] } })
  })

  it('streamable_http_is_read_as_http', () => {
    const servers = parseMcpConfig('{"mcpServers":{"remote":{"type":"streamable-http","url":"https://x.test/mcp"}}}', env)
    expect(servers).toEqual({ remote: { type: 'http', url: 'https://x.test/mcp' } })
  })

  it('env_placeholders_are_expanded_in_command_args_env_url_and_headers', () => {
    const text = JSON.stringify({
      mcpServers: {
        local: { command: '${HOME_DIR}/bin/mcp', args: ['--token', '${TOKEN}'], env: { KEY: '${TOKEN}', MISSING: '${NOPE:-fallback}' } },
        remote: { type: 'sse', url: 'https://x.test/${TOKEN}', headers: { Authorization: 'Bearer ${TOKEN}' } },
      },
    })
    expect(parseMcpConfig(text, env)).toEqual({
      local: { type: 'stdio', command: '/home/x/bin/mcp', args: ['--token', 'secret'], env: { KEY: 'secret', MISSING: 'fallback' } },
      remote: { type: 'sse', url: 'https://x.test/secret', headers: { Authorization: 'Bearer secret' } },
    })
  })

  it('an_unset_variable_without_a_default_names_the_variable_in_the_error', () => {
    expect(() => expandEnv('${NOPE}', env)).toThrow('NOPE')
    expect(() => parseMcpConfig('{"mcpServers":{"a":{"command":"${NOPE}"}}}', env)).toThrow(/a.*NOPE/)
  })

  it('a_bad_file_names_the_field_that_is_wrong', () => {
    expect(() => parseMcpConfig('{"mcpServers":{"a":{"args":[]}}}', env)).toThrow(/mcpServers\.a/)
    expect(() => parseMcpConfig('not json', env)).toThrow(/JSON/)
  })

  it('a_server_name_with_a_double_underscore_or_the_own_server_name_is_refused', () => {
    expect(() => parseMcpConfig('{"mcpServers":{"a__b":{"command":"x"}}}', env)).toThrow(/a__b/)
    expect(() => parseMcpConfig('{"mcpServers":{"kiwi":{"command":"x"}}}', env)).toThrow(/kiwi/)
  })

  it('a_missing_file_is_no_servers_and_a_present_one_is_read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-'))
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    expect(await readMcpConfig(dir, env, home)).toEqual({})
    await writeFile(join(dir, '.mcp.json'), '{"mcpServers":{"docs":{"command":"node"}}}')
    expect(await readMcpConfig(dir, env, home)).toEqual({ docs: { type: 'stdio', command: 'node' } })
    await writeFile(join(dir, '.mcp.json'), '{')
    await expect(readMcpConfig(dir, env, home)).rejects.toThrow(/\.mcp\.json/)
  })

  it('the_users_servers_serve_every_workspace_and_the_workspace_replaces_one_by_name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-'))
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    await writeFile(join(home, '.mcp.json'), '{"mcpServers":{"docs":{"command":"user"},"shared":{"command":"user"}}}')
    expect(await readMcpConfig(dir, env, home)).toEqual({ docs: { type: 'stdio', command: 'user' }, shared: { type: 'stdio', command: 'user' } })
    await writeFile(join(dir, '.mcp.json'), '{"mcpServers":{"shared":{"command":"workspace"}}}')
    expect(await readMcpConfig(dir, env, home)).toEqual({ docs: { type: 'stdio', command: 'user' }, shared: { type: 'stdio', command: 'workspace' } })
  })

  it('a_broken_user_file_names_its_path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-'))
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    await writeFile(join(home, '.mcp.json'), '{')
    await expect(readMcpConfig(dir, env, home)).rejects.toThrow(home)
  })
})
