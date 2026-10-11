import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpToolHost } from './mcp-tool-host'
import { modelText } from '../openai-session/tools/tool'

/** One workspace server as the Claude engine is handed it, and the way to tell the engine its tools changed. */
export type McpProxy = { config: McpSdkServerConfigWithInstance; refresh(): void }

/**
 * A workspace server as the Claude engine sees it: an in-process server of the
 * same name, so its tools keep their `mcp__<server>__<tool>` names, answering
 * from what the host knows and starting the real server only when a tool is
 * called. The engine would otherwise spawn every server as it starts.
 */
export function mcpProxy(name: string, host: McpToolHost): McpProxy {
  const instance = new McpServer({ name, version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } })
  let listed = ''
  instance.server.setRequestHandler(ListToolsRequestSchema, async () => {
    await host.ready(name)
    const tools = host.toolsOf(name)
    listed = JSON.stringify(tools)
    return { tools: tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}), inputSchema: t.inputSchema as { type: 'object' } })) }
  })
  instance.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const output = await host.call(name, request.params.name, request.params.arguments ?? {}, extra.signal)
    return { content: [{ type: 'text', text: modelText(output) }], isError: output.isError }
  })
  return {
    config: { type: 'sdk', name, instance },
    refresh: () => {
      if (listed !== '' && JSON.stringify(host.toolsOf(name)) !== listed && instance.isConnected()) instance.sendToolListChanged()
    },
  }
}
