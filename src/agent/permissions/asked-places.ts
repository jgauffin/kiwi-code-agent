import { resolve } from 'node:path'
import { commandName, runCommand } from './command-wrappers'
import { directoryAsked, operandIsDirectory, wildcardFree } from './directory-places'
import { fileOperands, isReadOnlySegment, type ReadOnlyContext } from './read-only-commands'
import type { ShellSegment } from './shell-split'
import { commandReadTargets, commandWriteTargets, type WritableArea } from './write-targets'

/**
 * A place a shell command needs a grant for: reading in a directory or writing
 * to it. The directory is absent when the path depends on a variable, on another
 * command's output or on a `cd` that may not have run, which leaves the answer
 * to this call alone. `keep` is the directory and each one above it that the
 * answer may be kept for; empty where none may be, such as the home folder.
 */
export type AskedPlace = { kind: 'reads' | 'writes'; directory?: string; keep: string[] }

/** A word still holding an expansion or a home reference names no place. */
const UNCERTAIN = /[$`~]/

/**
 * What a command reads or writes outside the project, as the places a grant
 * is needed for. Undefined when the command asks for no place: it stays in the
 * project, or what stops it running unasked is something a place cannot grant
 * (a write the Allow writes switch decides, a command that does more than
 * look), which is left to a rule for the command as before.
 */
export function askedPlaces(segment: ShellSegment, context: ReadOnlyContext, covers: WritableArea | undefined): AskedPlace[] | undefined {
  const { insideProject, canRead, placesToKeep, where, home } = context
  if (!insideProject || !canRead || !placesToKeep || !where) return undefined
  const [raw, ...args] = runCommand(segment.tokens).tokens
  const command = raw ? commandName(raw) : ''
  const directories = operandIsDirectory(command, args)

  const reads = new Set<string>()
  const writes = new Set<string>()
  const writtenFiles = new Map<string, string | undefined>()
  let uncertainRead = false
  let uncertainWrite = false
  const note = (into: Set<string>, abs: string, isDirectory: boolean): boolean => {
    const asked = directoryAsked(abs, isDirectory)
    if (asked === undefined) return false
    const directory = resolve(asked).split('\\').join('/')
    into.add(directory)
    if (into === writes) {
      // The file itself is a place to keep a write for, while it is the only one written in that directory.
      const file = !isDirectory && wildcardFree(abs) === abs ? resolve(abs).split('\\').join('/') : undefined
      writtenFiles.set(directory, writtenFiles.has(directory) && writtenFiles.get(directory) !== file ? undefined : file)
    }
    return true
  }

  const written = commandWriteTargets(segment)
  if (written?.length === 0) uncertainWrite = true
  for (const path of written ?? []) {
    const abs = where(path)
    if (abs === undefined) uncertainWrite = true
    else if (insideProject(abs)) {
      if (!(covers?.canWrite(abs) ?? false)) return undefined
    } else if (!note(writes, abs, directories && !segment.writes.includes(path))) uncertainWrite = true
  }

  const named = [...segment.reads, ...fileOperands(command, args), ...commandReadTargets(segment)]
  for (const word of named) {
    const path = withHome(word, home)
    if (UNCERTAIN.test(path)) {
      uncertainRead = true
      continue
    }
    if (canRead(path)) continue
    const abs = where(path)
    if (abs === undefined || !note(reads, abs, directories && !segment.reads.includes(word))) uncertainRead = true
  }

  if (reads.size + writes.size === 0 && !uncertainRead && !uncertainWrite) return undefined
  // Reading alone is a place to grant only for a command that merely looks once it may read there.
  if (writes.size === 0 && !uncertainWrite && !isReadOnlySegment(segment, { ...context, canRead: () => true })) return undefined

  const places: AskedPlace[] = []
  // A directory the call reads and writes is asked about as a write.
  for (const directory of reads) if (!writes.has(directory)) places.push({ kind: 'reads', directory, keep: placesToKeep(directory) })
  for (const directory of writes) {
    const file = writtenFiles.get(directory)
    places.push({ kind: 'writes', directory, keep: file === undefined ? placesToKeep(directory) : [file, ...placesToKeep(directory)] })
  }
  if (uncertainRead) places.push({ kind: 'reads', keep: [] })
  if (uncertainWrite) places.push({ kind: 'writes', keep: [] })
  return places
}

/** A leading `~` is the home folder it stands for. */
export function withHome(path: string, home: string | undefined): string {
  if (home === undefined || !/^~(\/|$)/.test(path)) return path
  return `${home.split('\\').join('/')}${path.slice(1)}`
}
