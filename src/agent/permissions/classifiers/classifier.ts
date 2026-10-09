import type { Effect, FileAction, Place, Ruling } from '../effects'
import { unknownPlace } from '../effects'
import type { FlagSpec, ParsedArgs } from '../flags'
import { wildcardBase, type Reach } from '../places'

/**
 * One command's reading of its own arguments into effects. A classifier
 * reports what the call would do and where; it never sees a kept answer, so a
 * classifier cannot open a way around one. It may refuse outright when the
 * arguments alone settle it, as a write the model authored does.
 */
export interface CommandClassifier {
  /** Every name this command answers to, lower case: `grep`, `egrep`, `fgrep`. */
  readonly names: readonly string[]
  /** Its first operand is a subcommand that decides what it does, which a kept answer names beside the command. */
  readonly subcommands?: boolean
  /** How its flags read, for the subcommand when it has one. */
  flags?(subcommand: string | undefined): FlagSpec
  classify(call: CommandCall, site: CommandSite): Ruling
}

/** The command as the classifier is handed it: its arguments, read by its own flag spec. */
export type CommandCall = {
  name: string
  /** The words after the command, or after the subcommand when it has one. */
  args: readonly string[]
  parsed: ParsedArgs
  subcommand?: string
  /** The tool's own words before the subcommand: `-C dir` in `git -C dir status`. */
  before: readonly string[]
}

/** Facts about where a command runs; never a rule. */
export type CommandSite = {
  /** Where the shell stands. */
  cwd: Place
  /** A word as the place it names, read from where the shell stands. */
  place(word: string): Place
  /** What is at a path now. */
  exists(path: string): 'file' | 'directory' | undefined
}

/**
 * A file effect at what a word names. A wildcard reaches the directory above
 * it, or the tree when it goes deeper; a wildcard with nothing above it, or a
 * word the line does not settle, is an unknown place.
 */
export function fileEffect(action: FileAction, site: CommandSite, word: string, extent: Reach): Effect {
  const base = wildcardBase(word)
  if (base === undefined) return { action, place: unknownPlace(word), extent: 'tree' }
  return { action, place: site.place(base.base), extent: base.extent ?? extent }
}

export const fileEffects = (action: FileAction, site: CommandSite, words: readonly string[], extent: Reach): Effect[] =>
  words.map((word) => fileEffect(action, site, word, extent))

/** Where the shell stands, as a file effect: what a command naming no path reads or writes. */
export const atCwd = (action: FileAction, site: CommandSite, extent: Reach): Effect => ({ action, place: site.cwd, extent })

/** Reaching beyond files from where the shell stands. */
export const reachesFromCwd = (what: Extract<Effect, { action: 'reaches' }>['what'], site: CommandSite): Effect => ({ action: 'reaches', what, place: site.cwd })

/** Writing to an existing file replaces what it held: a destroy. A new file, or a directory receiving one, is a write. */
export function writeOrDestroy(site: CommandSite, word: string): Effect {
  const effect = fileEffect('write', site, word, 'file')
  if (effect.action !== 'write' || !('path' in effect.place) || effect.extent !== 'file') return effect
  return site.exists(effect.place.path) === 'file' ? { ...effect, action: 'destroy' } : effect
}
