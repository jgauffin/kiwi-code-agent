import { isAbsolute, matchesGlob, relative, resolve } from 'node:path'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { isReadOnlyCommand, isReadOnlySegment, type ReadOnlyContext } from './read-only-commands'
import { bashPatternMatches, parseRule, type PermissionRule } from './permission-rules'
import { splitShellCommand, type ShellSegment } from './shell-split'

export type PermissionRules = { allow: string[]; deny: string[] }

/** Tools that only look; their calls never prompt unless a deny rule names them. */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoRead', 'TodoWrite'])

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'LS'])

/**
 * Decides tool calls before any permission prompt, on every engine: a deny
 * rule blocks, a read-only call or one covered by the project's allow rules
 * goes through, everything else is asked. Rules are read on each call so a
 * rule written by "Allow for project" applies to the next call.
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

  private isReadOnly(tool: ToolUse): boolean {
    if (READ_ONLY_TOOLS.has(tool.toolName)) return true
    return tool.toolName === 'Bash' && isReadOnlyCommand(this.command(tool), this.readOnlyContext)
  }

  /**
   * For Bash, `all` requires the rule to cover every segment (an allow), while
   * `any` fires on one (a deny). A substitution hides a command, so no allow
   * rule can cover it.
   */
  private matches(rule: PermissionRule, tool: ToolUse, segments: 'all' | 'any'): boolean {
    if (rule.tool !== tool.toolName) return false
    if (rule.pattern === undefined) return tool.toolName !== 'Bash' || segments === 'any' || !splitShellCommand(this.command(tool)).substitutes
    if (tool.toolName === 'Bash') {
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

  private command(tool: ToolUse): string {
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
