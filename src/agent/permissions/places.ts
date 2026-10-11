/**
 * Paths as the permission rules compare them: absolute, forward slashes, a
 * drive letter in upper case, no trailing slash, `.` and `..` resolved. Pure
 * string work with no Node import, so the webview words a kept answer with the
 * same paths the extension decides by.
 */

/** How far below a place a kept answer, or an effect, reaches. */
export type Reach = 'file' | 'directory' | 'tree'

/** `C:\x`, `c:/x` and, on Windows, Git Bash's `/c/x` are one place. */
export function normalizePlace(path: string): string {
  let p = path.split('\\').join('/')
  const bashDrive = caseless() ? /^\/([a-zA-Z])(\/|$)/.exec(p) : null
  if (bashDrive) p = `${bashDrive[1]}:/${p.slice(3)}`
  const drive = /^([a-zA-Z]):/.exec(p)
  const root = drive ? `${drive[1]!.toUpperCase()}:/` : p.startsWith('/') ? '/' : ''
  const rest = drive ? p.slice(2) : p
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return root + parts.join('/') || root
}

export function isAbsolutePlace(path: string): boolean {
  return /^([\\/]|[A-Za-z]:)/.test(path)
}

/** `path` read from `base` when it is relative; `~` is the home folder. */
export function resolvePlace(base: string, path: string, home?: string): string {
  if (home !== undefined && /^~([\\/]|$)/.test(path)) return normalizePlace(`${home}/${path.slice(1)}`)
  return normalizePlace(isAbsolutePlace(path) ? path : `${base}/${path}`)
}

/** Windows paths compare without case; everywhere else case counts. */
const caseless = (): boolean => typeof process !== 'undefined' && process.platform === 'win32'

function same(a: string, b: string): boolean {
  return caseless() ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Is `path` the directory itself or anywhere below it? Both normalized. */
export function isWithin(directory: string, path: string): boolean {
  if (same(directory, path)) return true
  const prefix = directory.endsWith('/') ? directory : `${directory}/`
  return path.length > prefix.length && same(path.slice(0, prefix.length), prefix)
}

/** The directory holding a path; the root holds itself. */
export function parentPlace(path: string): string {
  const at = path.lastIndexOf('/')
  if (at < 0) return path
  const parent = path.slice(0, at)
  return parent === '' ? '/' : /^[A-Z]:$/.test(parent) ? `${parent}/` : parent
}

/**
 * Does a kept answer at `place` reaching `reach` cover what an effect does at
 * `target` reaching `extent`? A tree covers everything below it; a directory
 * covers itself and the files directly in it; a file covers itself.
 */
export function covers(place: string, reach: Reach, target: string, extent: Reach): boolean {
  if (reach === 'tree') return isWithin(place, target)
  if (reach === 'directory') return (extent !== 'tree' && same(place, target)) || (extent === 'file' && same(place, parentPlace(target)))
  return extent === 'file' && same(place, target)
}

/** A word whose place the line does not settle: an expansion, a substitution, or `~user`. */
export function isUnsettled(word: string): boolean {
  return /[$`]/.test(word) || /^~[^/\\]/.test(word)
}

/**
 * The part of a path a wildcard cannot move, and how far the wildcard reaches
 * below it: `src/*.ts` is the directory `src`, `src/**` and `src/a*\/b` the
 * tree below it. A path without a wildcard is returned as it is.
 */
export function wildcardBase(path: string): { base: string; extent?: Reach } | undefined {
  const parts = path.split(/[\\/]/)
  // A brace is a wildcard too: `{a,/etc}` names `/etc`, so no part from the first brace on is a folder the path stands in.
  const at = parts.findIndex((part) => /[*?[{]/.test(part))
  if (at === -1) return { base: path }
  if (at === 0) return undefined
  const base = parts.slice(0, at).join('/') || '/'
  const extent: Reach = at === parts.length - 1 && !parts[at]!.includes('**') ? 'directory' : 'tree'
  return { base, extent }
}

/**
 * A glob's brace alternatives, each a pattern of its own: `{a,b}/x` is `a/x`
 * and `b/x`, nested braces included. Undefined when there are more than
 * `limit`, or a brace is left open, so the caller falls back to what lies above
 * the first brace rather than judge part of what the glob reaches.
 */
export function expandBraces(pattern: string, limit = 32): string[] | undefined {
  const open = pattern.indexOf('{')
  if (open === -1) return [pattern]
  let depth = 0
  const commas: number[] = []
  let close = -1
  for (let i = open; i < pattern.length && close === -1; i++) {
    const c = pattern[i]
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) close = i
    else if (c === ',' && depth === 1) commas.push(i)
  }
  if (close === -1) return undefined
  const head = pattern.slice(0, open)
  const tail = pattern.slice(close + 1)
  // A brace with no comma offers no choice; left as written, it reaches from above the brace, which is wider and so safe.
  if (commas.length === 0) return [pattern]
  const bounds = [open, ...commas, close]
  const out: string[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const expanded = expandBraces(head + pattern.slice(bounds[i]! + 1, bounds[i + 1]) + tail, limit)
    if (expanded === undefined) return undefined
    out.push(...expanded)
    if (out.length > limit) return undefined
  }
  return out
}
