import { commandName, runCommand, unwrapCommand } from './command-wrappers'
import { splitShellCommand, type ShellSegment } from './shell-split'
import { subcommandArguments } from './subcommand-tools'
import { sedScriptInspects } from './sed-script'

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
 * Commands that only inspect, whatever their arguments: they never change
 * files, the repository or the machine, so running them needs no permission.
 * Anything not listed is presumed to mutate. A command that some argument
 * turns into a write or a program launch is judged by its arguments below
 * instead, so this list stays safe for arguments nobody can read, such as
 * those `xargs` adds.
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

/** Subcommands that still mutate given these flags or forms. */
function subcommandMutates(command: string, sub: string, args: string[]): boolean {
  if (command === 'git') {
    if (sub === 'remote') return args.length > 0 && args[0] !== '-v' && args[0] !== 'show' && args[0] !== 'get-url'
    if (sub === 'config') return !args.includes('--get') && !args.includes('--list') && !args.includes('-l') && !args.includes('--get-all')
    if (sub === 'reflog') return args.some((a) => a === 'expire' || a === 'delete')
    if (sub === 'log' || sub === 'show' || sub === 'diff' || sub === 'shortlog') return args.some((a) => longFlag(a, '--output'))
    // `-O` opens the matches in a program it names.
    if (sub === 'grep') return args.some((a) => longFlag(a, '--open-files-in-pager') || shortFlags(a, 'efABCm').includes('O'))
  }
  if (command === 'go' && sub === 'env') return args.some((a) => /^--?[wu](=|$)/.test(a))
  return false
}

/**
 * What a command would do, as its own arguments decide. Another outcome is
 * added as another kind, and the compiler then asks each reader what it makes
 * of it; a bare yes or no leaves nowhere to put one.
 */
export type CommandEffect =
  | { kind: 'inspects' }
  | { kind: 'mutates'; reason: string }

const INSPECTS: CommandEffect = { kind: 'inspects' }

/** The reason is shown to the user as why their answer is wanted, so it is in the command's own terms. */
const mutates = (reason: string): CommandEffect => ({ kind: 'mutates', reason })

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
  find: (args) => effect(args.some((a) => FIND_ACTIONS.has(a)), 'deletes what it finds, runs a program over it, or writes the matches to a file'),
  sed: sedEffect,
  sort: (args) => effect(args.some((a) => longFlag(a, '--output', '--compress-program') || shortFlags(a, 'ktSTo').includes('o')), 'writes its output to a file, or pipes it through a program of its own'),
  // `uniq IN OUT` writes OUT.
  uniq: (args) => effect(operands(args, 'fsw', ['--skip-fields', '--skip-chars', '--check-chars']).length > 1, 'writes its output to the second file it names'),
  tree: (args) => effect(args.some((a) => /[oR]/.test(shortFlags(a, 'LPIoHT'))), 'writes its listing to a file'),
  less: (args) => effect(args.some((a) => a.startsWith('+') || longFlag(a, '--log-file', '--LOG-FILE') || /[oO]/.test(shortFlags(a, 'bhjkoOpPtTxyz'))), 'runs a command on what it opens, or writes a copy of it'),
  // Setting the clock, and an operand that is not a `+FORMAT` is a time to set it to.
  date: (args) =>
    effect(
      args.some((a) => longFlag(a, '--set') || shortFlags(a, 'dfrsI').includes('s')) || operands(args, 'dfr', ['--date', '--file', '--reference']).some((o) => !o.startsWith('+')),
      "sets the machine's clock",
    ),
  // A name, or a file to read one from, sets the hostname.
  hostname: (args) => effect(operands(args, '').length > 0 || args.some((a) => longFlag(a, '--file', '--boot') || /[Fb]/.test(shortFlags(a, 'F'))), "sets the machine's hostname"),
  rg: (args) => effect(args.some((a) => longFlag(a, '--pre')), 'runs a program over every file it searches'),
  ag: (args) => effect(args.some((a) => longFlag(a, '--pager')), 'pipes its matches through a program'),
  yq: (args) => effect(args.some((a) => longFlag(a, '--inplace', '--split-exp') || /[is]/.test(shortFlags(a, 'op'))), 'edits the document in place, or splits it into files'),
  file: (args) => effect(args.some((a) => longFlag(a, '--compile') || shortFlags(a, 'eFfmP').includes('C')), 'compiles a magic file next to its source'),
}

