import { isReadOnlySegment, type ReadOnlyContext } from './read-only-commands'
import { splitShellCommand } from './shell-split'

/**
 * A rule is `Tool` (every use), `Tool(pattern)` where the pattern is a glob on
 * the workspace-relative path for file tools, or for a shell tool a command:
 * `npm test` matches that exact command, `npm run:*` any command starting with
 * those words. An MCP server's tools are `mcp__<server>__<tool>`, and
 * `mcp__<server>__*` stands for every tool of that server.
 * Pure, so the webview can name the rule a button will write.
 */
export type PermissionRule = { tool: string; pattern?: string }

export function parseRule(rule: string): PermissionRule {
  const match = /^([A-Za-z_][\w-]*|mcp__[\w-]+__\*)(?:\((.*)\))?$/s.exec(rule.trim())
  if (!match) throw new Error(`Not a permission rule: "${rule}" (expected Tool or Tool(pattern))`)
  return match[2] === undefined ? { tool: match[1]! } : { tool: match[1]!, pattern: match[2] }
}

/** Does the rule's tool name stand for this tool: the same name, or the server wildcard over it? */
export function ruleCoversTool(ruleTool: string, toolName: string): boolean {
  if (ruleTool === toolName) return true
  return ruleTool.endsWith('__*') && toolName.startsWith(ruleTool.slice(0, -1))
}

export function formatRule(rule: PermissionRule): string {
  return rule.pattern === undefined ? rule.tool : `${rule.tool}(${rule.pattern})`
}

/** Tools that write a file. A write is answered per call or per session, never remembered for the project. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/**
 * Tools that run a command line. Both are judged, prompted and remembered
 * command by command, each under its own tool name: a rule for one shell says
 * nothing about the other.
 */
const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell'])

export const isShellTool = (toolName: string): boolean => SHELL_TOOLS.has(toolName)

/** Tools whose command word takes a subcommand that decides what they do. */
const SUBCOMMAND_TOOLS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'git', 'dotnet', 'cargo', 'go', 'docker', 'gh', 'az', 'kubectl'])

/** A command is named without its path, so `./build.cmd` and `build.cmd` are the same command. */
const commandName = (command: string): string => command.replace(/\\/g, '/').split('/').pop()!

/** The words of a segment that "Allow for project" remembers: the command, plus its subcommand for tools that have one. */
export function commandPrefix(tokens: string[]): string[] {
  const [command, sub] = tokens
  if (!command) return []
  const name = commandName(command)
  if (SUBCOMMAND_TOOLS.has(name) && sub && !sub.startsWith('-')) return [name, sub]
  return [name]
}

/** The rule "Allow for project" writes for a call that is not a shell command; none for a file write, which is never remembered. */
export function projectRuleFor(toolName: string): string | undefined {
  return WRITE_TOOLS.has(toolName) ? undefined : toolName
}

/** One simple command of a shell call, as the permission prompt lists it. */
export type CommandLine = {
  /** The command as written. */
  text: string
  /** What already lets it through: `read-only`, or the rule that covers it. Absent when this line is part of why the call is asked about. */
  passes?: string
  /** The rule that would cover it, for "Allow for session" and "Allow for project". Absent when it passes, or when no rule can stand for it. */
  rule?: string
}

/**
 * A shell call line by line, against the allow rules in force. A substitution
 * runs a command no line shows, so then nothing passes and no rule is offered:
 * such a call is allowed per call or not at all.
 */
export function commandLines(toolName: string, command: string, allow: string[], context: ReadOnlyContext = {}): CommandLine[] {
  const parsed = splitShellCommand(command)
  const patterns = allow.map(parseRule).filter((r) => r.tool === toolName && r.pattern !== undefined)
  return parsed.segments.map((segment) => {
    const { text } = segment
    if (parsed.substitutes) return { text }
    if (isReadOnlySegment(segment, context)) return { text, passes: 'read-only' }
    const covering = patterns.find((r) => bashPatternMatches(r.pattern!, segment.tokens))
    if (covering) return { text, passes: formatRule(covering) }
    const prefix = commandPrefix(segment.tokens)
    return prefix.length ? { text, rule: formatRule({ tool: toolName, pattern: `${prefix.join(' ')}:*` }) } : { text }
  })
}

/** What a button says it will allow: `npm run` for `Bash(npm run:*)`, or the tool name. */
export function ruleLabel(rule: string): string {
  const parsed = parseRule(rule)
  return parsed.pattern === undefined ? parsed.tool : parsed.pattern.replace(/:\*$/, '')
}

/** Does a Bash rule pattern cover this segment? */
export function bashPatternMatches(pattern: string, tokens: string[]): boolean {
  const prefix = pattern.endsWith(':*')
  const words = splitShellCommand(prefix ? pattern.slice(0, -2) : pattern).segments[0]?.tokens ?? []
  if (words.length === 0) return false
  if (!prefix && tokens.length !== words.length) return false
  if (tokens.length < words.length) return false
  return words.every((w, i) => (i === 0 ? commandName(w) === commandName(tokens[i]!) : w === tokens[i]))
}
