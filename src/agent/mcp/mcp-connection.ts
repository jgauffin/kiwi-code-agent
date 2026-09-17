import { z } from 'zod'
import type { McpServerConfig } from './mcp-config'
import type { Tool, ToolOutput } from '../openai-session/tools/tool'

/** A tool as an MCP server lists it; the schema is the server's own JSON schema. */
export type McpToolInfo = { name: string; description?: string; inputSchema: Record<string, unknown> }

/** One open connection to one MCP server. */
export interface McpConnection {
  listTools(): Promise<McpToolInfo[]>
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutput>
  close(): Promise<void>
}

/** Opens a connection to one server; rejects when the server cannot be reached. A test swaps a fake in. */
export type McpConnector = (name: string, config: McpServerConfig) => Promise<McpConnection>

/** The name both engines, the permission rules and the transcript use for a server's tool. */
export const mcpToolName = (server: string, tool: string): string => `mcp__${server}__${tool}`

/**
 * A server's tool as the own loop runs it. The server validates its own
 * input, so anything object-shaped passes through; it never runs without
 * asking, since what a foreign tool does is the server's word only.
 */
export function mcpTool(server: string, info: McpToolInfo, connection: McpConnection): Tool {
  return {
    name: mcpToolName(server, info.name),
    description: info.description ?? '',
    schema: z.looseObject({}),
    parameters: info.inputSchema,
    readOnly: false,
    execute: (input, ctx) => connection.callTool(info.name, input, ctx.signal),
  }
}
