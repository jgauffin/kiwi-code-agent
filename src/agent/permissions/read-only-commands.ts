import { commandName, runCommand, unwrapCommand } from './command-wrappers'
import { splitShellCommand, type ShellSegment } from './shell-split'
import { subcommandArguments } from './subcommand-tools'
import { sedScriptInspects, sedScriptRuns } from './sed-script'

/**
 * Said to every session, so the model reaches for a command that runs unasked
 * rather than for awk. awk is not on the list below and never will be: its
 * `system()`, `| "cmd"` and `print > file` make it a shell of its own, so
 * telling a safe program from a dangerous one means parsing the program, and
 * one miss runs anything without a prompt. The commands named here cover what
 * awk is reached for in a pipeline, and the scratch file covers the rest.
 */
export const PIPE_WRITING =
  'Take a field or a column out of a command\'s output with the commands that only inspect, which run without a permission prompt: `tr -s \' \'` into `cut`, with `sort`, `uniq -c`, `wc`, `head`, `tail`, `comm`, `nl` and `column` beside them, and `jq` or `yq` for JSON and YAML. Never awk or perl for it: they run a program of their own, so the whole call is asked every time. Where a column is not enough and the answer is computed, redirect the output to a file in the scratch folder and read that from a RunScript program.'

/**
 * Commands that change nothing, whatever their arguments: not a file, not the
 * repository, not the machine. Anything not listed is presumed to mutate. A
 * command that some argument turns into a write or a program launch is judged
 * by its arguments below instead.
 *
 * Changing nothing is only half of running unasked: which files a command here
 * reads is settled by `FILE_OPERANDS`, so being on this list is leave to run
 * but never leave to read outside the project.
 */
const READ_ONLY = new Set([
  'ls', 'dir', 'cat', 'head', 'tail', 'more', 'wc', 'cut', 'tr', 'tac', 'nl', 'column',
  'grep', 'egrep', 'fgrep', 'diff', 'cmp', 'comm', 'jq',
  'pwd', 'echo', 'printf', 'true', 'false', 'test', '[', 'which', 'type', 'where', 'whoami', 'uname',
  // `env` is not here: it runs a command, so it is unwrapped instead, and bare `env` that only prints comes out empty.
  'printenv', 'stat', 'du', 'df', 'basename', 'dirname', 'realpath', 'readlink',
  'md5sum', 'sha1sum', 'sha256sum', 'tasklist', 'ps', 'uptime',
  // Shell builtins that touch only the shell's own state. `eval`, `exec`, `source`, `.` and `trap` run code and are not here.
  ':', '[[', 'read', 'export', 'unset', 'set', 'shift', 'local', 'declare', 'typeset', 'readonly', 'break', 'continue', 'return', 'exit', 'wait', 'sleep',
])

