import { classifyCommand } from './classifiers'
import type { CommandSite } from './classifiers/classifier'
import { writeOrDestroy } from './classifiers/classifier'
import { commandName, runCommand } from './command-wrappers'
import { effects, isKnown, known, refused, unknownPlace, USE_FILE_TOOLS, type Effect, type Invocation, type Place, type Ruling } from './effects'
import { isUnsettled, resolvePlace } from './places'
import { NO_PROJECT_COMMANDS, projectCommandOf, type ProjectCommands } from './project-commands'
import { splitShellCommand, type ShellSegment } from './shell-split'

/** What the line is judged against besides its own words: facts, never rules. */
export type ShellFacts = {
  /** The person's home folder, what a leading `~` stands for. */
  home?: string | undefined
  /** What is at a path now. */
  exists(path: string): 'file' | 'directory' | undefined
  /** The commands the project defines for itself. */
  project?: ProjectCommands | undefined
}

/** One simple command of a line, with what it would do. */
export type CommandEffects = {
  /** The command as written. */
  text: string
  /** Absent when the command word comes from another command's output. */
  invocation?: Invocation
  ruling: Ruling
  /** Where the shell stands when it runs. */
  cwd: Place
  /** What the project defines it as, when it is one of the project's own commands. */
  projectCommand?: string
}

/** Commands that print text the line gives them: sent to a file, that text is the model's own. */
const AUTHORS = new Set(['echo', 'printf', 'write-output', 'write-host'])
const CHANGES_DIRECTORY = new Set(['cd', 'chdir', 'pushd', 'popd', 'set-location', 'sl'])

/** Past this many places a line may stand in, where it stands is unknown. */
const MAX_PLACES = 8

/**
 * A shell line as its simple commands, each judged from where the shell
 * stands when it runs. Along a plain `&&` chain from the start that place is
 * known; past anything else (`;`, `||`, a loop, a subshell) a command may
 * stand in any place the line has reached, and is judged from each.
 */
export function shellEffects(line: string, start: Place, facts: ShellFacts): CommandEffects[] {
  const segments = splitShellCommand(line).segments
  let here: Place = start
  let previous: Place | undefined
  const stack: Place[] = []
  let followed = true
  let reached: Place[] = [start]
  const judged: CommandEffects[] = []
  segments.forEach((segment, i) => {
    followed &&= segment.joined !== undefined
    const standing = followed ? [here] : reached
    const inPipe = segment.joined === '|' || segments[i + 1]?.joined === '|'
    const move = directoryChange(segment, here, previous, stack, facts.home)
    if (move) {
      judged.push({ text: segment.text, invocation: move.invocation, ruling: effects({ action: 'enters', place: move.to }), cwd: here })
      if (inPipe) return
      if (followed) {
        previous = here
        here = move.to
      } else here = unknownPlace('a change of directory that may not have run')
      reached = reached.length >= MAX_PLACES ? [unknownPlace('one of many directories')] : [...reached, move.to]
      return
    }
    const each = standing.map((cwd) => judgeSegment(segment, cwd, facts))
    judged.push(...merge(each.map((e) => e.command)), ...merge(each.flatMap((e) => (e.redirect ? [e.redirect] : []))))
  })
  return judged
}

/** The same command judged from several places is one command with the effects of all of them. */
function merge(each: CommandEffects[]): CommandEffects[] {
  if (each.length <= 1) return each
  const refusal = each.find((c) => c.ruling.kind === 'refused')
  if (refusal) return [refusal]
  const all = each.flatMap((c) => (c.ruling.kind === 'effects' ? c.ruling.effects : []))
  return [{ ...each[0]!, ruling: effects(...all) }]
}

/**
 * One simple command, and what its redirects do apart from it. A redirect is
 * the shell's doing rather than the command's, so no answer kept for the
 * command covers where its output lands, and a git that only reads stays one
 * however its output is saved.
 */
