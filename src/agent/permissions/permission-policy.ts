import { homedir } from 'node:os'
import { matchesGlob, resolve } from 'node:path'
import { directoryAsked, placesToKeep, wildcardFree } from './directory-places'
import { withHome } from './asked-places'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import type { SessionEvent } from '../session/code-session'
import { NO_PROJECT_COMMANDS, projectCommandOf, type ProjectCommands } from './project-commands'
import { commandName, unwrapCommand } from './command-wrappers'
import { cdRuleDirectory, cdTarget, fileOperands, readRuleDirectory, isGitWrite, isReadOnlyCommand, isReadOnlySegment, runsProgramOfItsOwn, segmentContexts, writeRuleTarget, type ReadOnlyContext } from './read-only-commands'
import { bashPatternMatches, commandLines, staysWithin, type CommandLine } from './permission-rules'
import { formatRule, parseRule, ruleCoversTool, WRITES_RULE, type PermissionRule } from './rule-text'
import { projectPaths, type ProjectPaths } from './project-paths'
import { splitShellCommand, type ShellSegment } from './shell-split'
import { FILE_TOOLS, isShellTool, readOnlyTools, TRANSFER_TOOLS, WITHIN_PROJECT_TOOLS, WRITE_TOOLS, type ReadOnlyTools } from './tool-classes'
import { commandReadTargets, commandWriteTargets, toolWriteTargets, writesWithin, type WritableArea } from './write-targets'
import { isPersonRulesFile, isTrustFile } from './trust-files'
import { DELEGATE_TOOL } from '../openai-session/tools/delegate'
import { isResearchDelegation } from '../sub-agents/sub-agent-index'

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
  /** Files and folders outside the project the session may read unasked: where its own instructions live (`instruction-places`). */
  readable?: readonly string[]
  /** Where the person's own permission rules are kept: a write there is always asked, like a write to the workspace's own settings. */
  personRulesFile?: string
  /** The person's home folder: what `~` stands for, and the ground no directory grant may reach. The user profile by default. */
  home?: string
}

