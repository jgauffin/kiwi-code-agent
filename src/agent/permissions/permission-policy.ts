import { matchesGlob } from 'node:path'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import type { SessionEvent } from '../session/code-session'
import { NO_PROJECT_COMMANDS, projectCommandOf, type ProjectCommands } from './project-commands'
import { cdRuleDirectory, hidesCommandWord, isGitWrite, isReadOnlyCommand, isReadOnlySegment, type ReadOnlyContext } from './read-only-commands'
import { bashPatternMatches, commandLines, parseRule, ruleCoversTool, staysWithin, type PermissionRule } from './permission-rules'
import { projectPaths, type ProjectPaths } from './project-paths'
import { splitShellCommand, type ShellSegment } from './shell-split'
import { FILE_TOOLS, isShellTool, readOnlyTools, TRANSFER_TOOLS, WITHIN_PROJECT_TOOLS, type ReadOnlyTools } from './tool-classes'
import { commandWriteTargets, toolWriteTargets, writesWithin, type WritableArea } from './write-targets'

export type PermissionRules = {
  allow: string[]
  deny: string[]
  /** Blocks every git command that is not read-only, whatever the allow rules say. */
  denyGitWrites?: boolean
}

/** What the policy has to ask the session about, beyond the rules themselves. */
export type PolicyContext = {
  /** Which tools only look. Without it only the engine's built-ins are known, so everything else is asked about. */
  readOnly?: ReadOnlyTools
  /** The commands the project defines for itself; they run without a prompt. */
  project?: () => ProjectCommands
  /** Is the session's "Allow writes" switch on? */
  writesAllowed?: () => boolean
  /** The session's scratch folder, project-relative: written without a prompt whatever the switch says. */
  scratch?: string
}

/**
 * Decides tool calls before any permission prompt, on every engine: a deny
 * rule blocks, a read-only call, a write the session's switch or its scratch
 * folder covers, a command the project defines for itself or one covered by the project's allow
 * rules goes through, everything else is asked. Everything it consults is read
 * on each call, so a rule allowed for the session or the project, a script just
 * added, or the switch just turned on, applies to the next call.
 */
export class PermissionPolicy implements SessionHooks {
  private readonly paths: ProjectPaths
  private readonly readOnly: ReadOnlyTools
  private readonly project: () => ProjectCommands
  private readonly writesAllowed: () => boolean
  private readonly projectArea: WritableArea
  private readonly scratchArea: WritableArea | undefined

