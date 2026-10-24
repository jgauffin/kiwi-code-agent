import { describe, expect, it } from 'vitest'
import type { McpConnector, McpToolInfo } from '../src/agent/mcp/mcp-connection'
import { McpToolCache } from '../src/agent/mcp/mcp-tool-cache'
import { McpToolHost } from '../src/agent/mcp/mcp-tool-host'
import { toDefinition } from '../src/agent/openai-session/tools/tool'
import { ReadTracker } from '../src/agent/openai-session/tools/read-tracker'
import { fakeConnector, memoryStore } from './fake-mcp'

const echo: McpToolInfo = { name: 'echo', description: 'Echoes', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }
const shout: McpToolInfo = { name: 'shout', inputSchema: { type: 'object' } }
const docs = { type: 'stdio' as const, command: 'x' }

const ctx = { cwd: '/w', signal: new AbortController().signal, files: new ReadTracker() }

describe('McpToolHost', () => {
  it('a_server_never_seen_is_started_to_learn_its_tools_and_they_carry_the_server_s_name_and_schema', async () => {
    const fake = fakeConnector({ docs: [echo] })
    const host = new McpToolHost(fake.connect, new McpToolCache(memoryStore()))
    await host.load({ docs })
    const [tool] = host.tools()
    expect(fake.connects).toEqual(['docs'])
    expect(tool!.name).toBe('mcp__docs__echo')
    expect(tool!.readOnly).toBe(false)
    expect(toDefinition(tool!)).toEqual({ name: 'mcp__docs__echo', description: 'Echoes', parameters: echo.inputSchema })
    expect(await tool!.execute({ value: 'hi' }, ctx)).toEqual({ text: 'docs:echo', isError: false })
    expect(fake.calls).toEqual([{ server: 'docs', tool: 'echo', args: { value: 'hi' } }])
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'connected' }])
  })

  it('a_server_whose_tools_are_remembered_is_not_started_until_one_of_them_is_called', async () => {
    const store = memoryStore()
    await new McpToolHost(fakeConnector({ docs: [echo] }).connect, new McpToolCache(store)).load({ docs })

    const fake = fakeConnector({ docs: [echo] })
    const host = new McpToolHost(fake.connect, new McpToolCache(store))
    await host.load({ docs })
    expect(fake.connects).toEqual([])
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'stopped' }])
    expect(host.tools().map((t) => t.name)).toEqual(['mcp__docs__echo'])

    const [tool] = host.tools()
    await Promise.all([tool!.execute({}, ctx), tool!.execute({}, ctx)])
    expect(fake.connects).toEqual(['docs'])
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'connected' }])
  })

  it('a_remembered_list_holds_only_for_the_configuration_it_was_read_under', async () => {
    const store = memoryStore()
    await new McpToolHost(fakeConnector({ docs: [echo] }).connect, new McpToolCache(store)).load({ docs })
    const fake = fakeConnector({ docs: [shout] })
    const host = new McpToolHost(fake.connect, new McpToolCache(store))
    await host.load({ docs: { ...docs, args: ['--other'] } })
    expect(fake.connects).toEqual(['docs'])
    expect(host.tools().map((t) => t.name)).toEqual(['mcp__docs__shout'])
  })

  it('a_server_listing_other_tools_than_remembered_offers_what_it_lists_now_and_is_remembered_so', async () => {
    const store = memoryStore()
    await new McpToolHost(fakeConnector({ docs: [echo] }).connect, new McpToolCache(store)).load({ docs })
    const host = new McpToolHost(fakeConnector({ docs: [echo, shout] }).connect, new McpToolCache(store))
    await host.load({ docs })
    await host.start('docs')
    expect(host.tools().map((t) => t.name)).toEqual(['mcp__docs__echo', 'mcp__docs__shout'])
    expect(new McpToolCache(store).read('docs', docs)).toEqual([echo, shout])
  })

  it('a_server_that_fails_to_start_is_a_failed_status_and_the_others_still_load', async () => {
    const fake = fakeConnector({ docs: [echo], broken: new Error('spawn nope ENOENT') })
    const host = new McpToolHost(fake.connect, new McpToolCache(memoryStore()))
    await host.load({ docs, broken: { type: 'stdio', command: 'nope' } })
    expect(host.statuses()).toEqual([
      { name: 'docs', status: 'connected' },
      { name: 'broken', status: 'failed', error: 'spawn nope ENOENT' },
    ])
    expect(host.tools().map((t) => t.name)).toEqual(['mcp__docs__echo'])
  })

  it('a_call_to_a_server_that_cannot_start_answers_with_why_instead_of_throwing', async () => {
    const store = memoryStore()
    await new McpToolHost(fakeConnector({ docs: [echo] }).connect, new McpToolCache(store)).load({ docs })
    const host = new McpToolHost(fakeConnector({ docs: new Error('spawn x ENOENT') }).connect, new McpToolCache(store))
    await host.load({ docs })
    expect(await host.tools()[0]!.execute({}, ctx)).toEqual({ text: 'MCP server docs could not be started: spawn x ENOENT', isError: true })
  })

  it('a_stopped_server_keeps_its_tools_and_the_next_call_starts_it_again', async () => {
    const fake = fakeConnector({ docs: [echo] })
    const host = new McpToolHost(fake.connect, new McpToolCache(memoryStore()))
    await host.load({ docs })
    await host.stop('docs')
    expect(fake.closed).toEqual(['docs'])
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'stopped' }])
    expect(host.tools().map((t) => t.name)).toEqual(['mcp__docs__echo'])
    await host.tools()[0]!.execute({}, ctx)
    expect(fake.connects).toEqual(['docs', 'docs'])
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'connected' }])
  })

  it('a_server_killed_from_outside_is_stopped_and_the_next_call_starts_what_was_rebuilt', async () => {
    const servers = { docs: [echo] }
    const fake = fakeConnector(servers)
    const host = new McpToolHost(fake.connect, new McpToolCache(memoryStore()))
    const seen: string[] = []
    host.watch(() => seen.push(host.statuses()[0]!.status))
    await host.load({ docs })
    fake.kill('docs')
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'stopped' }])
    expect(seen.at(-1)).toBe('stopped')

    servers.docs = [echo, shout]
    expect(await host.tools()[0]!.execute({}, ctx)).toEqual({ text: 'docs:echo', isError: false })
    expect(fake.connects).toEqual(['docs', 'docs'])
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'connected' }])
    expect(host.tools().map((t) => t.name)).toEqual(['mcp__docs__echo', 'mcp__docs__shout'])
  })

  it('a_call_the_connection_fails_answers_with_why_instead_of_throwing', async () => {
    const connect: McpConnector = async () => ({
      listTools: async () => [echo],
      callTool: async () => {
        throw new Error('Connection closed')
      },
      close: async () => undefined,
    })
    const host = new McpToolHost(connect, new McpToolCache(memoryStore()))
    await host.load({ docs })
    expect(await host.tools()[0]!.execute({}, ctx)).toEqual({ text: 'MCP server docs failed to run echo: Connection closed', isError: true })
  })

  it('every_change_of_status_is_told_to_the_watchers', async () => {
    const host = new McpToolHost(fakeConnector({ docs: [echo] }).connect, new McpToolCache(memoryStore()))
    const seen: string[] = []
    host.watch(() => seen.push(host.statuses()[0]!.status))
    await host.load({ docs })
    await host.stop('docs')
    expect(seen).toEqual(['pending', 'connected', 'connected', 'stopped'])
  })

  it('a_reload_closes_the_old_connections', async () => {
    const fake = fakeConnector({ docs: [echo], other: [echo] })
    const host = new McpToolHost(fake.connect, new McpToolCache(memoryStore()))
    await host.load({ docs, other: { type: 'stdio', command: 'y' } })
    await host.load({ docs })
    expect(fake.closed).toEqual(['docs', 'other'])
    expect(host.tools().map((t) => t.name)).toEqual(['mcp__docs__echo'])
    expect(host.statuses()).toEqual([{ name: 'docs', status: 'stopped' }])
  })

  it('close_ends_every_connection', async () => {
    const fake = fakeConnector({ docs: [echo] })
    const host = new McpToolHost(fake.connect, new McpToolCache(memoryStore()))
    await host.load({ docs })
    await host.close()
    expect(fake.closed).toEqual(['docs'])
    expect(host.tools()).toEqual([])
  })
})