function judgeSegment(segment: ShellSegment, cwd: Place, facts: ShellFacts): { command: CommandEffects; redirect?: CommandEffects } {
  const site = siteAt(cwd, facts)
  const text = segment.text
  const { tokens, argumentsFromInput } = runCommand(segment.tokens)
  const [raw, ...args] = tokens
  const redirected = redirectEffects(segment, site, raw)
  if (redirected.kind === 'refused') return { command: { text, ruling: redirected, cwd } }
  const redirect = redirected.effects.length ? { text, ruling: redirected, cwd } : undefined
  const alongside = redirect ? { redirect } : {}
  if (hidesCommandWord(segment)) return { command: { text, ruling: effects({ action: 'runs', reason: "its command word comes from another command's output" }), cwd }, ...alongside }
  if (raw === undefined) return { command: { text, ruling: effects(), cwd }, ...alongside }
  const name = commandName(raw)
  const own = classifyCommand(name, args, site)
  // Arguments fed in from input may name any file at all.
  const fed = argumentsFromInput ? classifyCommand(name, [...args, '$(input)'], site).ruling : effects()
  const project = projectCommandOf({ ...segment, writesFile: false }, facts.project ?? NO_PROJECT_COMMANDS)
  const command = { text, invocation: own.invocation, ruling: combine(own.ruling, fed), cwd, ...(project !== undefined && !argumentsFromInput ? { projectCommand: project } : {}) }
  return { command, ...alongside }
}

function combine(...rulings: Ruling[]): Ruling {
  const refusal = rulings.find((r) => r.kind === 'refused')
  if (refusal) return refusal
  return effects(...rulings.flatMap((r) => (r.kind === 'effects' ? r.effects : [])))
}

/** `< file` reads it; `>> file` adds to it; `> file` replaces what it held. Text the line writes into a file is the model's own. */
function redirectEffects(segment: ShellSegment, site: CommandSite, raw: string | undefined): Ruling {
  const list: Effect[] = segment.reads.map((word) => ({ action: 'read', place: site.place(word), extent: 'file' }) as Effect)
  if (segment.writes.length === 0) return effects(...list)
  const author = raw === undefined || AUTHORS.has(commandName(raw).toLowerCase()) || segment.fedText
  if (author) return refused(USE_FILE_TOOLS)
  for (const word of segment.writes) {
    list.push(segment.appends.includes(word) ? { action: 'write', place: site.place(word), extent: 'file' } : writeOrDestroy(site, word))
  }
  return effects(...list)
}

/** A change of directory, and where it lands: a place the line names, or an unknown one. */
function directoryChange(segment: ShellSegment, here: Place, previous: Place | undefined, stack: Place[], home: string | undefined): { to: Place; invocation: Invocation } | undefined {
  const [raw, ...args] = runCommand(segment.tokens).tokens
  if (raw === undefined) return undefined
  const name = commandName(raw).toLowerCase()
  if (!CHANGES_DIRECTORY.has(name)) return undefined
  const invocation: Invocation = { command: [name], flags: new Set(args.filter((a) => a.startsWith('-') && a !== '-')), operands: args.filter((a) => !a.startsWith('-') || a === '-') }
  const target = invocation.operands[0]
  const site = siteAt(here, { home, exists: () => undefined })
  if (name === 'popd') {
    const to = stack.pop() ?? unknownPlace('popd')
    return { to, invocation }
  }
  if (name === 'pushd' && isKnown(here)) stack.push(here)
  if (target === undefined) return { to: home !== undefined ? known(resolvePlace('/', home)) : unknownPlace('~'), invocation }
  if (target === '-') return { to: previous ?? unknownPlace('-'), invocation }
  return { to: site.place(target), invocation }
}

/**
 * Does a substitution decide what this command is: `$(which rm) -rf x` runs
 * whatever it prints. The commands inside the substitution are judged on their
 * own; only a command word standing on one is hidden. The segment's flag is
 * what tells `"$(ls)"` from the literal `'$(ls)'`.
 */
function hidesCommandWord(segment: ShellSegment): boolean {
  if (!segment.substituted) return false
  const [raw] = runCommand(segment.tokens).tokens
  return raw !== undefined && /\$\(|`|<\(|>\(/.test(raw)
}

/** The facts a classifier gets, read from where the shell stands. */
export function siteAt(cwd: Place, facts: Pick<ShellFacts, 'home' | 'exists'>): CommandSite {
  return {
    cwd,
    place(word) {
      if (isUnsettled(word)) return unknownPlace(word)
      if (/^~([\\/]|$)/.test(word)) return facts.home === undefined ? unknownPlace(word) : known(resolvePlace('/', word, facts.home))
      if (/^([\\/]|[A-Za-z]:)/.test(word)) return known(resolvePlace('/', word))
      return isKnown(cwd) ? known(resolvePlace(cwd.path, word)) : unknownPlace(word)
    },
    exists: facts.exists,
  }
}