const FIND_ACTIONS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'])

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
  const scripts: string[] = []
  const words: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      words.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('--') && arg.length > 2) {
      if (!longFlag(arg, '--expression')) {
        if (!SED_LONG_FLAGS.some((flag) => longFlag(arg, flag))) return mutates(`is given ${arg}, whose effect is unknown here`)
        continue
      }
      const equals = arg.indexOf('=')
      const script = equals === -1 ? args[++i] : arg.slice(equals + 1)
      if (script === undefined) return mutates(SED_SCRIPT_UNREAD)
      scripts.push(script)
      continue
    }
    if (arg.length > 1 && arg.startsWith('-')) {
      const letters = shortFlags(arg, 'e')
      if (![...letters].every((letter) => letter === 'e' || SED_FLAGS.includes(letter))) return mutates(`is given ${arg}, which may edit in place or take its script from a file`)
      if (letters.endsWith('e')) {
        // `-e` takes the rest of its own word, or the word after when it ends there.
        const inline = arg.slice(letters.length + 1)
        const script = inline === '' ? args[++i] : inline
        if (script === undefined) return mutates(SED_SCRIPT_UNREAD)
        scripts.push(script)
      }
      continue
    }
    words.push(arg)
  }
  // Without `-e` the first operand is the script; the rest are files, which sed only reads.
  if (scripts.length === 0 && words[0] !== undefined) scripts.push(words[0])
  if (scripts.length === 0) return mutates(SED_SCRIPT_UNREAD)
  // sed joins its scripts with a newline, so a command split across two of them reads as one.
  return effect(!sedScriptInspects(scripts.join('\n')), 'has a script beyond printing and substituting, which may run a command with `e` or write a path with `w`')
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
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && longFlag(arg, ...longValued)) i++
    } else if (arg.length > 1 && arg.startsWith('-')) {
      const letters = shortFlags(arg, valued)
      // A value letter that ends the word takes the next one.
      if (valued.includes(letters.at(-1) ?? '-') && letters.length + 1 === arg.length) i++
    } else found.push(arg)
  }
  return found
}

export type ReadOnlyContext = {
  /**
   * May the session stand in this directory: inside the project, or under a
   * directory the user has allowed `cd` into. Decides `cd`; without it `cd` is
   * presumed to leave.
   */
  canEnter?: (path: string) => boolean
}

/** Does this segment change directory, whether or not we can read where to? */
export function isCdCommand(tokens: string[]): boolean {
  const [raw] = unwrapCommand(tokens)
  return raw !== undefined && commandName(raw) === 'cd'
}

/**
 * The directory a segment changes to, when it is a plain `cd` to one place we
 * can name. An expansion is left out: a rule written for `$HOME` would say
 * nothing about where the session actually lands.
 */
export function cdTarget(tokens: string[]): string | undefined {
  const [raw, ...args] = unwrapCommand(tokens)
  if (!raw || commandName(raw) !== 'cd' || args.length !== 1) return undefined
  const target = args[0]!
  return /[$~`]/.test(target) ? undefined : target
}

/** The directory a `cd` rule allows, or undefined for any other pattern. `cd:*` is not one: it names no directory. */
export function cdRuleDirectory(pattern: string): string | undefined {
  return pattern.startsWith('cd ') ? pattern.slice(3).trim() || undefined : undefined
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

export function isReadOnlySegment(segment: ShellSegment, context: ReadOnlyContext = {}): boolean {
  if (segment.writesFile || hidesCommandWord(segment)) return false
  // `timeout 30 ls` is a listing and `env FOO=1 rm -rf x` is a deletion: what runs is what counts.
  const { tokens, argumentsFromInput } = runCommand(segment.tokens)
  const [raw, ...args] = tokens
  if (!raw) return true
  const command = commandName(raw)
  // Arguments nobody can read may be any at all, so only a command no argument turns into a write passes.
  if (argumentsFromInput) return READ_ONLY.has(command)
  // Moving around inside the project changes nothing; going anywhere else needs a rule for that directory.
  if (command === 'cd') return args.length === 1 && (context.canEnter?.(args[0]!) ?? false)
  if (READ_ONLY.has(command)) return true
  const byArguments = commandEffect(command, args)
  if (byArguments) return byArguments.kind === 'inspects'
  const subs = READ_ONLY_SUBCOMMANDS[command]
  if (subs) {
    // `git -C ../other status` inspects as much as `git status` does, so the options before the subcommand are read past.
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
  return splitShellCommand(command).segments.every((s) => isReadOnlySegment(s, context))
}
