import { WRITE_TOOLS } from './tool-classes'

/**
 * A rule is `Tool` (every use), `Tool(pattern)` where the pattern is a glob on
 * the workspace-relative path for file tools, or for a shell tool a command:
 * `npm test` matches that exact command, `npm run:*` any command starting with
 * those words. An MCP server's tools are `mcp__<server>__<tool>`, and
 * `mcp__<server>__*` stands for every tool of that server.
 * This file stays free of Node imports, so the webview can name the rule a button will write.
 */
export type PermissionRule = { tool: string; pattern?: string }

export function parseRule(rule: string): PermissionRule {
  const match = /^([A-Za-z_][\w-]*|mcp__[\w-]+__\*)(?:\((.*)\))?$/s.exec(rule.trim())
  if (!match) throw new Error(`Not a permission rule: "${rule}" (expected Tool or Tool(pattern))`)
  return match[2] === undefined ? { tool: match[1]! } : { tool: match[1]!, pattern: match[2] }
}

/** The rule name that stands for every tool that writes a file, so one rule covers a file however it is written. */
export const WRITES_RULE = 'Writes'

/** Does the rule's tool name stand for this tool: the same name, the server wildcard over it, or every write tool? */
export function ruleCoversTool(ruleTool: string, toolName: string): boolean {
  if (ruleTool === toolName) return true
  if (ruleTool === WRITES_RULE) return WRITE_TOOLS.has(toolName)
  return ruleTool.endsWith('__*') && toolName.startsWith(ruleTool.slice(0, -1))
}

export function formatRule(rule: PermissionRule): string {
  return rule.pattern === undefined ? rule.tool : `${rule.tool}(${rule.pattern})`
}

/** The rule "Allow for project" writes for a call that is not a shell command; none for a file write, which is never remembered. */
export function projectRuleFor(toolName: string): string | undefined {
  return WRITE_TOOLS.has(toolName) ? undefined : toolName
}

/** What a button says it will allow: `npm run` for `Bash(npm run:*)`, or the tool name. */
export function ruleLabel(rule: string): string {
  const parsed = parseRule(rule)
  return parsed.pattern === undefined ? parsed.tool : parsed.pattern.replace(/:\*$/, '')
}