/** `git` and friends are read-only only for some of their subcommands. */
const READ_ONLY_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set(['status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'describe', 'shortlog', 'grep', 'reflog', 'remote', 'config']),
  dotnet: new Set(['--version', '--info', '--list-sdks', '--list-runtimes']),
  npm: new Set(['ls', 'list', 'view', 'outdated', 'why', '--version', '-v']),
  node: new Set(['--version', '-v']),
  npx: new Set(['--version']),
  cargo: new Set(['--version', 'metadata', 'tree']),
  go: new Set(['version', 'env', 'list']),
}

const writesOutputFile = (args: string[]): boolean => args.some((a) => longFlag(a, '--output'))

/** Read-only subcommands that still mutate given these flags or forms. */
const SUBCOMMAND_MUTATES: Record<string, Record<string, (args: string[]) => boolean>> = {
  git: {
    remote: (args) => args.length > 0 && !['-v', 'show', 'get-url'].includes(args[0]!),
    config: (args) => !args.some((a) => ['--get', '--list', '-l', '--get-all'].includes(a)),
    reflog: (args) => args.some((a) => a === 'expire' || a === 'delete'),
    log: writesOutputFile,
    show: writesOutputFile,
    diff: writesOutputFile,
    shortlog: writesOutputFile,
    // `-O` opens the matches in a program it names.
    grep: (args) => args.some((a) => longFlag(a, '--open-files-in-pager') || shortFlags(a, 'efABCm').includes('O')),
  },
  go: { env: (args) => args.some((a) => /^--?[wu](=|$)/.test(a)) },
}

function subcommandMutates(command: string, sub: string, args: string[]): boolean {
  return SUBCOMMAND_MUTATES[command]?.[sub]?.(args) ?? false
}

/**
 * What a command would do, as its own arguments decide. Another outcome is
 * added as another kind, and the compiler then asks each reader what it makes
 * of it; a bare yes or no leaves nowhere to put one.
 */
export type CommandEffect =
  | { kind: 'inspects' }
  | { kind: 'mutates'; reason: string }
  | { kind: 'runs'; reason: string }

const INSPECTS: CommandEffect = { kind: 'inspects' }

/** The reason is shown to the user as why their answer is wanted, so it is in the command's own terms. */
const mutates = (reason: string): CommandEffect => ({ kind: 'mutates', reason })

/**
 * The command is handed, by this very argument, a program to run: what runs
 * is decided at the time, by data no rule can see ahead of it (a file `find`
 * happens to match) or by a program named only here, so no place and no kept
 * answer may stand for it; it is put to the person every time.
 */
const runs = (reason: string): CommandEffect => ({ kind: 'runs', reason })

const effect = (mutating: boolean, reason: string): CommandEffect => (mutating ? mutates(reason) : INSPECTS)

/** What a command makes of its arguments. */
type ArgumentRule = (args: string[]) => CommandEffect

/**
 * Commands that only inspect given some arguments and write a file or launch a
 * program given others. The command word is the key, so adding one is this
 * entry alone: the names are read from here rather than kept in a second list
 * that could fall out of step with it.
 */
const BY_ARGUMENTS: Record<string, ArgumentRule> = {
  find: (args) => {
    if (args.some((a) => FIND_RUN_ACTIONS.has(a))) return runs('runs a program over what it finds')
    return effect(args.some((a) => FIND_WRITE_ACTIONS.has(a)), 'deletes what it finds, or writes the matches to a file')
  },
  sed: sedEffect,
  sort: (args) => {
    if (args.some((a) => longFlag(a, '--compress-program'))) return runs('pipes its output through a program of its own')
    return effect(args.some((a) => longFlag(a, '--output') || shortFlags(a, 'ktSTo').includes('o')), 'writes its output to a file')
  },
  // `uniq IN OUT` writes OUT.
  uniq: (args) => effect(operands(args, 'fsw', ['--skip-fields', '--skip-chars', '--check-chars']).length > 1, 'writes its output to the second file it names'),
  tree: (args) => effect(args.some((a) => /[oR]/.test(shortFlags(a, 'LPIoHT'))), 'writes its listing to a file'),
  less: (args) => {
    if (args.some((a) => a.startsWith('+'))) return runs('runs a command on what it opens')
    return effect(args.some((a) => longFlag(a, '--log-file', '--LOG-FILE') || /[oO]/.test(shortFlags(a, 'bhjkoOpPtTxyz'))), 'writes a copy of what it opens')
  },
  // Setting the clock, and an operand that is not a `+FORMAT` is a time to set it to.
  date: (args) =>
    effect(
      args.some((a) => longFlag(a, '--set') || shortFlags(a, 'dfrsI').includes('s')) || operands(args, 'dfr', ['--date', '--file', '--reference']).some((o) => !o.startsWith('+')),
      "sets the machine's clock",
    ),
  // A name, or a file to read one from, sets the hostname.
  hostname: (args) => effect(operands(args, '').length > 0 || args.some((a) => longFlag(a, '--file', '--boot') || /[Fb]/.test(shortFlags(a, 'F'))), "sets the machine's hostname"),
  rg: (args) => (args.some((a) => longFlag(a, '--pre')) ? runs('runs a program over every file it searches') : INSPECTS),
  ag: (args) => (args.some((a) => longFlag(a, '--pager')) ? runs('pipes its matches through a program') : INSPECTS),
  yq: (args) => effect(args.some((a) => longFlag(a, '--inplace', '--split-exp') || /[is]/.test(shortFlags(a, 'op'))), 'edits the document in place, or splits it into files'),
  file: (args) => effect(args.some((a) => longFlag(a, '--compile') || shortFlags(a, 'eFfmP').includes('C')), 'compiles a magic file next to its source'),
}

/** `-delete` and the `-fprint*`/`-fls` family write a path find is given; `-exec`, `-execdir`, `-ok` and `-okdir` run a program of find's own choosing over whatever it matches. */
const FIND_WRITE_ACTIONS = new Set(['-delete', '-fprint', '-fprint0', '-fprintf', '-fls'])
const FIND_RUN_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir'])

/** Every word that is not a flag names a file this command reads. */
const namedFiles = (args: string[]): string[] => operands(args, '')

/**
 * A pattern or a script stands where a file would, so the first operand is not
 * one: `grep foo bar.ts` reads `bar.ts` alone. A flag that supplies the pattern
 * instead leaves every operand a file. A word that is no path at all is left in
 * and costs nothing: it reads as a relative path, which lies in the project.
 */
const filesAfterPattern =
  (letters: string, ...flags: string[]) =>
  (args: string[]): string[] => {
    const files = namedFiles(args)
    const supplied = args.some((a) => longFlag(a, ...flags) || [...shortFlags(a, letters)].some((l) => letters.includes(l)))
    return supplied ? files : files.slice(1)
  }

/** `-C`, `--git-dir` and `--work-tree` point git at a repository, which may be any repository on the machine. */
function gitDirectories(args: string[]): string[] {
  const directories: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '-C') {
      if (args[i + 1] !== undefined) directories.push(args[++i]!)
    } else if (longFlag(arg, '--git-dir', '--work-tree')) {
      const equals = arg.indexOf('=')
      if (equals !== -1) directories.push(arg.slice(equals + 1))
      else if (args[i + 1] !== undefined) directories.push(args[++i]!)
    }
  }
  return directories
}

