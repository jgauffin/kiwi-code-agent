import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { z } from 'zod'
import type { Tool, ToolContext } from '../openai-session/tools/tool'

/**
 * The SDK has no tool surface besides MCP, so the tools this extension owns
 * reach Claude through an in-process MCP server. No transport or subprocess:
 * the handler runs here. The engine names them `mcp__<server>__<tool>`;
 * `bareToolName` takes that prefix off again so both engines, the permission
 * rules and the transcript speak of the same `JsonQuery`.
 */
export const TOOL_SERVER_NAME = 'kiwi'

const PREFIX = `mcp__${TOOL_SERVER_NAME}__`

export function bareToolName(engineName: string): string {
  return engineName.startsWith(PREFIX) ? engineName.slice(PREFIX.length) : engineName
}

export function toolServer(tools: Tool[], ctx: ToolContext): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: TOOL_SERVER_NAME, tools: tools.map((t) => toMcpTool(t, ctx)) })
}

export function toMcpTool<S extends z.ZodObject>(t: Tool<S>, ctx: ToolContext): SdkMcpToolDefinition<S['shape']> {
  return tool(
    t.name,
    t.description,
    t.schema.shape,
    async (args) => {
      const output = await t.execute(args as z.infer<S>, ctx)
      return { content: [{ type: 'text', text: output.text }], isError: output.isError }
    },
    { annotations: { readOnlyHint: t.readOnly } },
  )
}
