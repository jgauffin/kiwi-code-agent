import { isReadOnlySegment } from './read-only-commands'
import { splitShellCommand } from './shell-split'

/**
 * A rule is `Tool` (every use), `Tool(pattern)` where the pattern is a glob on
 * the workspace-relative path for file tools, or for Bash a command: `npm test`
 * matches that exact command, `npm run:*` any command starting with those words.
 * Pure, so the webview can name the rule a button will write.
 */
export type PermissionRule = { tool: string; pattern?: string }

export function parseRule(rule: string): PermissionRule {
  const match = /^([A-Za-z_]\w*)(?:\((.*)\))?$/s.exec(rule.trim())
  if (!match) throw new Error(`Not a permission rule: "${rule}" (expected Tool or Tool(pattern))`)
  return match[2] === undefined ? { tool: match[1]! } : { tool: match[1]!, pattern: match[2] }
}

export function formatRule(rule: PermissionRule): string {
  return rule.pattern === undefined ? rule.tool : `${rule.tool}(${rule.pattern})`
}

/** Tools whose command word takes a subcommand that decides what they do. */
const SUBCOMMAND_TOOLS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'git', 'dotnet', 'cargo', 'go', 'docker', 'gh', 'az', 'kubectl'])

/** The words of a segment that "Allow for project" remembers: the command, plus its subcommand for tools that have one. */
export function commandPrefix(tokens: string[]): string[] {
  const [command, sub] = tokens
  if (!command) return []
  const name = command.replace(/\\/g, '/').split('/').pop()!
  if (SUBCOMMAND_TOOLS.has(name) && sub && !sub.startsWith('-')) return [name, sub]
  return [name]
}

/** The rules "Allow for project" writes for this call. */
export function projectRulesFor(toolName: string, input: unknown): string[] {
  if (toolName !== 'Bash') return [toolName]
  const command = (input as { command?: unknown })?.command
  if (typeof command !== 'string') return [toolName]
  const rules = new Set<string>()
  for (const segment of splitShellCommand(command).segments) {
    if (isReadOnlySegment(segment)) continue
    const prefix = commandPrefix(segment.tokens)
    if (prefix.length) rules.add(formatRule({ tool: 'Bash', pattern: `${prefix.join(' ')}:*` }))
  }
  return rules.size ? [...rules] : [toolName]
}

/** What the button says it will allow: `npm run, npx vitest`, or the tool name. */
export function ruleLabel(rules: string[]): string {
  return rules
    .map(parseRule)
    .map((r) => (r.pattern === undefined ? r.tool : r.pattern.replace(/:\*$/, '')))
    .join(', ')
}

/** Does a Bash rule pattern cover this segment? */
export function bashPatternMatches(pattern: string, tokens: string[]): boolean {
  const prefix = pattern.endsWith(':*')
  const words = splitShellCommand(prefix ? pattern.slice(0, -2) : pattern).segments[0]?.tokens ?? []
  if (words.length === 0) return false
  if (!prefix && tokens.length !== words.length) return false
  if (tokens.length < words.length) return false
  return words.every((w, i) => w === tokens[i])
}
