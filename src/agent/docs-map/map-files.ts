import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Where the docs map lives and how it is put on disk. Everything under
 * `.agent/docs-map/` is build output: it describes the docs, it never holds
 * anything the docs do not already say, so a lost file costs a re-read and
 * nothing else.
 *
 * Unlike the repo map the set is not replaced wholesale. One entry per doc is
 * written by the run, and only for the docs that changed, so the entries of
 * every other doc have to survive a build untouched.
 */

/** Workspace-relative root of the map; the form paths take wherever the map is named. */
export const DOCS_MAP_ROOT = '.agent/docs-map'

/** One entry per doc, under the doc's own path so two docs can never collide. */
export const ENTRY_DIR = 'entries'

/** The part handed to a session at its start, composed by the extension from the entries. */
export const SUMMARY_FILE = 'summary.md'

/** Path to content hash, the extension's own: what lets a build re-read only the docs that changed. */
export const INDEX_FILE = 'index.json'

export const docsMapRoot = (cwd: string): string => join(cwd, ...DOCS_MAP_ROOT.split('/'))

/** A doc's entry, as a path relative to the map root. */
export const entryPath = (doc: string): string => `${ENTRY_DIR}/${doc}`

/** A doc's entry, workspace-relative: what the run is told to write. */
export const entryFile = (doc: string): string => `${DOCS_MAP_ROOT}/${entryPath(doc)}`

export const summaryFile = (cwd: string): string => join(docsMapRoot(cwd), SUMMARY_FILE)
export const indexFile = (cwd: string): string => join(docsMapRoot(cwd), INDEX_FILE)

/** Code-unit order, not the host's locale: the same docs have to sort the same on every machine. */
export const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The bytes a generated file is stored as: `\n` endings and exactly one
 * trailing newline, so the same content renders the same on any host.
 */
export const mapText = (text: string): string => `${text.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`

/** Reads one file of the map by its path relative to the root; undefined when no build has produced it. */
export async function readMapFile(cwd: string, path: string): Promise<string | undefined> {
  try {
    return await readFile(join(docsMapRoot(cwd), ...path.split('/')), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Lands the file in one step, so a session start reading the summary while a
 * build finishes sees the previous file whole or the new one whole.
 */
export async function writeMapFile(cwd: string, path: string, text: string): Promise<void> {
  const target = join(docsMapRoot(cwd), ...path.split('/'))
  await mkdir(dirname(target), { recursive: true })
  const staged = `${target}.tmp`
  await writeFile(staged, mapText(text), 'utf8')
  await replace(staged, target)
}

/** The docs the map has an entry for, whatever the index says, sorted by path. */
export async function listEntries(cwd: string): Promise<string[]> {
  return (await walk(join(docsMapRoot(cwd), ENTRY_DIR), '')).sort(byPath)
}

async function walk(dir: string, prefix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const paths: string[] = []
  for (const entry of entries) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) paths.push(...(await walk(join(dir, entry.name), path)))
    else if (!entry.name.endsWith('.tmp')) paths.push(path)
  }
  return paths
}

/** Drops a doc's entry: the doc is gone, or is no longer the map's to describe. */
export async function removeEntry(cwd: string, doc: string): Promise<void> {
  await rm(join(docsMapRoot(cwd), ...entryPath(doc).split('/')), { force: true })
}

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Windows refuses the rename while a reader holds the old file open, which is a
 * moment, not a failure: the build waits it out rather than falling back to a
 * partial in-place write.
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
