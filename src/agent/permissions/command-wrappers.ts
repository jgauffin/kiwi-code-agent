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
  /** `xargs [OPTION]... [COMMAND [ARG]...]`; with no command it runs `echo`, which only prints. */
  xargs: (args) => {
    let i = 0
    while (i < args.length && args[i]!.startsWith('-')) {
      const arg = args[i]!
      if (arg === '--') return args.slice(i + 1)
      if (arg.startsWith('--')) {
        const [name] = arg.split('=', 1)
        if (XARGS_LONG_VALUED.has(name!)) i += arg.includes('=') ? 1 : 2
        else if (XARGS_LONG_FLAGS.has(name!)) i += 1
        else return undefined
      } else if (XARGS_VALUED.includes(arg[1] ?? '-')) i += arg.length > 2 ? 1 : 2
      else if (XARGS_OPTIONAL.includes(arg[1] ?? '-') || (arg.length > 1 && [...arg.slice(1)].every((flag) => XARGS_FLAGS.includes(flag)))) i += 1
      else return undefined
    }
    return args.slice(Math.min(i, args.length))
  },
}

/** xargs's single-letter flags: those that take no value, those that take one attached or next, and those whose value can only be attached. */
const XARGS_FLAGS = '0prtxo'
const XARGS_VALUED = 'adEILnPs'
const XARGS_OPTIONAL = 'eil'
/** Its long flags that take a value, attached with `=` or next; the rest take none, or one attached with `=` only. */
const XARGS_LONG_VALUED = new Set(['--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-chars', '--process-slot-var'])
const XARGS_LONG_FLAGS = new Set(['--null', '--interactive', '--no-run-if-empty', '--verbose', '--exit', '--open-tty', '--eof', '--replace', '--max-lines'])

/** Wrappers that add arguments of their own, read from input, to the command they run. */
const FROM_INPUT = new Set(['xargs'])

/** How many wrappers deep to look; each one takes at least its own name, so this is a bound, not a rule. */
const DEPTH = 4

/** The command a segment really runs. */
export type RunCommand = {
  tokens: string[]
  /**
   * A wrapper hands it arguments the line does not show, so it may run with
   * any argument at all: `echo -delete | xargs find .` deletes.
   */
  argumentsFromInput: boolean
}

/**
 * The command a segment really runs, with any wrappers taken off. Empty tokens
 * mean nothing runs, which every caller already reads as harmless; a wrapper
 * that could not be read comes back untouched, so it is judged as itself.
 */
export function runCommand(tokens: string[]): RunCommand {
  let current = tokens
  let argumentsFromInput = false
  for (let depth = 0; depth < DEPTH; depth++) {
    const [raw, ...args] = current
    if (raw === undefined) break
    const unwrap = WRAPPERS[commandName(raw)]
    if (!unwrap) break
    const wrapped = unwrap(args)
    if (wrapped === undefined) break
    argumentsFromInput ||= FROM_INPUT.has(commandName(raw))
    current = wrapped
  }
  return { tokens: current, argumentsFromInput }
}

/** The words of the command a segment really runs; see `runCommand`. */
export const unwrapCommand = (tokens: string[]): string[] => runCommand(tokens).tokens