/**
 * Where a command's own words name files it reads, so a read outside the
 * project is asked about as a write to one would be. A command absent here
 * reads no file it names and its words are never judged as paths: `echo
 * /etc/passwd` prints a string, `basename /usr/lib` cuts one, and `whoami`
 * names nothing. Adding a command that reads what it names is an entry here;
 * leaving it out is what lets a path through unjudged.
 */
const FILE_OPERANDS: Record<string, (args: string[]) => string[]> = {
  cat: namedFiles, head: namedFiles, tail: namedFiles, more: namedFiles, tac: namedFiles, nl: namedFiles,
  column: namedFiles, cut: namedFiles, tr: namedFiles, wc: namedFiles, ls: namedFiles, dir: namedFiles,
  stat: namedFiles, du: namedFiles, df: namedFiles, diff: namedFiles, cmp: namedFiles, comm: namedFiles,
  md5sum: namedFiles, sha1sum: namedFiles, sha256sum: namedFiles, sort: namedFiles, uniq: namedFiles,
  file: namedFiles, tree: namedFiles, less: namedFiles, find: namedFiles,
  grep: filesAfterPattern('ef', '--regexp', '--file'),
  egrep: filesAfterPattern('ef', '--regexp', '--file'),
  fgrep: filesAfterPattern('ef', '--regexp', '--file'),
  rg: filesAfterPattern('ef', '--regexp', '--file'),
  ag: filesAfterPattern('ef', '--regexp', '--file'),
  sed: filesAfterPattern('ef', '--expression', '--file'),
  jq: filesAfterPattern('f', '--from-file'),
  yq: filesAfterPattern('f', '--from-file'),
  git: gitDirectories,
}

/** The files this command reads among its own words; none for a command whose words name no file. */
export function fileOperands(command: string, args: string[]): string[] {
  return FILE_OPERANDS[command]?.(args) ?? []
}