/**
 * Decides tool calls before any permission prompt, on every engine: a deny
 * rule blocks, a write to a file that decides what runs unasked (`trust-files`)
 * is always asked, a read-only call, a write the session's switch or its scratch
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
  private readonly readable: readonly string[]
  private readonly personRulesFile: string | undefined
  private readonly home: string

  constructor(
    cwd: string,
    private readonly rules: () => PermissionRules,
    context: PolicyContext = {},
  ) {
    this.paths = projectPaths(cwd)
    this.readOnly = context.readOnly ?? readOnlyTools(() => [])
    this.project = context.project ?? (() => NO_PROJECT_COMMANDS)
    this.writesAllowed = context.writesAllowed ?? (() => false)
    this.readable = context.readable ?? []
    this.personRulesFile = context.personRulesFile
    this.home = context.home ?? homedir()
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
    // Asked whatever the switch or an allow rule says: what lands in one of these runs unasked later.
    if (this.writesTrustFile(tool)) return undefined
    const context = this.enterContext(tool.toolName, allow)
    if (this.isReadOnly(tool, context)) return { allow: true }
    if (this.writableCovers(tool)) return { allow: true }
    if (this.allows(allow, tool, context)) return { allow: true }
    return undefined
  }

  /**
   * A prompt for a shell call is asked line by line: each command with what the
   * rules in force make of it.
   */
  decorate(event: SessionEvent): SessionEvent {
    if (event.type !== 'permission_request') return event
    if (!isShellTool(event.toolName)) return this.decorateFileCall(event)
    const { allow } = this.rules()
    return { ...event, commands: commandLines(event.toolName, this.command(event), allow, this.enterContext(event.toolName, allow), this.project(), this.writable()) }
  }

  /**
   * A file tool that reads or writes outside the project is asked about as the
   * directory holding what it reaches, one line for each directory and kind it
   * is missing a grant for. A call that stays in the project is left as it came.
   */
  private decorateFileCall(event: Extract<SessionEvent, { type: 'permission_request' }>): SessionEvent {
    const { allow } = this.rules()
    const context = this.enterContext(event.toolName, allow)
    const tool = { toolName: event.toolName, input: event.input, toolUseId: event.toolUseId ?? '' }
    const input = (event.input ?? {}) as Record<string, unknown>
    const written = toolWriteTargets(tool.toolName, tool.input)
    const reads = !written && (this.readOnly(tool.toolName) || WITHIN_PROJECT_TOOLS.has(tool.toolName))
    if (!reads && (!written || written.length === 0)) return event
    const kind = reads ? ('reads' as const) : ('writes' as const)
    const named = reads ? this.readPaths(tool) : written!
    const isDirectory = DIRECTORY_TOOLS.has(tool.toolName) && typeof input['pattern'] !== 'string'
    const covered = (path: string, abs: string): boolean => (reads ? (context.canRead?.(path) ?? true) : this.paths.inside(abs))
    const directories = this.directoriesMissingGrant(named, reads, isDirectory, covered)
    if (directories.size === 0) return event
    const verb = kind === 'reads' ? 'read' : 'write'
    const commands: CommandLine[] = [...directories].map(([directory, file]) => {
      const keep = file === undefined ? placesToKeep(directory, this.home) : [file, ...placesToKeep(directory, this.home)]
      const places = keep.map((place) => ({ directory: place, rule: formatRule({ tool: tool.toolName, pattern: `${verb} ${place}` }) }))
      const text = `${tool.toolName} ${directory}`
      const access = { kind, directory }
      return places.length === 0 ? { text, access } : { text, access, rule: places[0]!.rule, places, scope: 'person' as const }
    })
    return { ...event, commands }
  }

  /** Each directory, with the one file written in it when that is all the call writes there. */
  private directoriesMissingGrant(named: readonly string[], reads: boolean, isDirectory: boolean, covered: (path: string, abs: string) => boolean): Map<string, string | undefined> {
    const directories = new Map<string, string | undefined>()
    for (const path of named) {
      const abs = this.paths.absolute(path)
      if (covered(path, abs)) continue
      const directory = directoryAsked(abs, isDirectory)
      if (directory === undefined) continue
      const key = resolve(directory).split('\\').join('/')
      const file = !reads && !isDirectory && wildcardFree(abs) === abs ? resolve(abs).split('\\').join('/') : undefined
      directories.set(key, directories.has(key) && directories.get(key) !== file ? undefined : file)
    }
    return directories
  }

  /** Where a write needs no prompt: the whole project while the switch is on, else the scratch folder. The folder lies in the project, so the switch covers it too. */
  private writable(): WritableArea | undefined {
    return this.writesAllowed() ? this.projectArea : this.scratchArea
  }

  /**
   * Where this shell may stand and what it may read: where the session may
   * look, or in a directory a `cd` rule in force names. The rule carries the
   * directory rather than `cd` itself, so allowing one place to work from does
   * not allow every other, and a place the session may work in is one it may
   * read.
   */
  private enterContext(toolName: string, allow: string[]): ReadOnlyContext {
    // A place kept for writing may be read too, whichever write tool it was kept for.
    const keptForWriting = (tool: string) => !isShellTool(toolName) && (tool === WRITES_RULE || WRITE_TOOLS.has(tool))
    const directories = allow
      .map(parseRule)
      .filter((rule) => rule.pattern !== undefined && (ruleCoversTool(rule.tool, toolName) || (keptForWriting(rule.tool) && writeRuleTarget(rule.pattern) !== undefined)))
      .map((rule) => cdRuleDirectory(rule.pattern!) ?? readRuleDirectory(rule.pattern!) ?? writeRuleTarget(rule.pattern!))
      .filter((directory): directory is string => directory !== undefined)
      .map((directory) => shellPath(toolName, directory))
    // A path that depends on a variable or a command's output names no place, so nothing grants it.
    const names = (target: string) => {
      const expanded = isShellTool(toolName) ? withHome(target, this.home) : target
      return isShellTool(toolName) && /[$`~]/.test(expanded) ? undefined : shellPath(toolName, expanded)
    }
    const where = (target: string) => {
      const path = names(target)
      return path === undefined ? undefined : this.paths.absolute(path)
    }
    const reaches = (target: string) => {
      const path = names(target)
      if (path === undefined) return false
      return this.canRead(path) || directories.some((directory) => this.paths.under(directory, path))
    }
    const keepable = (target: string) => {
      const named = wildcardFree(shellPath(toolName, target))
      return named === undefined ? [] : placesToKeep(this.paths.absolute(named), this.home)
    }
    return { canEnter: reaches, canRead: reaches, insideProject: this.paths.inside, home: this.home, placesToKeep: keepable, where }
  }

  /**
   * A call that only looks, and only where the session may look. Reading
   * anywhere else is left to the rules, so the person grants another workspace
   * or a folder of their own once rather than the agent reaching anywhere on
   * the machine unasked. A call naming no path is working in the project.
   */
  private isReadOnly(tool: ToolUse, context: ReadOnlyContext): boolean {
    if (isShellTool(tool.toolName)) return isReadOnlyCommand(this.command(tool), context)
    // A delegation only ever reads; the one exception is the research sub agent, which reaches the open
    // internet, so approving it is its own decision rather than one every other delegation is held to.
    if (tool.toolName === DELEGATE_TOOL) return !isResearchDelegation(tool.input)
    if (!this.readOnly(tool.toolName) && !WITHIN_PROJECT_TOOLS.has(tool.toolName)) return false
    return this.readPaths(tool).every((path) => (context.canRead ?? ((p: string) => this.canRead(p)))(path))
  }

  /** Where the session may look unasked: the project, and the places its own instructions are kept. */
  private canRead(path: string): boolean {
    return this.paths.inside(path) || this.readable.some((place) => this.paths.under(place, path))
  }

  /** The paths a looking call reaches: those it names, and the pattern a search walks, which is a path of its own. */
  private readPaths(tool: ToolUse): string[] {
    const pattern = (tool.input as { pattern?: unknown } | undefined)?.pattern
    const walked = tool.toolName === 'Glob' && typeof pattern === 'string' ? [this.paths.relative(pattern)] : []
    return [...this.relativePaths(tool), ...walked]
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

  /** Does the call write a file that decides what runs without a prompt? A move or copy counts at either end. */
  private writesTrustFile(tool: ToolUse): boolean {
    const targets = isShellTool(tool.toolName)
      ? splitShellCommand(this.command(tool)).segments.flatMap((s) => commandWriteTargets(s) ?? [])
      : (toolWriteTargets(tool.toolName, tool.input) ?? [])
    return targets.some((path) => isTrustFile(this.paths.relative(path)) || isPersonRulesFile(this.paths.absolute(path), this.personRulesFile))
  }

  /** One part is enough: a segment of a shell call, or either end of a move. */
  private denies(rule: PermissionRule, tool: ToolUse): boolean {
    if (!ruleCoversTool(rule.tool, tool.toolName)) return false
    if (rule.pattern === undefined) return true
    if (isShellTool(tool.toolName)) {
      const segments = splitShellCommand(this.command(tool)).segments
      const deniedTarget = writeRuleTarget(rule.pattern)
      if (deniedTarget !== undefined) {
        const directory = shellPath(tool.toolName, deniedTarget)
        return segments.some((s) => (commandWriteTargets(s) ?? []).some((path) => this.paths.under(directory, shellPath(tool.toolName, path))))
      }
      const deniedDirectory = cdRuleDirectory(rule.pattern) ?? readRuleDirectory(rule.pattern)
      if (deniedDirectory !== undefined) {
        // A directory denied for changing into or reading refuses the tree beneath it for both, and for writes: read from wherever the line stands at each `cd`.
        const directory = shellPath(tool.toolName, deniedDirectory)
        const lands = (target: string) => this.paths.under(directory, shellPath(tool.toolName, withHome(target, this.home)))
        const contexts = segmentContexts(segments, { canEnter: lands, canRead: lands, home: this.home })
        return segments.some((s, i) => {
          const target = cdTarget(s.tokens, this.home)
          if (target !== undefined && contexts[i]!.canEnter!(target)) return true
          return namedPaths(s).some((path) => contexts[i]!.canRead!(path))
        })
      }
      return segments.some((s) => bashPatternMatches(rule.pattern!, s.tokens, 'deny'))
    }
    const readDenied = cdRuleDirectory(rule.pattern) ?? readRuleDirectory(rule.pattern)
    if (readDenied !== undefined) return [...this.readPaths(tool), ...(toolWriteTargets(tool.toolName, tool.input) ?? [])].some((path) => this.paths.under(readDenied, path))
    const writeDenied = writeRuleTarget(rule.pattern)
    if (writeDenied !== undefined) return (toolWriteTargets(tool.toolName, tool.input) ?? []).some((path) => this.paths.under(writeDenied, path))
    if (FILE_TOOLS.has(tool.toolName)) return this.relativePaths(tool).some((path) => matchesGlob(path, rule.pattern!))
    return false
  }

  /**
   * Every segment of a shell call has to be let through, the ones a
   * substitution holds among them, but not by the same rule: rules allowed one
   * at a time add up, which is what the prompt shows line by line. A command
   * that runs a program of its own is named by no rule, so it is asked about
   * every time. A move or a copy touches both ends: the destination by the
   * write rules, the source by the read rules, both of which must hold.
   */
  private allows(allow: string[], tool: ToolUse, context: ReadOnlyContext): boolean {
    const rules = allow.map(parseRule).filter((rule) => ruleCoversTool(rule.tool, tool.toolName))
    if (isShellTool(tool.toolName)) {
      const parsed = splitShellCommand(this.command(tool))
      const project = this.project()
      const area = this.writable()
      const writes = area !== undefined && staysWithin(parsed.segments, area) ? area : undefined
      const contexts = segmentContexts(parsed.segments, context)
      const writable = (s: ShellSegment, context: ReadOnlyContext) =>
        writes !== undefined &&
        writesWithin(commandWriteTargets(s), writes) &&
        commandReadTargets(s).every((path) => context.canRead?.(path) ?? true)
      // A "write" rule names one folder or file, kept for the person as often as not, rather than a command of its own.
      const writeDirs = rules
        .map((r) => (r.pattern !== undefined ? writeRuleTarget(r.pattern) : undefined))
        .filter((directory): directory is string => directory !== undefined)
        .map((directory) => shellPath(tool.toolName, directory))
      const writeGranted = (s: ShellSegment, context: ReadOnlyContext) => {
        const targets = commandWriteTargets(s)
        return (
          targets !== undefined &&
          targets.length > 0 &&
          targets.every((target) => writeDirs.some((directory) => this.paths.under(directory, shellPath(tool.toolName, target)))) &&
          commandReadTargets(s).every((path) => context.canRead?.(path) ?? true)
        )
      }
      const covered = (s: ShellSegment, i: number) =>
        !runsProgramOfItsOwn(s) &&
        (isReadOnlySegment(s, contexts[i]) ||
          writable(s, contexts[i]!) ||
          writeGranted(s, contexts[i]!) ||
          projectCommandOf(s, project) !== undefined ||
          rules.some((r) => r.pattern === undefined || bashPatternMatches(r.pattern, s.tokens, 'allow')))
      return parsed.segments.every(covered)
    }
    // A directory kept for writing covers the files a file tool writes beneath it.
    const written = toolWriteTargets(tool.toolName, tool.input)
    const writeDirectories = rules.map((r) => (r.pattern !== undefined ? writeRuleTarget(r.pattern) : undefined)).filter((d): d is string => d !== undefined)
    if (written && written.length > 0 && written.every((target) => writeDirectories.some((directory) => this.paths.under(directory, target)))) return true
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

  private relativePaths(tool: Pick<ToolUse, 'toolName' | 'input'>): string[] {
    const input = (tool.input ?? {}) as Record<string, unknown>
    const raw = TRANSFER_TOOLS.has(tool.toolName)
      ? [input['source'], input['destination']]
      : Array.isArray(input['files'])
        ? input['files']
        : [input['file_path'] ?? input['notebook_path'] ?? input['path']]
    return raw.filter((p): p is string => typeof p === 'string').map((p) => this.paths.relative(p))
  }
}

/** Every path a command reads or writes by its own words, redirects and copies included. */
function namedPaths(segment: ShellSegment): string[] {
  const [command, ...args] = unwrapCommand(segment.tokens)
  return [...segment.reads, ...(commandWriteTargets(segment) ?? []), ...commandReadTargets(segment), ...(command ? fileOperands(commandName(command), args) : [])]
}

/** Tools whose path is the directory they look in, not a file. */
const DIRECTORY_TOOLS: ReadonlySet<string> = new Set(['ReadDir', 'LS', 'Grep', 'CodeSearch', 'MarkdownSearch', 'CodeOutline', 'Exists'])

/** Bash on Windows is Git Bash, which writes `D:\src` as `/d/src`. PowerShell reads that as a folder on the current drive. */
function shellPath(toolName: string, path: string): string {
  if (process.platform !== 'win32' || toolName !== 'Bash') return path
  const drive = /^\/([a-zA-Z])(?:\/|$)/.exec(path)
  return drive ? `${drive[1]}:/${path.slice(3)}` : path
}
