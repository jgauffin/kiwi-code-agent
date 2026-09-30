import { commandName, runCommand } from './command-wrappers'
import type { ShellSegment } from './shell-split'
import { TRANSFER_TOOLS } from './tool-classes'

/**
 * Commands that only create, remove, move or copy files. A shell says with
 * these what a file tool says by being called, so both are read into the same
 * list of paths and judged by the one rule below.
 */
const WRITE_COMMANDS = new Set([
  'mkdir',
  'rmdir',
  'rd',
  'rm',
  'del',
  'erase',
  'touch',
  'cp',
  'copy',
  'mv',
  'move',
  'ren',
  'rename',
  // PowerShell's item cmdlets. Their flags take paths too, so judging every operand as a path holds here.
  'new-item',
  'remove-item',
  'copy-item',
  'move-item',
  'rename-item',
])

/**
 * A word whose target cannot be read here: an expansion or a home reference may
 * name anything, including somewhere outside the project. A glob needs no such
 * care, because resolving it against the project root bounds it to a prefix
 * that the path check already judges.
 */
const UNRESOLVABLE = /[$~`]/

/**
 * The paths a call would change, or undefined when it changes nothing or
 * nothing that can be named here. An empty list is not the same as undefined:
 * it means the call writes something we failed to read, which no switch covers.
 */
export type WriteTargets = string[] | undefined

/**
 * Where a session may write without a prompt: the project while "Allow writes"
 * is on, its scratch folder otherwise. A shell's paths are read from the project
 * root, so a `cd` counts only while it stays where the writes are allowed.
 */
export type WritableArea = {
  /** What the prompt says let a line through. */
  passes: string
  canEnter(path: string): boolean
  canWrite(path: string): boolean
}

/** What a file tool's input says it will write. A move or copy writes both its ends. */
export function toolWriteTargets(toolName: string, input: unknown): WriteTargets {
  const named = (input ?? {}) as Record<string, unknown>
  if (TRANSFER_TOOLS.has(toolName)) return paths([named['source'], named['destination']])
  switch (toolName) {
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return paths([named['file_path']])
    case 'NotebookEdit':
      return paths([named['notebook_path']])
    // A script's staged changes name every file they would write; the script itself names none, and writes nothing until they are judged.
    case 'RunScript':
      return Array.isArray(named['files']) ? paths(named['files']) : undefined
    default:
      return undefined
  }
}

/** The same for one simple command of a shell call. */
export function commandWriteTargets(segment: ShellSegment): WriteTargets {
  // The redirect target is a second write this segment's words do not name.
  if (segment.writesFile) return undefined
  const { tokens, argumentsFromInput } = runCommand(segment.tokens)
  const [raw, ...args] = tokens
  if (!raw) return undefined
  if (!WRITE_COMMANDS.has(commandName(raw).toLowerCase())) return undefined
  // `xargs rm` removes whatever its input names.
  if (argumentsFromInput) return []
  const operands = args.filter((arg) => arg !== '--' && !arg.startsWith('-'))
  return operands.some((operand) => UNRESOLVABLE.test(operand)) ? [] : operands
}

/**
 * The rule a writable area stands on, for a file tool and for a shell command
 * alike: every path the call changes lies in the area. A call whose paths could
 * not be read is covered by nothing and is asked about.
 */
export function writesWithin(targets: WriteTargets, area: WritableArea): boolean {
  return targets !== undefined && targets.length > 0 && targets.every((path) => area.canWrite(path))
}

function paths(raw: unknown[]): string[] {
  const named = raw.filter((value): value is string => typeof value === 'string')
  return named.length === raw.length ? named : []
}
