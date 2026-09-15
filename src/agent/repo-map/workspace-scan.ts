import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { IGNORED_DIRS } from '../openai-session/tools/glob'
import { MAP_ROOT, byPath } from './map-files'

/**
 * One walk of the workspace that every part of the build works from: the source
 * and project files, and the newest mtime among them, which is what the
 * staleness check compares the map against.
 *
 * Where we do not look is the agent's own notion of it — the directories its
 * search tools skip — plus its generated folder and, when the workspace has
 * one, what `.gitignore` names.
 */

/** The agent's generated root; its own output is not workspace source. */
export const AGENT_DIR = MAP_ROOT.split('/')[0]!

/** Languages the type index understands; the map has nothing to say about other files. */
export const SOURCE_EXTENSIONS = ['.cs', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/** What marks a project: a solution, an MSBuild project, or a package manifest. */
export const PROJECT_EXTENSIONS = ['.sln', '.slnx', '.csproj', '.fsproj', '.vbproj']
export const PROJECT_FILENAMES = ['package.json']

export type ScannedFile = {
  /** Workspace-relative, `/` separators, the form every later stage uses. */
  path: string
  mtimeMs: number
}

export type WorkspaceScan = {
  /** Source and project files, sorted by path so nothing downstream inherits enumeration order. */
  files: ScannedFile[]
  /** Newest mtime over the same set; 0 when the walk found nothing. */
  newest: number
}

const lower = (path: string): string => path.toLowerCase()

export const isSourceFile = (path: string): boolean => SOURCE_EXTENSIONS.some((ext) => lower(path).endsWith(ext))

export const isProjectFile = (path: string): boolean =>
  PROJECT_EXTENSIONS.some((ext) => lower(path).endsWith(ext)) ||
  PROJECT_FILENAMES.some((name) => lower(path) === name || lower(path).endsWith(`/${name}`))

/** Walks the workspace once, returning the files the map is built from and the newest mtime among them. */
export async function scanWorkspace(cwd: string): Promise<WorkspaceScan> {
  const ignored = await loadGitignore(cwd)
  const files: ScannedFile[] = []
  await walk(cwd, '', ignored, files)
  files.sort((a, b) => byPath(a.path, b.path))
  return { files, newest: files.reduce((newest, file) => Math.max(newest, file.mtimeMs), 0) }
}

/** The newest source or project file in the workspace, what a stale map is measured against. */
export const newestSource = async (cwd: string): Promise<number> => (await scanWorkspace(cwd)).newest

async function walk(cwd: string, prefix: string, ignored: IgnorePredicate, into: ScannedFile[]): Promise<void> {
  const entries = await readdir(join(cwd, ...prefix.split('/').filter((s) => s.length > 0)), { withFileTypes: true }).catch(() => [])
  for (const entry of entries.sort((a, b) => byPath(a.name, b.name))) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      if (skipDir(entry.name) || ignored(path, true)) continue
      await walk(cwd, path, ignored, into)
    } else if (entry.isFile()) {
      if (!isSourceFile(path) && !isProjectFile(path)) continue
      if (ignored(path, false)) continue
      const info = await stat(join(cwd, ...path.split('/'))).catch(() => undefined)
      if (info) into.push({ path, mtimeMs: info.mtimeMs })
    }
  }
}

const skipDir = (name: string): boolean => IGNORED_DIRS.has(name) || name === AGENT_DIR

export type IgnorePredicate = (path: string, isDir: boolean) => boolean

/** Nothing is ignored beyond the built-in list: what a workspace without a readable `.gitignore` gets. */
export const ignoreNothing: IgnorePredicate = () => false

/**
 * Reads the workspace's root `.gitignore`. A workspace without one, or with one
 * that cannot be read, falls back to the built-in list of skipped locations
 * alone rather than failing the walk.
 */
export async function loadGitignore(cwd: string): Promise<IgnorePredicate> {
  try {
    return parseGitignore(await readFile(join(cwd, '.gitignore'), 'utf8'))
  } catch {
    return ignoreNothing
  }
}

type Rule = { regex: RegExp; negated: boolean; dirOnly: boolean }

/**
 * The subset of gitignore syntax a repository's root file actually uses:
 * comments, blank lines, `!` negation, a trailing `/` for directories, a
 * leading or embedded `/` for a rooted pattern, and `*`, `?` and `**`.
 * The last rule that matches decides, as git does it.
 */
export function parseGitignore(text: string): IgnorePredicate {
  const rules: Rule[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (line === '' || line.startsWith('#')) continue
    const negated = line.startsWith('!')
    let pattern = negated ? line.slice(1) : line
    const dirOnly = pattern.endsWith('/')
    if (dirOnly) pattern = pattern.slice(0, -1)
    if (pattern === '') continue
    const rooted = pattern.includes('/') && !pattern.startsWith('**/')
    if (pattern.startsWith('/')) pattern = pattern.slice(1)
    rules.push({ regex: toRegex(pattern, rooted), negated, dirOnly })
  }
  if (rules.length === 0) return ignoreNothing
  return (path, isDir) => {
    let ignored = false
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue
      if (!rule.regex.test(path)) continue
      ignored = !rule.negated
    }
    return ignored
  }
}

/** A rooted pattern matches from the workspace root; a bare one matches at any depth. Either way it also covers what is under a match. */
function toRegex(pattern: string, rooted: boolean): RegExp {
  const body = pattern
    .split('/')
    .map((segment) =>
      segment === '**'
        ? '\u0000'
        : segment
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]'),
    )
    .join('/')
    .replace(/\u0000\//g, '(?:.*/)?')
    .replace(/\/\u0000/g, '(?:/.*)?')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${rooted ? '' : '(?:.*/)?'}${body}(?:/.*)?$`)
}