/**
 * Has this command nothing an argument could point at? It changes nothing
 * whatever its arguments and reads no file it names, so words fed in by another
 * command leave it the printing or counting it already was: `ls | xargs echo`
 * reaches no further than `echo` typed by hand, which runs unasked too.
 */
function reachesNoFileThroughArguments(command: string): boolean {
  return READ_ONLY.has(command) && FILE_OPERANDS[command] === undefined
}

/** What this command's own arguments make of it; undefined for a command they do not decide. */
export function commandEffect(command: string, args: string[]): CommandEffect | undefined {
  return BY_ARGUMENTS[command]?.(args)
}

/** Flags that only change how sed reads its input. */
const SED_FLAGS = 'nszuEr'
const SED_LONG_FLAGS = ['--quiet', '--silent', '--separate', '--null-data', '--unbuffered', '--regexp-extended', '--follow-symlinks', '--posix', '--debug', '--sandbox']

const SED_SCRIPT_UNREAD = 'has a script this cannot read, and sed scripts can run a command or write a file'

/**
 * `sed` only inspects when its whole script is a shape without effect, which
 * `sedScriptInspects` decides. Here the script is found: `-i` edits in place,
 * `-f` takes it from a file nobody has shown the user, and a flag not listed
 * above is taken as a write, since what it does with its value is unknown.
 */
function sedEffect(args: string[]): CommandEffect {
  if (args.some((a) => longFlag(a, '--help', '--version'))) return INSPECTS
  const parsed = sedArguments(args)
  if ('kind' in parsed) return parsed
  // Without `-e` the first operand is the script; the rest are files, which sed only reads.
  const scripts = parsed.scripts.length ? parsed.scripts : parsed.operands.slice(0, 1)
  if (scripts.length === 0) return mutates(SED_SCRIPT_UNREAD)
  // sed joins its scripts with a newline, so a command split across two of them reads as one.
  return sedScriptEffect(scripts.join('\n'))
}

function sedScriptEffect(script: string): CommandEffect {
  if (sedScriptInspects(script)) return INSPECTS
  if (sedScriptRuns(script)) return runs('has a script that may run a command with `e`')
  return mutates('has a script beyond printing and substituting, which may write a path with `w`')
}

type SedArguments = { scripts: string[]; operands: string[] }
/** What one flag word gives sed: a script, perhaps taken from the word after it. */
type SedFlag = { script?: string; takesNext: boolean }

/** The scripts `-e` gives sed and its other operands, or what a flag that settles it makes of it. */
function sedArguments(args: string[]): SedArguments | CommandEffect {
  const parsed: SedArguments = { scripts: [], operands: [] }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      parsed.operands.push(...args.slice(i + 1))
      break
    }
    if (!isFlag(arg)) {
      parsed.operands.push(arg)
      continue
    }
    const flag = arg.startsWith('--') ? sedLongFlag(arg, args[i + 1]) : sedShortFlags(arg, args[i + 1])
    if ('kind' in flag) return flag
    if (flag.script !== undefined) parsed.scripts.push(flag.script)
    if (flag.takesNext) i++
  }
  return parsed
}

function sedLongFlag(arg: string, next: string | undefined): SedFlag | CommandEffect {
  if (longFlag(arg, '--expression')) {
    const equals = arg.indexOf('=')
    return equals === -1 ? scriptInNext(next) : { script: arg.slice(equals + 1), takesNext: false }
  }
  if (longFlag(arg, ...SED_LONG_FLAGS)) return { takesNext: false }
  return mutates(`is given ${arg}, whose effect is unknown here`)
}

function sedShortFlags(arg: string, next: string | undefined): SedFlag | CommandEffect {
  const letters = shortFlags(arg, 'e')
  if (![...letters].every((letter) => letter === 'e' || SED_FLAGS.includes(letter))) return mutates(`is given ${arg}, which may edit in place or take its script from a file`)
  if (!letters.endsWith('e')) return { takesNext: false }
  // `-e` takes the rest of its own word, or the word after when it ends there.
  const inline = arg.slice(letters.length + 1)
  return inline === '' ? scriptInNext(next) : { script: inline, takesNext: false }
}

