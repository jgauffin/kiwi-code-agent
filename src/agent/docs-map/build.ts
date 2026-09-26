import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { diffDocs, readDocsIndex, scanDocs, writeDocsIndex, type DocsDiff, type DocsIndex } from './doc-index'
import { checkEntry, docHeadings, parseEntry, type DocsMapEntry } from './entry'
import { SUMMARY_FILE, byPath, docsMapRoot, entryPath, listEntries, readMapFile, removeEntry, writeMapFile } from './map-files'
import { renderDocsSummary } from './summary'

/**
 * The build in two halves, because the middle of it is a model turn.
 *
 * `planDocsMap` says what the run has to describe and what is to be forgotten;
 * the run writes one entry per changed doc. `finishDocsMap` then reads what is
 * on disk, composes the summary and stamps the index. A doc is stamped only
 * when its entry is there and on contract, so a run that stopped halfway costs
 * the next build a re-read of what it did not finish and never a wrong hash.
 */

export type DocsMapPlan = DocsDiff & {
  /** Nothing changed and nothing was dropped: the map on disk still stands. */
  current: boolean
}

export type DocsMapResult = {
  summary: string
  described: string[]
  /** Docs with no entry, or with one off contract: what the next build has to do again. */
  undescribed: string[]
}

export async function planDocsMap(cwd: string, ignored: string[] = []): Promise<DocsMapPlan> {
  const diff = diffDocs(await scanDocs(cwd, ignored), await readDocsIndex(cwd))
  return { ...diff, current: diff.changed.length === 0 && diff.removed.length === 0 }
}

/** Stale when a doc changed, a doc was dropped, or no summary has been composed yet. */
export async function docsMapIsStale(cwd: string, ignored: string[] = []): Promise<boolean> {
  if (!(await planDocsMap(cwd, ignored)).current) return true
  return (await readDocsSummary(cwd)) === undefined
}

/** The summary as it stands on disk, or undefined when no map has been built. */
export const readDocsSummary = (cwd: string): Promise<string | undefined> => readMapFile(cwd, SUMMARY_FILE)

/**
 * Composes the map from the entries on disk and stamps the index. Safe to run
 * whether or not a run happened: with no entries it writes an empty map saying
 * every doc is still to be described.
 */
export async function finishDocsMap(cwd: string, ignored: string[] = []): Promise<DocsMapResult> {
  const scanned = await scanDocs(cwd, ignored)
  const covered = new Set(scanned.map((doc) => doc.path))
  for (const doc of await listEntries(cwd)) {
    if (!covered.has(doc)) await removeEntry(cwd, doc)
  }
  const entries: DocsMapEntry[] = []
  const undescribed: string[] = []
  const index: DocsIndex = {}
  for (const doc of scanned) {
    const entry = await readEntry(cwd, doc.path)
    if (entry === undefined) {
      undescribed.push(doc.path)
      continue
    }
    entries.push(entry)
    index[doc.path] = doc.hash
  }
  const summary = renderDocsSummary(entries, undescribed.sort(byPath))
  await writeMapFile(cwd, SUMMARY_FILE, summary)
  // The index is written last: a hash that outlives its entry would keep the next build from repairing it.
  await writeDocsIndex(cwd, index)
  return { summary, described: entries.map((e) => e.doc), undescribed }
}

/** An entry that is there, parses and matches the doc's headings; undefined for anything else. */
async function readEntry(cwd: string, doc: string): Promise<DocsMapEntry | undefined> {
  const text = await readMapFile(cwd, entryPath(doc)).catch(() => undefined)
  if (text === undefined) return undefined
  const entry = parseEntry(text)
  if (entry.problems.length > 0 || entry.doc !== doc) return undefined
  const source = await readFile(join(cwd, ...doc.split('/')), 'utf8').catch(() => undefined)
  if (source === undefined) return undefined
  return checkEntry(entry, docHeadings(source)).length === 0 ? entry : undefined
}

export const docsMapDir = (cwd: string): string => docsMapRoot(cwd)
