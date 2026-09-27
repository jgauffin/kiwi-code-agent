import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, matchesGlob, relative, resolve } from 'node:path'
import { IGNORED_DIRS } from '../openai-session/tools/glob'
import { byPath } from '../repo-map/map-files'
import { loadGitignore, type IgnorePredicate } from '../repo-map/workspace-scan'

/**
 * The files a folder or glob outline reads. The skips are the duplication
 * scanner's: the search tools' ignored folders and the workspace `.gitignore`,
 * build output, minified and generated files, text that is not code, and any
 * folder that is a repository of its own, which is named rather than dropped.
 */

export type SourceFiles = {
  /** Workspace-relative, `/` separators, sorted. */
  files: string[]
  /** Folders holding their own `.git`: a submodule or a vendored clone, another project's code. */
  nestedRepositories: string[]
}

const SKIPPED_DIRS = new Set(['build', 'coverage'])

/** Documentation, data and markup: a code sample in them is not code. */
const NOT_CODE = new Set([
  '.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm',
  '.css', '.scss', '.less', '.svg', '.csv', '.lock', '.log', '.map', '.snap',
])

/** A file past this size is data or generated, not source. */
const MAX_FILE_BYTES = 1_000_000

const GLOB_CHARS = /[*?[{]/

export const isGlob = (target: string): boolean => GLOB_CHARS.test(target)

/** The files under `target`, a folder or a glob, relative to `cwd`. */
export async function findSources(cwd: string, target: string): Promise<SourceFiles> {
  const pattern = isGlob(target) ? target.replace(/\\/g, '/').replace(/^\.\//, '') : undefined
  const base = pattern ? staticBase(pattern) : target
  const found: SourceFiles = { files: [], nestedRepositories: [] }
  const walker = { cwd, ignored: await loadGitignore(cwd), pattern, found }
  await walk(walker, resolve(cwd, base), true)
  found.files.sort(byPath)
  found.nestedRepositories.sort(byPath)
  return found
}

type Walker = { cwd: string; ignored: IgnorePredicate; pattern: string | undefined; found: SourceFiles }

async function walk(walker: Walker, dir: string, top: boolean): Promise<void> {
  const rel = relativePath(walker.cwd, dir)
  if (!top && existsSync(join(dir, '.git'))) {
    walker.found.nestedRepositories.push(rel)
    return
  }
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = join(dir, entry.name)
    const path = relativePath(walker.cwd, full)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || SKIPPED_DIRS.has(entry.name) || walker.ignored(path, true)) continue
      await walk(walker, full, false)
    } else if (entry.isFile() && isCandidate(entry.name) && !walker.ignored(path, false)) {
      if (!walker.pattern || matchesGlob(path, walker.pattern)) walker.found.files.push(path)
    }
  }
}

function isCandidate(name: string): boolean {
  const ext = extname(name).toLowerCase()
  if (name.startsWith('.') || ext === '' || NOT_CODE.has(ext)) return false
  return !/\.(?:min|generated)\./i.test(name)
}

/** The folder a glob starts from: its segments before the first wildcard. */
function staticBase(pattern: string): string {
  const segments = pattern.split('/')
  const first = segments.findIndex((s) => GLOB_CHARS.test(s))
  return segments.slice(0, first).join('/') || '.'
}

const relativePath = (cwd: string, full: string): string => relative(cwd, full).split('\\').join('/') || '.'

/** A file's text, or undefined when it is too large or binary to be source. */
export async function readSource(full: string): Promise<string | undefined> {
  const info = await stat(full).catch(() => undefined)
  if (!info?.isFile() || info.size > MAX_FILE_BYTES) return undefined
  const text = await readFile(full, 'utf8')
  return text.includes('\u0000') ? undefined : text
}
