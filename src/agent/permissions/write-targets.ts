import { commandName, runCommand } from './command-wrappers'
import type { ShellSegment } from './shell-split'
import { TRANSFER_TOOLS } from './tool-classes'

/**
 * Commands that only create, remove or touch files: every path they name is
 * one they write, judged by the one rule below.
 */
const WRITE_COMMANDS = new Set([
  'mkdir',
  'rmdir',
  'rd',
  'rm',
  'del',
  'erase',
  'touch',
  // PowerShell's item cmdlets. Their flags take paths too, so judging every operand as a path holds here.
  'new-item',
  'remove-item',
])

/**
 * Commands that copy or move: every path but the last is where they read
 * from, judged by the rules for a read, and the last is where they write,
 * judged by the rules for a write. PowerShell's item cmdlets take the same
 * two paths, named or not by `-Path` and `-Destination`.
 */
const TRANSFER_COMMANDS = new Set(['cp', 'copy', 'mv', 'move', 'ren', 'rename', 'copy-item', 'move-item', 'rename-item'])

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

/** The paths a copying or moving command reads from: every operand but the last, which it writes to instead. */
export function commandReadTargets(segment: ShellSegment): string[] {
  const { tokens } = runCommand(segment.tokens)
  const [raw, ...args] = tokens
  if (!raw || !TRANSFER_COMMANDS.has(commandName(raw).toLowerCase())) return []
  const operands = args.filter((arg) => arg !== '--' && !arg.startsWith('-'))
  return operands.slice(0, -1)
}

/** The same for one simple command of a shell call: what it writes through a redirect, and what it writes or copies to by its own words. */
export function commandWriteTargets(segment: ShellSegment): WriteTargets {
  if (segment.writes.some((target) => UNRESOLVABLE.test(target))) return []
  const targets = [...segment.writes]
  const { tokens, argumentsFromInput } = runCommand(segment.tokens)
  const [raw, ...args] = tokens
  if (raw) {
    const name = commandName(raw).toLowerCase()
    const transfer = TRANSFER_COMMANDS.has(name)
    if (transfer || WRITE_COMMANDS.has(name)) {
      // `xargs rm` removes whatever its input names.
      if (argumentsFromInput) return []
      const operands = args.filter((arg) => arg !== '--' && !arg.startsWith('-'))
      const written = transfer ? operands.slice(-1) : operands
      if (written.some((operand) => UNRESOLVABLE.test(operand))) return []
      targets.push(...written)
    }
  }
  return targets.length > 0 ? targets : undefined
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
