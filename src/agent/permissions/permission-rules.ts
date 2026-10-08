import { commandName, runCommand, unwrapCommand } from './command-wrappers'
import { NO_PROJECT_COMMANDS, projectCommandOf, type ProjectCommands } from './project-commands'
import { askedPlaces, type AskedPlace } from './asked-places'
import { cdTarget, isCdCommand, isReadOnlySegment, runsProgramOfItsOwn, segmentContexts, type ReadOnlyContext } from './read-only-commands'
import { splitShellCommand, type ShellSegment } from './shell-split'
import { subcommandAt } from './subcommand-tools'
import { commandReadTargets, commandWriteTargets, writesWithin, type WritableArea } from './write-targets'
import { formatRule, parseRule, type PermissionRule } from './rule-text'

/**
 * The words of a segment that "Allow for project" remembers: the command, plus
 * its subcommand for tools that have one, and the tool's own options where they
 * stand in between. The options stay in the rule because they are part of what
 * was allowed: `npm --prefix ../other run` is another package's scripts.
 */
export function commandPrefix(tokens: string[]): string[] {
  // A rule remembered for `timeout` would cover everything it ever wraps, so the wrapper is taken off first.
  const [command, ...args] = unwrapCommand(tokens)
  if (!command) return []
  // A command is named without its path, so `./build.cmd` and `build.cmd` are the same command.
  const name = commandName(command)
  const at = subcommandAt(name, args)
  const sub = at === undefined ? undefined : args[at]
  if (sub === undefined || sub.startsWith('-')) return [name]
  return [name, ...args.slice(0, at), sub]
}

/** One simple command of a shell call, as the permission prompt lists it. */
export type CommandLine = {
  /** The command as written. */
  text: string
  /** What already lets it through: `read-only`, a command the project defines, or the rule that covers it. Absent when this line is part of why the call is asked about. */
  passes?: string
  /** The rule that would cover it, for "Allow for session" and, by `scope`, for the workspace or the person. Absent when it passes, or when no rule can stand for it. */
  rule?: string
  /**
   * Where `rule` may be kept beside the session: `workspace`, the default,
   * for ground the project already stands on; `person` where `rule` names a
   * folder or a file outside the project, since a rule about ground inside
   * one workspace says nothing in any other.
   */
  scope?: 'workspace' | 'person'
  /**
   * For a change of directory: the directories its answer may be kept for,
   * the one it lands in first and each above it after, so the person picks
   * how far a grant reaches. `rule` is the first one's.
   */
  places?: KeptPlace[]
  /**
   * For a read or a write outside the project: whether it reads in a directory
   * or writes to it, and the whole path of that directory. A line needing more
   * than one grant is listed once for each. The directory is absent when the
   * path cannot be named, which leaves the line with no rule to keep.
   */
  access?: { kind: 'reads' | 'writes'; directory?: string }
  /**
   * What a copy or move does as more than one thing: a read at every path it
   * takes from and a write at the one it writes to. Set only while the line
   * still needs an answer, so the prompt can name each place and mark which
   * of them is why it is asking.
   */
  effects?: CommandEffect[]
}

/** A directory an answer may be kept for, and the rule that keeps it. */
export type KeptPlace = { directory: string; rule: string }

/** One thing a line with more than one effect does: reads or writes, and where. */
export type CommandEffect = { kind: 'reads' | 'writes'; path: string; asked: boolean }

/**
 * A shell call line by line, against the allow rules in force. A command a
 * substitution holds gets a line of its own and is judged like any other; only
 * a line that runs a program of its own passes nothing and is offered no
 * rule, since no rule can name what it will run. `writes` is where the session
 * may write unasked, and decides which file-changing lines are already covered.
 */
export function commandLines(
  toolName: string,
  command: string,
  allow: string[],
  context: ReadOnlyContext = {},
  project: ProjectCommands = NO_PROJECT_COMMANDS,
  writes?: WritableArea,
): CommandLine[] {
  const parsed = splitShellCommand(command)
  const judge: LineJudge = {
    toolName,
    context,
    project,
    patterns: allow.map(parseRule).filter((r) => r.tool === toolName && r.pattern !== undefined),
    covers: writes && staysWithin(parsed.segments, writes) ? writes : undefined,
  }
  const contexts = segmentContexts(parsed.segments, context)
  return parsed.segments.flatMap((segment, i) => commandLine(segment, { ...judge, context: contexts[i]! }))
}

/** What every line of one shell call is judged against. */
type LineJudge = {
  toolName: string
  context: ReadOnlyContext
  project: ProjectCommands
  /** The allow rules for this tool that name a command. */
  patterns: PermissionRule[]
  /** Where the session may write unasked, when every write of the call stays there. */
  covers: WritableArea | undefined
}

function commandLine(segment: ShellSegment, judge: LineJudge): CommandLine[] {
  const { text } = segment
  if (runsProgramOfItsOwn(segment)) return [{ text }]
  const passes = passingGround(segment, judge)
  if (passes) return [{ text, passes }]
  if (!isCdCommand(segment.tokens)) {
    const asked = askedPlaces(segment, judge.context, judge.covers)
    // One line for each grant the command is missing, so each is answered in turn.
    if (asked) return asked.map((place) => ({ text, ...placeOffer(place, judge.toolName) }))
  }
  const effects = transferEffects(segment, judge.context, judge.covers)
  return [{ text, ...ruleOffer(segment, judge), ...(effects ? { effects } : {}) }]
}

