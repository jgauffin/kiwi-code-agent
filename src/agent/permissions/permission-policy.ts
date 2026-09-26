import { isAbsolute, matchesGlob, relative, resolve } from 'node:path'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import type { SessionEvent } from '../session/code-session'
import { isReadOnlyCommand, isReadOnlySegment, type ReadOnlyContext } from './read-only-commands'
import { bashPatternMatches, commandLines, isShellTool, parseRule, ruleCoversTool, TRANSFER_TOOLS, type PermissionRule } from './permission-rules'
import { splitShellCommand, type ShellSegment } from './shell-split'

export type PermissionRules = { allow: string[]; deny: string[] }

/**
 * Tools that only look; their calls never prompt unless a deny rule names them.
 * `AskUser` changes nothing either: the person answers the question itself
 * rather than first being asked whether it may be put to them.
 */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'LS', 'NotebookRead', 'TodoRead', 'TodoWrite', 'AskUser'])

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'LS', ...TRANSFER_TOOLS])

/**
 * Decides tool calls before any permission prompt, on every engine: a deny
 * rule blocks, a read-only call or one covered by the project's allow rules
 * goes through, everything else is asked. Rules are read on each call so a
 * rule allowed for the session or the project applies to the next call.
 */
export class PermissionPolicy implements SessionHooks {
  private readonly readOnlyContext: ReadOnlyContext

  constructor(
    private readonly cwd: string,
    private readonly rules: () => PermissionRules,
  ) {
    this.readOnlyContext = { insideProject: (path) => !this.relativeTo(path).startsWith('..') }
  }

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    const { allow, deny } = this.rules()
    const denied = deny.find((rule) => this.denies(parseRule(rule), tool))
    if (denied) return { deny: `Blocked by the project's permission rule ${denied} (kiwiAgent.permissions.deny).` }
    if (this.isReadOnly(tool)) return { allow: true }
    if (this.allows(allow, tool)) return { allow: true }
    return undefined
  }

  /** A prompt for a shell call is asked line by line: each command with what the rules in force make of it. */
  decorate(event: SessionEvent): SessionEvent {
    if (event.type !== 'permission_request' || !isShellTool(event.toolName)) return event
    return { ...event, commands: commandLines(event.toolName, this.command(event), this.rules().allow, this.readOnlyContext) }
  }

  private isReadOnly(tool: ToolUse): boolean {
    if (READ_ONLY_TOOLS.has(tool.toolName)) return true
    return isShellTool(tool.toolName) && isReadOnlyCommand(this.command(tool), this.readOnlyContext)
  }

  /** One part is enough: a segment of a shell call, or either end of a move. */
  private denies(rule: PermissionRule, tool: ToolUse): boolean {
    if (!ruleCoversTool(rule.tool, tool.toolName)) return false
    if (rule.pattern === undefined) return true
    if (isShellTool(tool.toolName)) return splitShellCommand(this.command(tool)).segments.some((s) => bashPatternMatches(rule.pattern!, s.tokens))
    if (FILE_TOOLS.has(tool.toolName)) return this.relativePaths(tool).some((path) => matchesGlob(path, rule.pattern!))
    return false
  }

  /**
   * Every segment of a shell call has to be let through, but not by the same
   * rule: rules allowed one at a time add up, which is what the prompt shows
   * line by line. A substitution hides a command, so no rule can cover it. A
   * move touches both its ends, so one rule must cover both.
   */
  private allows(allow: string[], tool: ToolUse): boolean {
    const rules = allow.map(parseRule).filter((rule) => ruleCoversTool(rule.tool, tool.toolName))
    if (isShellTool(tool.toolName)) {
      const parsed = splitShellCommand(this.command(tool))
      if (parsed.substitutes) return false
      const covered = (s: ShellSegment) => isReadOnlySegment(s, this.readOnlyContext) || rules.some((r) => r.pattern === undefined || bashPatternMatches(r.pattern, s.tokens))
      return parsed.segments.every(covered)
    }
    const paths = this.relativePaths(tool)
    return rules.some((rule) => {
      if (rule.pattern === undefined) return true
      return FILE_TOOLS.has(tool.toolName) && paths.length > 0 && paths.every((path) => matchesGlob(path, rule.pattern!))
    })
  }

  private command(tool: { input: unknown }): string {
    const command = (tool.input as { command?: unknown })?.command
    return typeof command === 'string' ? command : ''
  }

  private relativePaths(tool: ToolUse): string[] {
    const input = (tool.input ?? {}) as Record<string, unknown>
    const raw = TRANSFER_TOOLS.has(tool.toolName) ? [input['source'], input['destination']] : [input['file_path'] ?? input['notebook_path'] ?? input['path']]
    return raw.filter((p): p is string => typeof p === 'string').map((p) => this.relativeTo(p))
  }

  private relativeTo(raw: string): string {
    const absolute = isAbsolute(raw) ? raw : resolve(this.cwd, raw)
    return relative(this.cwd, absolute).split('\\').join('/')
  }
}
