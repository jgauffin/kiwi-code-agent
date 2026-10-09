import type { Reach } from './places'

/**
 * What a call would do, as the permission rules judge it: an action at a
 * place. A call with no effects runs unasked; every effect a call has must be
 * covered for it to run without a prompt.
 */

/** A path the line names, normalized; or a word whose place it does not settle, kept as written. */
export type Place = { path: string } | { unknown: string }

export const known = (path: string): Place => ({ path })
export const unknownPlace = (word: string): Place => ({ unknown: word })
export const isKnown = (place: Place): place is { path: string } => 'path' in place

/** What a file effect does: reads, writes (creates, appends, edits), or destroys content nothing on the line brings back. */
export type FileAction = 'read' | 'write' | 'destroy'

/** What a call touches that no folder stands for. `command` is a command whose effects only the command itself names. */
export type Beyond = 'network' | 'remote' | 'history' | 'machine' | 'command'

export type Effect =
  /**
   * `extent` is how far below the place it reaches: a file, one directory's
   * entries, or the whole tree. `removes` marks a destroy that deletes what is
   * there rather than replacing or discarding it.
   */
  | { action: FileAction; place: Place; extent: Reach; removes?: true }
  /** Handed a program decided at the time it runs. Never kept as an allow. */
  | { action: 'runs'; reason: string }
  /** Touches something beyond files, from where it stands. */
  | { action: 'reaches'; what: Beyond; place: Place }
  /** A change of directory: asks nothing, but a directory kept as denied for reading refuses it. */
  | { action: 'enters'; place: Place }

/** A classifier's answer: the effects, or a refusal whose reason the model is told. */
export type Ruling = { kind: 'effects'; effects: Effect[] } | { kind: 'refused'; reason: string }

export const effects = (...list: Effect[]): Ruling => ({ kind: 'effects', effects: list })
export const refused = (reason: string): Ruling => ({ kind: 'refused', reason })

/**
 * A call in canonical form, which kept command answers match against: the
 * command and its subcommand, its flags under their long names whatever form
 * they were written in, and its operands.
 */
export type Invocation = { command: string[]; flags: ReadonlySet<string>; operands: string[] }

/** The reason a write the model authored is refused, naming what to use instead. */
export const USE_FILE_TOOLS = 'writes text the model wrote itself; use Edit or Write for a file, or RunScript to change many files at once, so the change is shown as a diff'