/** A read or a write outside the project, kept for the person by the directory chosen rather than by the command. */
function placeOffer(place: AskedPlace, toolName: string): Partial<CommandLine> {
  const access = { kind: place.kind, ...(place.directory !== undefined ? { directory: place.directory } : {}) }
  if (place.keep.length === 0) return { access }
  const verb = place.kind === 'reads' ? 'read' : 'write'
  const places = place.keep.map((directory) => ({ directory, rule: formatRule({ tool: toolName, pattern: `${verb} ${directory}` }) }))
  return { access, rule: places[0]!.rule, places, scope: 'person' }
}

/** What already lets this line through, or undefined when it needs an answer. */
function passingGround(segment: ShellSegment, { context, project, patterns, covers }: LineJudge): string | undefined {
  if (isReadOnlySegment(segment, context)) return 'read-only'
  if (covers && writesWithin(commandWriteTargets(segment), covers) && commandReadTargets(segment).every((path) => context.canRead?.(path) ?? true))
    return covers.passes
  const defined = projectCommandOf(segment, project)
  if (defined) return defined
  const covering = patterns.find((r) => bashPatternMatches(r.pattern!, segment.tokens, 'allow'))
  return covering ? formatRule(covering) : undefined
}

/** The rule a line that needs an answer may be remembered by, and where it may be kept. */
function ruleOffer(segment: ShellSegment, { toolName, context }: LineJudge): Partial<CommandLine> {
  // Reaching here means the directory is not already ground the session may stand on, which a `cd` inside
  // the project always is: it lies outside, so it is kept for the person rather than the workspace.
  // A directory no rule can name is answered per call: `cd:*` would allow every place at once.
  if (isCdCommand(segment.tokens)) {
    const target = cdTarget(segment.tokens, context.home)
    const places = target === undefined ? [] : (context.placesToKeep?.(target) ?? [])
    if (places.length === 0) return {}
    const kept = places.map((directory) => ({ directory, rule: formatRule({ tool: toolName, pattern: `cd ${directory}` }) }))
    return { rule: kept[0]!.rule, places: kept, scope: 'person' }
  }
  const prefix = commandPrefix(segment.tokens)
  return prefix.length ? { rule: formatRule({ tool: toolName, pattern: `${prefix.join(' ')}:*` }) } : {}
}

/**
 * What a copy or move does as two things rather than one: a read at every
 * path it takes from and a write at the one it writes to, each already judged
 * by the rules for that kind. Undefined for a command with only one kind of
 * target, which keeps the plain line it already had.
 */
function transferEffects(segment: ShellSegment, context: ReadOnlyContext, covers: WritableArea | undefined): CommandEffect[] | undefined {
  const reads = commandReadTargets(segment)
  const writes = commandWriteTargets(segment) ?? []
  if (reads.length === 0 || writes.length === 0) return undefined
  return [
    ...reads.map((path) => ({ kind: 'reads' as const, path, asked: !(context.canRead?.(path) ?? true) })),
    ...writes.map((path) => ({ kind: 'writes' as const, path, asked: !(covers?.canWrite(path) ?? false) })),
  ]
}

/**
 * Does the whole call stay where it may write? Every path a command names is
 * read from the project root, but a `cd` moves the directory the shell reads
 * them from, so `cd /elsewhere && rm -rf data` would otherwise be judged on
 * `<project>/data` while it removes `/elsewhere/data`. A `cd` that stays in the
 * area is harmless here: it can only push the root deeper, and a relative path
 * that lands in the area from the root lands in it from deeper still.
 */
export function staysWithin(segments: ShellSegment[], area: WritableArea): boolean {
  return segments.every((segment) => {
    if (!isCdCommand(segment.tokens)) return true
    const target = cdTarget(segment.tokens)
    return target !== undefined && area.canEnter(target)
  })
}

/**
 * Does a Bash rule pattern cover this segment? Both sides are judged on the
 * command that runs, so a rule for `npm test` covers `timeout 300 npm test`
 * and a deny rule for `rm` is not walked past by wrapping it. A command that
 * takes arguments from its input may run with more words than the line shows,
 * so an exact rule still denies it but no longer allows it.
 */
export function bashPatternMatches(pattern: string, tokens: string[], use: 'allow' | 'deny'): boolean {
  const prefix = pattern.endsWith(':*')
  const words = unwrapCommand(splitShellCommand(prefix ? pattern.slice(0, -2) : pattern).segments[0]?.tokens ?? [])
  const { tokens: run, argumentsFromInput } = runCommand(tokens)
  if (words.length === 0) return false
  if (!prefix && (run.length !== words.length || (argumentsFromInput && use === 'allow'))) return false
  if (run.length < words.length) return false
  return words.every((w, i) => (i === 0 ? commandName(w) === commandName(run[i]!) : w === run[i]))
}
