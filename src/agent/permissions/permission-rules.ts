import { commandName, unwrapCommand } from './command-wrappers'
import { NO_PROJECT_COMMANDS, projectCommandOf, type ProjectCommands } from './project-commands'
import type { ProjectPaths } from './project-paths'
import { cdTarget, hidesCommandWord, isCdCommand, isReadOnlySegment, type ReadOnlyContext } from './read-only-commands'
import { splitShellCommand, type ShellSegment } from './shell-split'
import { WRITE_TOOLS } from './tool-classes'
import { commandWriteTargets, writesInProject } from './write-targets'

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

/** Tools whose command word takes a subcommand that decides what they do. */
const SUBCOMMAND_TOOLS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'git', 'dotnet', 'cargo', 'go', 'docker', 'gh', 'az', 'kubectl'])

/** A command is named without its path, so `./build.cmd` and `build.cmd` are the same command. */
/** The words of a segment that "Allow for project" remembers: the command, plus its subcommand for tools that have one. */
export function commandPrefix(tokens: string[]): string[] {
  // A rule remembered for `timeout` would cover everything it ever wraps, so the wrapper is taken off first.
  const [command, sub] = unwrapCommand(tokens)
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
  /** What already lets it through: `read-only`, a command the project defines, or the rule that covers it. Absent when this line is part of why the call is asked about. */
  passes?: string
  /** The rule that would cover it, for "Allow for session" and "Allow for project". Absent when it passes, or when no rule can stand for it. */
  rule?: string
}

/**
 * A shell call line by line, against the allow rules in force. A command a
 * substitution holds gets a line of its own and is judged like any other; only
 * a line whose command word is a substitution passes nothing and is offered no
 * rule, since no rule can name what it will run. `writes` is given only while
 * "Allow writes" is on, and then decides which file-changing lines the switch
 * already covers.
 */
export function commandLines(
  toolName: string,
  command: string,
  allow: string[],
  context: ReadOnlyContext = {},
  project: ProjectCommands = NO_PROJECT_COMMANDS,
  writes?: ProjectPaths,
): CommandLine[] {
  const parsed = splitShellCommand(command)
  const patterns = allow.map(parseRule).filter((r) => r.tool === toolName && r.pattern !== undefined)
  const covers = writes && staysInProject(parsed.segments, writes) ? writes.below : undefined
  return parsed.segments.map((segment) => {
    const { text } = segment
    if (hidesCommandWord(segment)) return { text }
    if (isReadOnlySegment(segment, context)) return { text, passes: 'read-only' }
    if (covers && writesInProject(commandWriteTargets(segment), covers)) return { text, passes: 'the Allow writes switch' }
    const defined = projectCommandOf(segment, project)
    if (defined) return { text, passes: defined }
    const covering = patterns.find((r) => bashPatternMatches(r.pattern!, segment.tokens))
    if (covering) return { text, passes: formatRule(covering) }
    const directory = cdTarget(segment.tokens)
    if (directory) return { text, rule: formatRule({ tool: toolName, pattern: `cd ${directory}` }) }
    const prefix = commandPrefix(segment.tokens)
    return prefix.length ? { text, rule: formatRule({ tool: toolName, pattern: `${prefix.join(' ')}:*` }) } : { text }
  })
}

/**
 * Does the whole call stay in the project? Every path a command names is read
 * from the project root, but a `cd` moves the directory the shell reads them
 * from, so `cd /elsewhere && rm -rf data` would otherwise be judged on
 * `<project>/data` while it removes `/elsewhere/data`. A `cd` that stays in the
 * project is harmless here: it can only push the root deeper, and a relative
 * path that lands in the project from the root lands in it from deeper still.
 */
export function staysInProject(segments: ShellSegment[], paths: ProjectPaths): boolean {
  return segments.every((segment) => {
    if (!isCdCommand(segment.tokens)) return true
    const target = cdTarget(segment.tokens)
    return target !== undefined && paths.inside(target)
  })
}

/** What a button says it will allow: `npm run` for `Bash(npm run:*)`, or the tool name. */
export function ruleLabel(rule: string): string {
  const parsed = parseRule(rule)
  return parsed.pattern === undefined ? parsed.tool : parsed.pattern.replace(/:\*$/, '')
}

/**
 * Does a Bash rule pattern cover this segment? Both sides are judged on the
 * command that runs, so a rule for `npm test` covers `timeout 300 npm test`
 * and a deny rule for `rm` is not walked past by wrapping it.
 */
export function bashPatternMatches(pattern: string, tokens: string[]): boolean {
  const prefix = pattern.endsWith(':*')
  const words = unwrapCommand(splitShellCommand(prefix ? pattern.slice(0, -2) : pattern).segments[0]?.tokens ?? [])
  const run = unwrapCommand(tokens)
  if (words.length === 0) return false
  if (!prefix && run.length !== words.length) return false
  if (run.length < words.length) return false
  return words.every((w, i) => (i === 0 ? commandName(w) === commandName(run[i]!) : w === run[i]))
}