function scriptInNext(next: string | undefined): SedFlag | CommandEffect {
  return next === undefined ? mutates(SED_SCRIPT_UNREAD) : { script: next, takesNext: true }
}

/** A word that sets a flag; a lone `-` names standard input. */
function isFlag(arg: string): boolean {
  return arg.length > 1 && arg.startsWith('-')
}

/** Does a `--name` word stand for one of these long flags? GNU tools take any unambiguous abbreviation of one. */
function longFlag(arg: string, ...flags: string[]): boolean {
  if (!arg.startsWith('--') || arg.length < 3) return false
  const name = arg.split('=', 1)[0]!
  return flags.some((flag) => flag.startsWith(name))
}

/** The letters a `-abc` word sets. A letter in `valued` takes the rest of the word as its value, and so does `=`. */
function shortFlags(arg: string, valued: string): string {
  if (!/^-[^-]/.test(arg)) return ''
  let letters = ''
  for (const letter of arg.slice(1)) {
    if (letter === '=') break
    letters += letter
    if (valued.includes(letter)) break
  }
  return letters
}

/** The words that are neither a flag nor the value of one. */
function operands(args: string[], valued: string, longValued: string[] = []): string[] {
  const found: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') return [...found, ...args.slice(i + 1)]
    if (!isFlag(arg)) found.push(arg)
    else if (valueFollows(arg, valued, longValued)) i++
  }
  return found
}

/** Does this flag word leave its value to the word after it? */
function valueFollows(arg: string, valued: string, longValued: string[]): boolean {
  if (arg.startsWith('--')) return !arg.includes('=') && longFlag(arg, ...longValued)
  const letters = shortFlags(arg, valued)
  // A value letter that ends the word takes the next one.
  return valued.includes(letters.at(-1) ?? '-') && letters.length + 1 === arg.length
}

export type ReadOnlyContext = {
  /**
   * May the session stand in this directory: inside the project, or under a
   * directory the user has allowed `cd` into. Decides `cd`; without it `cd` is
   * presumed to leave.
   */
  canEnter?: (path: string) => boolean
  /**
   * May the session read this path: inside the project, or under a directory a
   * rule already grants. Without it a path is not judged at all, since a caller
   * that leaves it out is asking only whether the command mutates.
   */
  canRead?: (path: string) => boolean
  /**
   * Is this path inside the project? Decides whether a write naming no other
   * ground is the Allow writes switch's alone (inside) or a folder or file
   * that may be kept for the session or the person (outside). Without it a
   * write naming a path is judged exactly as it was before this question
   * existed, by the rule that already covers whatever runs.
   */
  insideProject?: (path: string) => boolean
  /** The person's home folder, which a leading `~` stands for. Without it `~` names no place. */
  home?: string
  /**
   * The directories an answer about entering this one may be kept for, the
   * one it names first. Empty where none may be kept, which leaves the
   * answer to this call alone.
   */
  placesToKeep?: (path: string) => string[]
  /**
   * The absolute place a path names, read from where the shell stands. Undefined
   * when the path depends on something the line does not settle: a variable,
   * another command's output, or a `cd` that may or may not have run.
   */
  where?: (path: string) => string | undefined
}

/** Every file this segment reads lies where the session may read. */
function readsWithin(paths: string[], context: ReadOnlyContext): boolean {
  const canRead = context.canRead
  return canRead === undefined || paths.every((path) => canRead(path))
}

/** Does this segment change directory, whether or not we can read where to? */
export function isCdCommand(tokens: string[]): boolean {
  const [raw] = unwrapCommand(tokens)
  return raw !== undefined && commandName(raw) === 'cd'
}

/**
 * The directory a segment changes to, when it is a plain `cd` to one place we
 * can name. An expansion is left out: a rule written for `$HOME` would say
 * nothing about where the session actually lands. A leading `~` is the home
 * folder when `home` is known; `~user` and `-` (the previous directory) are
 * nowhere this line shows.
 */
