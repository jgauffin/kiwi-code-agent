import { isAbsolute, matchesGlob, relative, resolve } from 'node:path'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import type { SessionEvent } from '../session/code-session'
import { isReadOnlyCommand, isReadOnlySegment, type ReadOnlyContext } from './read-only-commands'
import { bashPatternMatches, commandLines, isShellTool, parseRule, type PermissionRule } from './permission-rules'
import { splitShellCommand, type ShellSegment } from './shell-split'

export type PermissionRules = { allow: string[]; deny: string[] }

/**
 * Tools that only look; their calls never prompt unless a deny rule names them.
 * `AskUser` changes nothing either: the person answers the question itself
 * rather than first being asked whether it may be put to them.
 */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'LS', 'NotebookRead', 'TodoRead', 'TodoWrite', 'AskUser'])

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'LS'])

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
    const denied = deny.find((rule) => this.matches(parseRule(rule), tool, 'any'))
    if (denied) return { deny: `Blocked by the project's permission rule ${denied} (kiwiAgent.permissions.deny).` }
    if (this.isReadOnly(tool)) return { allow: true }
    if (allow.some((rule) => this.matches(parseRule(rule), tool, 'all'))) return { allow: true }
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

  /**
   * For a shell tool, `all` requires the rule to cover every segment (an
   * allow), while `any` fires on one (a deny). A substitution hides a command,
   * so no allow rule can cover it.
   */
  private matches(rule: PermissionRule, tool: ToolUse, segments: 'all' | 'any'): boolean {
    if (rule.tool !== tool.toolName) return false
    if (rule.pattern === undefined) return !isShellTool(tool.toolName) || segments === 'any' || !splitShellCommand(this.command(tool)).substitutes
    if (isShellTool(tool.toolName)) {
      const parsed = splitShellCommand(this.command(tool))
      if (segments === 'all' && parsed.substitutes) return false
      const covered = (s: ShellSegment) => bashPatternMatches(rule.pattern!, s.tokens) || (segments === 'all' && isReadOnlySegment(s, this.readOnlyContext))
      return segments === 'all' ? parsed.segments.every(covered) : parsed.segments.some(covered)
    }
    if (FILE_TOOLS.has(tool.toolName)) {
      const path = this.relativePath(tool)
      return path !== undefined && matchesGlob(path, rule.pattern)
    }
    return false
  }

  private command(tool: { input: unknown }): string {
    const command = (tool.input as { command?: unknown })?.command
    return typeof command === 'string' ? command : ''
  }

  private relativePath(tool: ToolUse): string | undefined {
    const input = (tool.input ?? {}) as Record<string, unknown>
    const raw = input['file_path'] ?? input['notebook_path'] ?? input['path']
    return typeof raw === 'string' ? this.relativeTo(raw) : undefined
  }

  private relativeTo(raw: string): string {
    const absolute = isAbsolute(raw) ? raw : resolve(this.cwd, raw)
    return relative(this.cwd, absolute).split('\\').join('/')
  }
}
