import { effects, type Invocation, type Ruling } from '../effects'
import { parseArgs } from '../flags'
import { subcommandAt } from '../subcommand-tools'
import { reachesFromCwd, type CommandClassifier, type CommandSite } from './classifier'
import { attributes, copy, create, link, move, remove, tee } from './file-commands'
import { find, sed } from './find-and-sed'
import { git } from './git'
import { column, compareBytes, cut, date, diff, diskUsage, fileStatus, fileType, grep, headAndTail, hostname, jq, less, listing, numberLines, plainReaders, reverseConcatenate, ripgrep, silverSearcher, sort, touchesNothing, tree, uniq, wordCount, yq } from './inspecting'
import { awk, evaluators, node, perlAndRuby, python, shells } from './interpreters'
import { cargo, curl, dotnet, go, packageManagers, packageRunners, wget } from './toolchains'

/**
 * Every command the agent knows, by name. Adding a command is a classifier
 * and its entry here; a command not listed is judged as one whose effects only
 * the command itself names, which a kept answer for that command covers.
 */
const CLASSIFIERS: readonly CommandClassifier[] = [
  touchesNothing, plainReaders, reverseConcatenate, headAndTail, wordCount, cut, numberLines, column, compareBytes, fileStatus, grep, ripgrep, silverSearcher, listing, diskUsage, diff, tree, less, sort, uniq, jq, yq, fileType, date, hostname,
  find, sed,
  remove, create, attributes, copy, move, link, tee,
  perlAndRuby, awk, python, node, shells, evaluators,
  git, packageManagers, packageRunners, dotnet, cargo, go, curl, wget,
]

const BY_NAME: ReadonlyMap<string, CommandClassifier> = new Map(CLASSIFIERS.flatMap((c) => c.names.map((name) => [name, c] as const)))

/** Is there a classifier for this command? */
export const isKnownCommand = (name: string): boolean => BY_NAME.has(name.toLowerCase())

/** The one command run, with any wrapper already taken off. */
export type Classified = { invocation: Invocation; ruling: Ruling }

export function classifyCommand(name: string, args: readonly string[], site: CommandSite): Classified {
  const lower = name.toLowerCase()
  const classifier = BY_NAME.get(lower)
  const at = classifier?.subcommands ? subcommandIndex(lower, args) : undefined
  const subcommand = at === undefined ? undefined : args[at]
  const rest = at === undefined ? args : args.slice(at + 1)
  const parsed = parseArgs(rest, classifier?.flags?.(subcommand))
  const invocation: Invocation = { command: subcommand === undefined ? [lower] : [lower, subcommand], flags: new Set(parsed.flags.keys()), operands: parsed.operands }
  if (!classifier) return { invocation, ruling: effects(reachesFromCwd('command', site)) }
  const before = at === undefined ? [] : args.slice(0, at)
  return { invocation, ruling: classifier.classify({ name: lower, args: rest, parsed, ...(subcommand !== undefined ? { subcommand } : {}), before }, site) }
}

/** Where the subcommand sits: past the tool's own options where they are known, else the first word that is not a flag. */
function subcommandIndex(name: string, args: readonly string[]): number | undefined {
  const known = subcommandAt(name, [...args])
  if (known !== undefined) return known < args.length ? known : undefined
  return args.length > 0 && !args[0]!.startsWith('-') ? 0 : undefined
}
