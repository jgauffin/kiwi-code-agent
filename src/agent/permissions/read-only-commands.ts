import { commandName, unwrapCommand } from './command-wrappers'
import { splitShellCommand, type ShellSegment } from './shell-split'

/**
 * Commands that only inspect: they never change files, the repository or
 * the machine, so running them needs no permission. Anything not listed is
 * presumed to mutate. A command that can go either way is judged by its
 * arguments below.
 */
const READ_ONLY = new Set([
  'ls', 'dir', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'sort', 'uniq', 'cut', 'tr', 'tac', 'nl', 'column',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'diff', 'cmp', 'comm', 'jq', 'yq',
  'cd', 'pwd', 'echo', 'printf', 'true', 'false', 'test', '[', 'which', 'type', 'where', 'whoami', 'hostname', 'date', 'uname',
  // `env` is not here: it runs a command, so it is unwrapped instead, and bare `env` that only prints comes out empty.
  'printenv', 'stat', 'file', 'du', 'df', 'tree', 'basename', 'dirname', 'realpath', 'readlink',
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
  }
  return false
}

/** Read-only commands that turn into writes or code execution with these arguments. */
function argumentsMutate(command: string, args: string[]): boolean {
  switch (command) {
    case 'find':
      return args.some((a) => a === '-delete' || a === '-exec' || a === '-execdir' || a === '-ok' || a === '-okdir' || a === '-fprint')
    case 'sed':
      return args.some((a) => a === '-i' || a.startsWith('-i') || a === '--in-place' || a.startsWith('--in-place='))
    default:
      return false
  }
}

const READ_ONLY_BY_ARGUMENTS = new Set(['find', 'sed'])

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
  const [raw, ...args] = unwrapCommand(segment.tokens)
  if (!raw) return true
  const command = commandName(raw)
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