  constructor(
    cwd: string,
    private readonly rules: () => PermissionRules,
    context: PolicyContext = {},
  ) {
    this.paths = projectPaths(cwd)
    this.readOnly = context.readOnly ?? readOnlyTools(() => [])
    this.project = context.project ?? (() => NO_PROJECT_COMMANDS)
    this.writesAllowed = context.writesAllowed ?? (() => false)
    // Strictly below the root: the root itself is not something a write may take.
    this.projectArea = { passes: 'the Allow writes switch', canEnter: this.paths.inside, canWrite: this.paths.below }
    const scratch = context.scratch
    if (scratch !== undefined) {
      const inScratch = (path: string) => this.paths.under(scratch, path)
      this.scratchArea = { passes: 'the scratch folder', canEnter: inScratch, canWrite: inScratch }
    }
  }

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    const { allow, deny, denyGitWrites } = this.rules()
    const denied = deny.find((rule) => this.denies(parseRule(rule), tool))
    if (denied) return { deny: `Blocked by the project's permission rule ${denied} (kiwiAgent.permissions.deny).` }
    if (denyGitWrites && isShellTool(tool.toolName) && splitShellCommand(this.command(tool)).segments.some(isGitWrite))
      return { deny: 'Git commands that change the repository are turned off for this project (kiwiAgent.permissions.denyGitWrites). Read-only git (status, log, diff, show) still runs.' }
    const context = this.enterContext(tool.toolName, allow)
    if (this.isReadOnly(tool, context)) return { allow: true }
    if (this.writableCovers(tool)) return { allow: true }
    if (this.allows(allow, tool, context)) return { allow: true }
    return undefined
  }

  /** A prompt for a shell call is asked line by line: each command with what the rules in force make of it. */
  decorate(event: SessionEvent): SessionEvent {
    if (event.type !== 'permission_request' || !isShellTool(event.toolName)) return event
    const { allow } = this.rules()
    return { ...event, commands: commandLines(event.toolName, this.command(event), allow, this.enterContext(event.toolName, allow), this.project(), this.writable()) }
  }

  /** Where a write needs no prompt: the whole project while the switch is on, else the scratch folder. The folder lies in the project, so the switch covers it too. */
  private writable(): WritableArea | undefined {
    return this.writesAllowed() ? this.projectArea : this.scratchArea
  }

  /**
   * Where this shell may stand: in the project, or in a directory a `cd` rule
   * in force names. The rule carries the directory rather than `cd` itself, so
   * allowing one place to work from does not allow every other.
   */
  private enterContext(toolName: string, allow: string[]): ReadOnlyContext {
    const directories = allow
      .map(parseRule)
      .filter((rule) => rule.pattern !== undefined && ruleCoversTool(rule.tool, toolName))
      .map((rule) => cdRuleDirectory(rule.pattern!))
      .filter((directory): directory is string => directory !== undefined)
    return { canEnter: (path) => this.paths.inside(path) || directories.some((directory) => this.paths.under(directory, path)) }
  }

  private isReadOnly(tool: ToolUse, context: ReadOnlyContext): boolean {
    if (isShellTool(tool.toolName)) return isReadOnlyCommand(this.command(tool), context)
    if (WITHIN_PROJECT_TOOLS.has(tool.toolName)) {
      const paths = this.relativePaths(tool)
      return paths.length > 0 && paths.every((path) => this.paths.inside(path))
    }
    return this.readOnly(tool.toolName)
  }

  /**
   * The writable area, for a call that names its paths. A shell call is
   * covered command by command instead, in `allows` below, since one line may
   * mix a write with anything else.
   */
  private writableCovers(tool: ToolUse): boolean {
    const area = this.writable()
    return area !== undefined && writesWithin(toolWriteTargets(tool.toolName, tool.input), area)
  }

  /** One part is enough: a segment of a shell call, or either end of a move. */
  private denies(rule: PermissionRule, tool: ToolUse): boolean {
    if (!ruleCoversTool(rule.tool, tool.toolName)) return false
    if (rule.pattern === undefined) return true
    if (isShellTool(tool.toolName)) return splitShellCommand(this.command(tool)).segments.some((s) => bashPatternMatches(rule.pattern!, s.tokens, 'deny'))
    if (FILE_TOOLS.has(tool.toolName)) return this.relativePaths(tool).some((path) => matchesGlob(path, rule.pattern!))
    return false
  }

  /**
   * Every segment of a shell call has to be let through, the ones a
   * substitution holds among them, but not by the same rule: rules allowed one
   * at a time add up, which is what the prompt shows line by line. A command
   * word that is itself a substitution is named by no rule, so it is asked
   * about. A move touches both its ends, so one rule must cover both.
   */
  private allows(allow: string[], tool: ToolUse, context: ReadOnlyContext): boolean {
    const rules = allow.map(parseRule).filter((rule) => ruleCoversTool(rule.tool, tool.toolName))
    if (isShellTool(tool.toolName)) {
      const parsed = splitShellCommand(this.command(tool))
      const project = this.project()
      const area = this.writable()
      const writes = area !== undefined && staysWithin(parsed.segments, area) ? area : undefined
      const covered = (s: ShellSegment) =>
        !hidesCommandWord(s) &&
        (isReadOnlySegment(s, context) ||
          (writes !== undefined && writesWithin(commandWriteTargets(s), writes)) ||
          projectCommandOf(s, project) !== undefined ||
          rules.some((r) => r.pattern === undefined || bashPatternMatches(r.pattern, s.tokens, 'allow')))
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
    const raw = TRANSFER_TOOLS.has(tool.toolName)
      ? [input['source'], input['destination']]
      : Array.isArray(input['files'])
        ? input['files']
        : [input['file_path'] ?? input['notebook_path'] ?? input['path']]
    return raw.filter((p): p is string => typeof p === 'string').map((p) => this.paths.relative(p))
  }
}
