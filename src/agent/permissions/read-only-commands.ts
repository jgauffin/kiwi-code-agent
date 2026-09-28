import { commandName, runCommand, unwrapCommand } from './command-wrappers'
import { splitShellCommand, type ShellSegment } from './shell-split'

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

/** Commands that write a file or launch a program given these arguments, and only inspect otherwise. */
function argumentsMutate(command: string, args: string[]): boolean {
  switch (command) {
    case 'find':
      return args.some((a) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'].includes(a))
    case 'sed':
      return args.some((a) => a === '-i' || a.startsWith('-i') || a === '--in-place' || a.startsWith('--in-place='))
    case 'sort':
      return args.some((a) => longFlag(a, '--output', '--compress-program') || shortFlags(a, 'ktSTo').includes('o'))
    // `uniq IN OUT` writes OUT.
    case 'uniq':
      return operands(args, 'fsw', ['--skip-fields', '--skip-chars', '--check-chars']).length > 1
    case 'tree':
      return args.some((a) => /[oR]/.test(shortFlags(a, 'LPIoHT')))
    case 'less':
      return args.some((a) => a.startsWith('+') || longFlag(a, '--log-file', '--LOG-FILE') || /[oO]/.test(shortFlags(a, 'bhjkoOpPtTxyz')))
    // Setting the clock, and an operand that is not a `+FORMAT` is a time to set it to.
    case 'date':
      return args.some((a) => longFlag(a, '--set') || shortFlags(a, 'dfrsI').includes('s')) || operands(args, 'dfr', ['--date', '--file', '--reference']).some((o) => !o.startsWith('+'))
    // A name, or a file to read one from, sets the hostname.
    case 'hostname':
      return operands(args, '').length > 0 || args.some((a) => longFlag(a, '--file', '--boot') || /[Fb]/.test(shortFlags(a, 'F')))
    // `--pre` runs a program over every file searched.
    case 'rg':
      return args.some((a) => longFlag(a, '--pre'))
    case 'ag':
      return args.some((a) => longFlag(a, '--pager'))
    // `-i` edits in place and `-s` splits documents into files.
    case 'yq':
      return args.some((a) => longFlag(a, '--inplace', '--split-exp') || /[is]/.test(shortFlags(a, 'op')))
    // `-C` compiles a magic file next to its source.
    case 'file':
      return args.some((a) => longFlag(a, '--compile') || shortFlags(a, 'eFfmP').includes('C'))
    default:
      return false
  }
}

const READ_ONLY_BY_ARGUMENTS = new Set(['find', 'sed', 'sort', 'uniq', 'tree', 'less', 'date', 'hostname', 'rg', 'ag', 'yq', 'file'])

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
  if (READ_ONLY_BY_ARGUMENTS.has(command)) return !argumentsMutate(command, args)
  const subs = READ_ONLY_SUBCOMMANDS[command]
  if (subs) {
    const [sub, ...rest] = args
    return sub !== undefined && subs.has(sub) && !subcommandMutates(command, sub, rest)
  }
  return false
}

/** True when every simple command in the line only inspects, the ones a substitution holds among them. */
export function isReadOnlyCommand(command: string, context: ReadOnlyContext = {}): boolean {
  return splitShellCommand(command).segments.every((s) => isReadOnlySegment(s, context))
}
