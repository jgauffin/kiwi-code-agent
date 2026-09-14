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
  'env', 'printenv', 'stat', 'file', 'du', 'df', 'tree', 'basename', 'dirname', 'realpath', 'readlink',
  'md5sum', 'sha1sum', 'sha256sum', 'tasklist', 'ps', 'uptime',
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
  /** Is this path inside the project? Decides `cd`; without it `cd` is presumed to leave. */
  insideProject?: (path: string) => boolean
}

export function isReadOnlySegment(segment: ShellSegment, context: ReadOnlyContext = {}): boolean {
  if (segment.writesFile) return false
  const [raw, ...args] = segment.tokens
  if (!raw) return true
  const command = raw.replace(/\\/g, '/').split('/').pop()!.replace(/\.exe$/i, '')
  // Moving around inside the project changes nothing; leaving it is a prompt.
  if (command === 'cd') return args.length === 1 && (context.insideProject?.(args[0]!) ?? false)
  if (READ_ONLY.has(command)) return true
  if (READ_ONLY_BY_ARGUMENTS.has(command)) return !argumentsMutate(command, args)
  const subs = READ_ONLY_SUBCOMMANDS[command]
  if (subs) {
    const [sub, ...rest] = args
    return sub !== undefined && subs.has(sub) && !subcommandMutates(command, sub, rest)
  }
  return false
}

/** True when every simple command in the line only inspects. */
export function isReadOnlyCommand(command: string, context: ReadOnlyContext = {}): boolean {
  const parsed = splitShellCommand(command)
  if (parsed.substitutes) return false
  return parsed.segments.every((s) => isReadOnlySegment(s, context))
}
