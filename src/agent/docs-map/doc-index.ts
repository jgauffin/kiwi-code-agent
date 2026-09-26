import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, matchesGlob } from 'node:path'
import { DOCS_DIR, README_GLOB } from '../phases/blind-plan'
import { byPath, indexFile, readMapFile, writeMapFile, INDEX_FILE } from './map-files'

/**
 * What the map is of, and what has changed since it was last built. A doc is
 * keyed by the hash of its content, not by its mtime: describing a doc costs a
 * model turn, so a touch that changed nothing, or an edit that was reverted,
 * must not cost a re-read.
 *
 * The set is what a blind planner may see: the docs, the workspace README, and
 * nothing the `planIgnore` setting keeps from it. A doc the planner is denied
 * has no business being described in a map the planner reads.
 */

export type ScannedDoc = { path: string; hash: string }

/** Workspace-relative doc path to the hash of the content the map describes. */
export type DocsIndex = Record<string, string>

/** What a build has to do: describe these, forget those. */
export type DocsDiff = { changed: string[]; removed: string[] }

/** Short enough to read in the file, long enough that two docs never collide. */
export const hashDoc = (text: string): string =>
  createHash('sha256')
    .update(text.replace(/\r\n/g, '\n'))
    .digest('hex')
    .slice(0, 16)

/** Every doc the map covers, with the hash of what it now says, sorted by path. */
export async function scanDocs(cwd: string, ignored: string[] = []): Promise<ScannedDoc[]> {
  const paths = [...(await readmePaths(cwd)), ...(await markdownUnder(cwd, DOCS_DIR))]
  const kept = paths.filter((path) => !ignored.some((glob) => matchesGlob(path, glob))).sort(byPath)
  const docs: ScannedDoc[] = []
  for (const path of kept) {
    const text = await readFile(join(cwd, ...path.split('/')), 'utf8').catch(() => undefined)
    if (text === undefined) continue
    docs.push({ path, hash: hashDoc(text) })
  }
  return docs
}

/** The docs to describe and the entries to drop. A doc whose hash still stands is left alone. */
export function diffDocs(scanned: ScannedDoc[], index: DocsIndex): DocsDiff {
  const changed = scanned.filter((doc) => index[doc.path] !== doc.hash).map((doc) => doc.path)
  const present = new Set(scanned.map((doc) => doc.path))
  const removed = Object.keys(index)
    .filter((path) => !present.has(path))
    .sort(byPath)
  return { changed, removed }
}

/** The index as it stands; an empty one when no build has written it, or when it cannot be read as one. */
export async function readDocsIndex(cwd: string): Promise<DocsIndex> {
  const text = await readMapFile(cwd, INDEX_FILE).catch(() => undefined)
  if (text === undefined) return {}
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return {}
    const docs = (value as { docs?: unknown }).docs
    if (typeof docs !== 'object' || docs === null) return {}
    return Object.fromEntries(Object.entries(docs as Record<string, unknown>).filter(([, hash]) => typeof hash === 'string')) as DocsIndex
  } catch {
    // A corrupt index costs a full re-read, which is the safe way to be wrong.
    return {}
  }
}

/** Written last in a build: a hash stands only for a doc whose entry is on disk and on contract. */
export async function writeDocsIndex(cwd: string, index: DocsIndex): Promise<void> {
  const docs = Object.fromEntries(Object.entries(index).sort(([a], [b]) => byPath(a, b)))
  await writeMapFile(cwd, INDEX_FILE, JSON.stringify({ docs }, null, 2))
}

export const docsIndexPath = (cwd: string): string => indexFile(cwd)

async function readmePaths(cwd: string): Promise<string[]> {
  const entries = await readdir(cwd, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isFile() && matchesGlob(entry.name, README_GLOB)).map((entry) => entry.name)
}

async function markdownUnder(cwd: string, dir: string): Promise<string[]> {
  const entries = await readdir(join(cwd, ...dir.split('/')), { withFileTypes: true }).catch(() => [])
  const paths: string[] = []
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) paths.push(...(await markdownUnder(cwd, path)))
    else if (entry.name.toLowerCase().endsWith('.md')) paths.push(path)
  }
  return paths
}
