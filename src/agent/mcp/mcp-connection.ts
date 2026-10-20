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

const BRANCHES = ['anyOf', 'oneOf', 'allOf'] as const

/**
 * A server's tool as an engine may offer it. Claude refuses a tool whose
 * schema chooses between shapes at its top level, and refuses the request
 * carrying it, so one such tool would stop every turn of the session; the
 * branches are folded into one object holding all their properties. The
 * server validates its own input, so the looser schema costs nothing.
 */
export function offerable(info: McpToolInfo): McpToolInfo {
  const schema = info.inputSchema
  if (!BRANCHES.some((key) => key in schema)) return info
  const properties: Record<string, unknown> = {}
  collectProperties(schema, properties)
  const rest = { ...schema }
  for (const key of BRANCHES) delete rest[key]
  return { ...info, inputSchema: { ...rest, type: 'object', properties } }
}

function collectProperties(schema: Record<string, unknown>, into: Record<string, unknown>): void {
  if (isRecord(schema.properties)) Object.assign(into, schema.properties)
  for (const key of BRANCHES) {
    const branches = schema[key]
    if (!Array.isArray(branches)) continue
    for (const branch of branches) {
      if (isRecord(branch)) collectProperties(branch, into)
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The name both engines, the permission rules and the transcript use for a server's tool. */
export const mcpToolName = (server: string, tool: string): string => `mcp__${server}__${tool}`

/** Runs one of a server's tools, starting the server first when it is not running. */
export type McpToolCall = (tool: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolOutput>

/**
 * A server's tool as the own loop runs it. The server validates its own
 * input, so anything object-shaped passes through; it never runs without
 * asking, since what a foreign tool does is the server's word only.
 */
export function mcpTool(server: string, info: McpToolInfo, call: McpToolCall): Tool {
  return {
    name: mcpToolName(server, info.name),
    description: info.description ?? '',
    schema: z.looseObject({}),
    parameters: info.inputSchema,
    readOnly: false,
    execute: (input, ctx) => call(info.name, input, ctx.signal),
  }
}
