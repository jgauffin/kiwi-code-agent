import { dirname, isAbsolute, relative, resolve } from 'node:path'

/**
 * The part of a path a wildcard cannot move: the directories above its first
 * wildcard, with a trailing slash so `C:/*` keeps its drive root. Undefined
 * when the very first part is a wildcard, which leaves nothing named.
 */
export function wildcardFree(path: string): string | undefined {
  const parts = path.split(/[\\/]/)
  const at = parts.findIndex((part) => /[*?[]/.test(part))
  if (at === -1) return path
  return at === 0 ? undefined : `${parts.slice(0, at).join('/')}/`
}

/**
 * The directories an answer about entering `directory` may be kept for: the
 * directory itself first, then each one above it. The root of a drive is
 * never one, nor is the home folder or any directory holding it, since
 * granting either grants every file the person keeps there.
 */
export function placesToKeep(directory: string, home: string | undefined): string[] {
  const places: string[] = []
  for (let at = resolve(directory); dirname(at) !== at; at = dirname(at)) {
    if (home !== undefined && holds(at, home)) break
    places.push(at.split('\\').join('/'))
  }
  return places
}

/**
 * Commands whose path operand is a directory itself, so the place they reach
 * is that directory; any other command's operand is a file, and the place is
 * the directory holding it.
 */
const DIRECTORY_COMMANDS = new Set(['ls', 'dir', 'du', 'df', 'find', 'tree', 'mkdir', 'rmdir', 'rd', 'git', 'cd'])

/** A search that walks into the directories it is given rather than reading one file. */
const SEARCHES = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag'])

/** Does this command's path operand stand for a directory rather than a file? */
export function operandIsDirectory(command: string, args: string[]): boolean {
  if (DIRECTORY_COMMANDS.has(command)) return true
  return SEARCHES.has(command) && args.some((a) => a === '--recursive' || a === '-R' || /^-[a-zA-Z]*r[a-zA-Z]*$/.test(a))
}

/**
 * The directory a path asks about: the directories above its first wildcard,
 * else the path itself when it is a directory and the directory holding it
 * when it is a file. Undefined when a wildcard leaves nothing named.
 */
export function directoryAsked(path: string, isDirectory: boolean): string | undefined {
  const free = wildcardFree(path)
  if (free === undefined) return undefined
  if (free !== path) {
    const trimmed = free.replace(/\/+$/, '')
    return trimmed === '' || /^[A-Za-z]:$/.test(trimmed) ? free : trimmed
  }
  return isDirectory ? path : dirname(path).split('\\').join('/')
}

function holds(directory: string, path: string): boolean {
  const rel = relative(directory, path)
  return !rel.startsWith('..') && !isAbsolute(rel)
}
