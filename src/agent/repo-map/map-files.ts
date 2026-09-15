import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Where the generated map lives and how it is put on disk. Everything under
 * `.agent/repo-map/` is build output: a build replaces the whole set, so an
 * edit a session makes there is not refused, it is lost at the next build.
 *
 * Writing goes through a staging directory and per-file renames, so a reader
 * opening an index while a build runs sees the previous file whole or the new
 * one whole, never half of either.
 */

/** Workspace-relative root of the map; the form paths take in the injected summary. */
export const MAP_ROOT = '.agent/repo-map'

/** The small part handed to a session at its start. */
export const SUMMARY_FILE = 'summary.md'

/** Per-project type indexes; one file each, named after the project. */
export const INDEX_DIR = 'types'

/** One generated file: a path relative to the map root, and the whole of its content. */
export type MapFile = { path: string; text: string }

export const mapRoot = (cwd: string): string => join(cwd, ...MAP_ROOT.split('/'))

/** Workspace-relative path of a file in the map, as the summary names it. */
export const mapPath = (path: string): string => `${MAP_ROOT}/${path}`

export const summaryPath = (cwd: string): string => join(mapRoot(cwd), SUMMARY_FILE)

/**
 * The bytes a file is stored as: `\n` endings and exactly one trailing newline,
 * so the same content renders the same on any host.
 */
export const mapText = (text: string): string => `${text.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`

/** Code-unit order, not the host's locale: the same input has to sort the same on every machine. */
export const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Sorted by path, so the set written never depends on the order it was produced in. */
export const sortFiles = (files: MapFile[]): MapFile[] => [...files].sort((a, b) => byPath(a.path, b.path))

/**
 * Replaces the map wholesale: every file given is written, every file that was
 * there and is not given is removed. Files land by rename out of a staging
 * directory, one at a time, each replacing its predecessor in a single step.
 */
export async function writeMap(cwd: string, files: MapFile[]): Promise<void> {
  const root = mapRoot(cwd)
  await mkdir(root, { recursive: true })
  const staging = await mkdtemp(`${root}.tmp-`)
  try {
    const written = sortFiles(files)
    for (const file of written) {
      const target = join(staging, ...file.path.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, mapText(file.text), 'utf8')
    }
    for (const file of written) {
      const target = join(root, ...file.path.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await replace(join(staging, ...file.path.split('/')), target)
    }
    await prune(root, new Set(written.map((f) => f.path)))
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Puts the staged file in place in one step. Windows refuses the rename while a
 * reader holds the old file open, which is a moment, not a failure: the build
 * waits it out rather than falling back to a partial in-place write.
 */
async function replace(from: string, to: string, attempts = 50): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt >= attempts || !BUSY.has(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

/** Reads one file of the map by its path relative to the root; undefined when the build has not produced it. */
export async function readMapFile(cwd: string, path: string): Promise<string | undefined> {
  try {
    return await readFile(join(mapRoot(cwd), ...path.split('/')), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Every file under the map root, workspace-relative to it, sorted. */
export async function listMap(root: string, prefix = ''): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const paths: string[] = []
  for (const entry of entries) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) paths.push(...(await listMap(join(root, entry.name), path)))
    else paths.push(path)
  }
  return paths.sort(byPath)
}

/** Leftovers of an earlier build: files the new one did not produce, and the directories they emptied. */
async function prune(root: string, keep: Set<string>): Promise<void> {
  for (const path of await listMap(root)) {
    if (!keep.has(path)) await rm(join(root, ...path.split('/')), { force: true })
  }
  await removeEmptyDirs(root)
}

async function removeEmptyDirs(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const child = join(dir, entry.name)
    await removeEmptyDirs(child)
    if ((await readdir(child)).length === 0) await rm(child, { recursive: true, force: true })
  }
}

const inFlight = new Map<string, Promise<unknown>>()

/**
 * One build per workspace at a time: a second caller asking while a build runs
 * — another session start, or the command during one — waits on that build and
 * takes its result rather than starting a second.
 */
export function sharedBuild<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key)
  if (running !== undefined) return running as Promise<T>
  const started = run().finally(() => {
    if (inFlight.get(key) === started) inFlight.delete(key)
  })
  inFlight.set(key, started)
  return started
}
