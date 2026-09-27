import { commandName, unwrapCommand } from './command-wrappers'
import type { ShellSegment } from './shell-split'

/**
 * Commands the project itself defines, which run without a prompt: a script in
 * the root `package.json`, and the test commands `kiwiAgent.verify` names. The
 * user wrote both, and the extension already runs the verify commands itself
 * when a board is all tested, so asking whether a session may run the same
 * command adds nothing. A deny rule still wins, because it is answered first.
 * Pure, so the webview can say what let a command through.
 */
export type ProjectCommands = {
  /** The script names of the workspace root's `package.json`. */
  scripts: ReadonlySet<string>
  /** The `command` of each verify rule, placeholders and all. */
  verify: readonly string[]
}

export const NO_PROJECT_COMMANDS: ProjectCommands = { scripts: new Set(), verify: [] }

/** Package managers that run a project's scripts. */
const RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])

/** Script names npm runs without `run`; every other manager runs any script that way. */
const ALIASES = new Set(['test', 'start', 'stop', 'restart'])

/** Flags that send the command to another package, whose scripts are not the ones we read. */
const ELSEWHERE = /^(--prefix|-C|--dir|--cwd|-w|--workspace|--workspaces|-F|--filter)(=|$)/

/**
 * What lets this segment through without a prompt, worded for the permission
 * prompt; nothing when the segment has to be asked about.
 */
export function projectCommandOf(segment: ShellSegment, project: ProjectCommands): string | undefined {
  // A redirect writes a file the command itself never names, whatever it runs.
  if (segment.writesFile) return undefined
  const tokens = unwrapCommand(segment.tokens)
  if (scriptOf(tokens, project.scripts)) return 'package.json script'
  if (project.verify.some((template) => runsTemplate(tokens, template))) return 'kiwiAgent.verify command'
  return undefined
}

/** The script a package-manager command runs, when the project defines one by that name. */
export function scriptOf(tokens: string[], scripts: ReadonlySet<string>): string | undefined {
  const [raw, ...rest] = tokens
  if (!raw || !RUNNERS.has(commandName(raw))) return undefined
  if (rest.some((arg) => ELSEWHERE.test(arg))) return undefined
  // `npm --silent run build`: the manager's own flags come before the script.
  let args = rest
  while (args[0]?.startsWith('-')) args = args.slice(1)
  const [first, second] = args
  if (first === undefined) return undefined
  const name = first === 'run' || first === 'run-script' ? second : ALIASES.has(first) || commandName(raw) !== 'npm' ? first : undefined
  return name !== undefined && scripts.has(name) ? name : undefined
}

/**
 * Does the segment run the command this verify rule names? Judged on the
 * template's leading words, up to its first placeholder or flag: the arguments
 * are what narrows a run to one test, and narrowing it changes nothing about
 * whose command it is.
 */
function runsTemplate(tokens: string[], template: string): boolean {
  const prefix = templatePrefix(template)
  if (prefix.length === 0 || tokens.length < prefix.length) return false
  return prefix.every((word, i) => (i === 0 ? commandName(word) === commandName(tokens[i]!) : word === tokens[i]))
}

/** The words of a verify command that every run of it shares. */
export function templatePrefix(template: string): string[] {
  const words: string[] = []
  for (const word of template.trim().split(/\s+/)) {
    if (word === '' || word.startsWith('-') || word.includes('{')) break
    words.push(word.replace(/^["']|["']$/g, ''))
  }
  return words
}
