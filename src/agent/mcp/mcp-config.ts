import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { readOptional } from '../workspace-files'
import { TOOL_SERVER_NAME } from '../sdk-session/tool-server'

/**
 * One server of the workspace's `.mcp.json`, in the shape the Agent SDK takes
 * (`McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig`) so the
 * Claude engine passes it on as is and the own loop connects to it itself.
 */
export type McpServerConfig =
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> }

export type McpServers = Record<string, McpServerConfig>

export const MCP_CONFIG_FILE = '.mcp.json'

export const mcpConfigPath = (workspaceRoot: string): string => join(workspaceRoot, MCP_CONFIG_FILE)

/** The same file in the home directory, holding the servers every workspace gets. */
export const userMcpConfigPath = (home: string): string => join(home, MCP_CONFIG_FILE)

type Env = Record<string, string | undefined>

const stdioSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

const remoteSchema = z.object({
  type: z.enum(['sse', 'http', 'streamable-http']),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
})

/**
 * A name becomes the middle of `mcp__<server>__<tool>`, so `__` inside it
 * would make the tool name ambiguous; the own server's name is taken.
 */
const nameSchema = z
  .string()
  .regex(/^[A-Za-z0-9][\w-]*$/, 'a server name is letters, digits, - and _')
  .refine((name) => !name.includes('__'), 'a server name cannot contain __')
  .refine((name) => name !== TOOL_SERVER_NAME, `"${TOOL_SERVER_NAME}" is the extension's own server`)

/** Whether a name would be accepted, so a copy from elsewhere can leave out what the file refuses. */
export const isUsableServerName = (name: string): boolean => nameSchema.safeParse(name).success

const fileSchema = z.object({
  mcpServers: z.record(nameSchema, z.union([stdioSchema, remoteSchema])).default({}),
})

/** `${VAR}` and `${VAR:-default}` from the environment; an unset variable without a default is an error naming it. */
export function expandEnv(value: string, env: Env): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name: string, fallback: string | undefined) => {
    const found = env[name]
    if (found !== undefined) return found
    if (fallback !== undefined) return fallback
    throw new Error(`environment variable ${name} is not set`)
  })
}

/** Pure: the file's text in, servers out. Throws naming the field that is wrong. */
export function parseMcpConfig(text: string, env: Env): McpServers {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = fileSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    throw new Error(`${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  const servers: McpServers = {}
  for (const [name, config] of Object.entries(parsed.data.mcpServers)) {
    try {
      servers[name] = normalise(config, env)
    } catch (error) {
      throw new Error(`mcpServers.${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return servers
}

function normalise(config: z.infer<typeof stdioSchema> | z.infer<typeof remoteSchema>, env: Env): McpServerConfig {
  const expand = (value: string) => expandEnv(value, env)
  const expandAll = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, expand(v)]))
  if ('command' in config) {
    return {
      type: 'stdio',
      command: expand(config.command),
      ...(config.args ? { args: config.args.map(expand) } : {}),
      ...(config.env ? { env: expandAll(config.env) } : {}),
    }
  }
  return {
    type: config.type === 'sse' ? 'sse' : 'http',
    url: expand(config.url),
    ...(config.headers ? { headers: expandAll(config.headers) } : {}),
  }
}

/**
 * The servers in force: the user's `~/.mcp.json` serves every workspace and
 * the workspace's own `.mcp.json` goes over it, so a workspace can replace a
 * user server by name. No file is no servers; a broken file is an error
 * naming the file.
 */
export async function readMcpConfig(workspaceRoot: string, env: Env = process.env, home: string = homedir()): Promise<McpServers> {
  const user = await readServerFile(userMcpConfigPath(home), env)
  const workspace = await readServerFile(mcpConfigPath(workspaceRoot), env)
  return { ...user, ...workspace }
}

async function readServerFile(path: string, env: Env): Promise<McpServers> {
  const text = await readOptional(path)
  if (text === undefined) return {}
  try {
    return parseMcpConfig(text, env)
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