export function cdTarget(tokens: string[], home?: string): string | undefined {
  const [raw, ...args] = unwrapCommand(tokens)
  if (!raw || commandName(raw) !== 'cd' || args.length !== 1) return undefined
  const target = args[0]!
  if (target === '-') return undefined
  const below = home !== undefined && /^~(\/|$)/.test(target) ? target.slice(1) : undefined
  if (below !== undefined) return /[$~`]/.test(below) ? undefined : `${home!.split('\\').join('/')}${below}`
  return /[$~`]/.test(target) ? undefined : target
}

/** The directory a `cd` rule allows, or undefined for any other pattern. `cd:*` is not one: it names no directory. */
export function cdRuleDirectory(pattern: string): string | undefined {
  return pattern.startsWith('cd ') ? pattern.slice(3).trim() || undefined : undefined
}

/** The directory a "read" rule allows reading in, or undefined for any other pattern. */
export function readRuleDirectory(pattern: string): string | undefined {
  return pattern.startsWith('read ') ? pattern.slice(5).trim() || undefined : undefined
}

/**
 * The folder or file a "write" rule allows, or undefined for any other
 * pattern: unlike a command rule, it names exactly the one place a write was
 * granted for, covering what lies beneath it rather than standing for every
 * command that might write somewhere else.
 */
export function writeRuleTarget(pattern: string): string | undefined {
  return pattern.startsWith('write ') ? pattern.slice(6).trim() || undefined : undefined
}

/**
 * Does a substitution decide what this command is: `$(which rm) -rf x` runs
 * whatever it prints, which neither the list below nor a rule can judge, so such
 * a line is answered per call. The commands inside the substitution are listed
 * and judged on their own; only a command word standing on one is hidden. The
 * segment's flag is what tells `"$(ls)"` from the literal `'$(ls)'`.
 */
