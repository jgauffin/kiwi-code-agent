/**
 * Programs that run another command with the environment, the clock or the
 * session changed. They decide nothing themselves, so both the read-only
 * check and the permission rules have to see past them to the command that
 * actually runs: `timeout 30 ls` is a listing, `timeout 30 rm -rf build` is a
 * deletion, and a rule the user wrote for `npm test` covers `timeout 300 npm
 * test`.
 *
 * Judging a wrapper by its own name is the mistake either way round: listed as
 * read-only it waves through whatever it wraps, and left out it prompts for a
 * listing and lets a deny rule be walked past.
 *
 * A wrapper whose own arguments cannot be read is left standing as itself, so
 * it is presumed to mutate rather than guessed at.
 */

/** The last path segment, without a `.exe`: `/usr/bin/env` and `env.exe` are the same program. */
export const commandName = (command: string): string => command.replace(/\\/g, '/').split('/').pop()!.replace(/\.exe$/i, '')

/** The command a wrapper runs: empty when it runs none, undefined when its arguments cannot be read. */
type Unwrap = (args: string[]) => string[] | undefined

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

const WRAPPERS: Record<string, Unwrap> = {
  /** `env [-i] [-u NAME] [--chdir=DIR] [NAME=VALUE]... [COMMAND [ARG]...]`; with no command it only prints the environment. */
  env: (args) => {
    let i = 0
    while (i < args.length) {
      const arg = args[i]!
      if (arg === '-i' || arg === '--ignore-environment' || arg === '-0' || arg === '--null' || arg === '-v' || arg === '--debug') i += 1
      else if (arg === '-u' || arg === '--unset' || arg === '-C' || arg === '--chdir') i += 2
      else if (arg.startsWith('--unset=') || arg.startsWith('--chdir=')) i += 1
      // `-S` splits a string of its own into a command, and an unknown flag may do anything.
      else if (arg.startsWith('-')) return undefined
      else if (ASSIGNMENT.test(arg)) i += 1
      else break
    }
    return args.slice(Math.min(i, args.length))
  },
  /** `timeout [-k DURATION] [-s SIGNAL] [--foreground] DURATION COMMAND [ARG]...`. */
  timeout: (args) => {
    let i = 0
    while (i < args.length && args[i]!.startsWith('-')) {
      const flag = args[i]!
      i += flag === '-k' || flag === '--kill-after' || flag === '-s' || flag === '--signal' ? 2 : 1
    }
    // The duration, and then the command it bounds.
    return i < args.length ? args.slice(i + 1) : undefined
  },
  /** `nohup COMMAND [ARG]...`. */
  nohup: (args) => args,
}

/** How many wrappers deep to look; each one takes at least its own name, so this is a bound, not a rule. */
const DEPTH = 4

/**
 * The command a segment really runs, with any wrappers taken off. Empty tokens
 * mean nothing runs, which every caller already reads as harmless; a wrapper
 * that could not be read comes back untouched, so it is judged as itself.
 */
export function unwrapCommand(tokens: string[]): string[] {
  let current = tokens
  for (let depth = 0; depth < DEPTH; depth++) {
    const [raw, ...args] = current
    if (raw === undefined) return current
    const unwrap = WRAPPERS[commandName(raw)]
    if (!unwrap) return current
    const wrapped = unwrap(args)
    if (wrapped === undefined) return current
    current = wrapped
  }
  return current
}
