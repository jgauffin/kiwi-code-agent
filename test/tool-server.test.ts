import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { jsonQueryTool, jsonSchemaTool } from '../src/agent/openai-session/tools/json'
import { ReadTracker } from '../src/agent/openai-session/tools/read-tracker'
import { bareToolName, toMcpTool, TOOL_SERVER_NAME } from '../src/agent/sdk-session/tool-server'

const ctx = { cwd: resolve(import.meta.dirname, 'fixtures-json'), signal: new AbortController().signal, files: new ReadTracker() }

describe('tool server', () => {
  it('strips_only_the_own_server_prefix', () => {
    expect(bareToolName(`mcp__${TOOL_SERVER_NAME}__JsonQuery`)).toBe('JsonQuery')
    expect(bareToolName('mcp__docs-server__json_query')).toBe('mcp__docs-server__json_query')
    expect(bareToolName('Read')).toBe('Read')
  })

  it('wraps_a_tool_as_an_mcp_tool_that_keeps_name_schema_and_read_only_hint', () => {
    const mcp = toMcpTool(jsonSchemaTool, ctx)
    expect(mcp.name).toBe('JsonSchema')
    expect(mcp.description).toBe(jsonSchemaTool.description)
    expect(Object.keys(mcp.inputSchema)).toEqual(['file_path', 'depth', 'sample'])
    expect(mcp.annotations).toEqual({ readOnlyHint: true })
  })

  it('handler_runs_the_tool_and_maps_its_output_and_error_flag', async () => {
    const mcp = toMcpTool(jsonQueryTool, ctx)
    const ok = await mcp.handler({ file_path: 'orders.json', expr: '$.orders[*].id', limit: undefined, max_string: undefined }, {})
    expect(ok.isError).toBe(false)
    expect(JSON.parse((ok.content[0] as { text: string }).text).matched).toBe(5)
    const missing = await mcp.handler({ file_path: 'nope.json', expr: '$', limit: undefined, max_string: undefined }, {})
    expect(missing.isError).toBe(true)
    expect((missing.content[0] as { text: string }).text).toContain('nope.json')
  })
})