export function hidesCommandWord(segment: ShellSegment): boolean {
  if (!segment.substituted) return false
  const [raw] = unwrapCommand(segment.tokens)
  return raw !== undefined && /\$\(|`|<\(|>\(/.test(raw)
}

/**
 * Does this call run a program of its own that no place or kept answer may
 * stand for: its command word comes from a substitution, or one of its own
 * arguments hands it a program to run (`find -exec`, sed's `e`, `sort
 * --compress-program`, `rg --pre`, `ag --pager`, `less`'s leading `+`). What
 * runs is decided by data outside the line or by a program named only here,
 * so it is asked about every time, never covered by a rule remembered for it.
 */
export function runsProgramOfItsOwn(segment: ShellSegment): boolean {
  if (hidesCommandWord(segment)) return true
  const [raw, ...args] = runCommand(segment.tokens).tokens
  if (!raw) return false
  return commandEffect(commandName(raw), args)?.kind === 'runs'
}

export function isReadOnlySegment(segment: ShellSegment, context: ReadOnlyContext = {}): boolean {
  if (segment.writesFile || hidesCommandWord(segment)) return false
  // A file fed in by `< path` is read as surely as one named as an argument.
  if (!readsWithin(segment.reads, context)) return false
  // `timeout 30 ls` is a listing and `env FOO=1 rm -rf x` is a deletion: what runs is what counts.
  const { tokens, argumentsFromInput } = runCommand(segment.tokens)
  const [raw, ...args] = tokens
  if (!raw) return true
  const command = commandName(raw)
  // Arguments nobody can read may name any file at all, so nothing here can be shown to stay in the project.
  if (argumentsFromInput && !reachesNoFileThroughArguments(command)) return false
  // Moving around inside the project changes nothing; going anywhere else needs a rule for that directory.
  // A target we cannot read at all (an expansion, `~`) is nowhere a rule can name, so it is never granted here.
  if (command === 'cd') {
    const target = cdTarget(segment.tokens, context.home)
    return target !== undefined && (context.canEnter?.(target) ?? false)
  }
  if (!readsWithin(fileOperands(command, args), context)) return false
  if (READ_ONLY.has(command)) return true
  const byArguments = commandEffect(command, args)
  if (byArguments) return byArguments.kind === 'inspects'
  const subs = READ_ONLY_SUBCOMMANDS[command]
  if (subs) {
    // `git -C ../other status` inspects as much as `git status` does, so the options before the subcommand are read past; the repository it names is judged above.
    const [sub, ...rest] = subcommandArguments(command, args)
    return sub !== undefined && subs.has(sub) && !subcommandMutates(command, sub, rest)
  }
  return false
}

/** Does this segment run git to change the repository or its config? A redirect of its output writes a file, not the repository, so it is left out. */
export function isGitWrite(segment: ShellSegment): boolean {
  const [raw] = runCommand(segment.tokens).tokens
  return raw !== undefined && commandName(raw) === 'git' && !isReadOnlySegment({ ...segment, writesFile: false })
}

/** True when every simple command in the line only inspects, the ones a substitution holds among them. */
export function isReadOnlyCommand(command: string, context: ReadOnlyContext = {}): boolean {
  const segments = splitShellCommand(command).segments
  const contexts = segmentContexts(segments, context)
  return segments.every((s, i) => isReadOnlySegment(s, contexts[i]))
}

/** Past this many places a line may stand in, a relative path is judged from none of them. */
const MAX_PLACES = 64

/**
 * The context each command of a line is judged in: a relative path it names
 * is read from where the `cd`s before it moved the shell. Along a plain `&&`
 * chain from the start of the line that place is known, since a command there
 * runs only once every `cd` before it has landed. Past anything else (`;`,
 * `||`, a loop, a subshell) a command may stand in any place the line has
 * reached, so a path must hold from each of them. A `cd` in a pipeline runs
 * in a subshell of its own and moves nothing after it.
 */
export function segmentContexts(segments: ShellSegment[], context: ReadOnlyContext): ReadOnlyContext[] {
  let here = ''
  let followed = true
  let reached: string[] | undefined = [here]
  return segments.map((segment, i) => {
    followed &&= segment.joined !== undefined
    const places = followed ? [here] : reached
    const target = cdTarget(segment.tokens, context.home)
    if (target !== undefined && reached !== undefined) {
      if (!followed) reached = [...new Set([...reached, ...reached.map((place) => joinPath(place, target))])]
      else if (segment.joined !== '|' && segments[i + 1]?.joined !== '|') {
        here = joinPath(here, target)
        reached = [...new Set([...reached, here])]
      }
      if (reached.length > MAX_PLACES) reached = undefined
    }
    return standingIn(places, context)
  })
}

/** The context as seen from these places, every one of which a path must hold from; none known leaves only absolute paths to judge. */
function standingIn(places: string[] | undefined, context: ReadOnlyContext): ReadOnlyContext {
  if (places?.length === 1 && places[0] === '') return context
  const from = (check: (path: string) => boolean) => (path: string) =>
    isAbsolutePath(path) ? check(path) : (places?.every((place) => check(joinPath(place, path))) ?? false)
  const { canEnter, canRead, placesToKeep, where } = context
  const standing = where
    ? (path: string) => (isAbsolutePath(path) ? where(path) : places?.length === 1 ? where(joinPath(places[0]!, path)) : undefined)
    : undefined
  // A directory reached from more than one place is no single place to keep an answer for.
  const keep = placesToKeep
    ? (path: string) => (isAbsolutePath(path) ? placesToKeep(path) : places?.length === 1 ? placesToKeep(joinPath(places[0]!, path)) : [])
    : undefined
  // Where a write lands is still read from the project root, so `insideProject` is left as it was.
  return {
    ...context,
    ...(canEnter ? { canEnter: from(canEnter) } : {}),
    ...(canRead ? { canRead: from(canRead) } : {}),
    ...(keep ? { placesToKeep: keep } : {}),
    ...(standing ? { where: standing } : {}),
  }
}

/** `place` is relative to the project root or absolute; the empty place is the root itself. */
function joinPath(place: string, path: string): string {
  return place === '' || isAbsolutePath(path) ? path : `${place}/${path}`
}

/** `/x`, `\x` and `D:` name a place of their own; Git Bash's `/d/x` is among the first. */
function isAbsolutePath(path: string): boolean {
  return /^([\\/]|[A-Za-z]:)/.test(path)
}
