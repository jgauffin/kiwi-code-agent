import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { changedRanges, type LineRange } from '../edits/unified-diff'
import { readOptional, replaceFile } from '../workspace-files'
import { WORK_DIR, featureSlug } from './blind-plan'
import { liveTasks, type Task } from './tasks-file'

/**
 * The content of the files a feature's mapping named, as they stood when it
 * mapped them, kept in `.kiwi/specs/<slug>.mapping.json`. A feature is mapped
 * when its check runs and built when the person starts it, which may be days
 * and another feature's work apart: the snapshot is what makes that gap
 * visible, so the implementer is told where the ground moved instead of
 * trusting a file list that has aged.
 */

export const MAPPING_SUFFIX = '.mapping.json'

/** Workspace-relative path of the snapshot, the form used in prompts and scopes. */
export function mappingFile(feature: string): string {
  return `${WORK_DIR}/${featureSlug(feature)}${MAPPING_SUFFIX}`
}

export function mappingPath(cwd: string, feature: string): string {
  return join(cwd, mappingFile(feature))
}

/** `at` is when the mapping read them; `files` is workspace-relative path to content. */
export type MappingSnapshot = { at: string; files: Record<string, string> }

/** Where a mapped file no longer reads as it did: its changed stretches, or that it is gone. */
export type FileDrift = { file: string; ranges: LineRange[]; gone?: true }

/** Every file the board's live tasks were mapped to, once each, in board order: where the check found the work and whatever the tasks have since named. */
export function mappedFiles(tasks: Task[]): string[] {
  return [...new Set(liveTasks(tasks).flatMap((t) => [...t.context, ...t.files]))]
}

/** Takes the snapshot the next build start compares against. A file that cannot be read is left out: it is new, so there is nothing it drifted from. */
export async function writeMappingSnapshot(cwd: string, feature: string, files: string[], now = new Date()): Promise<void> {
  const entries = await Promise.all(files.map(async (file) => [file, await readOptional(join(cwd, file))] as const))
  const snapshot: MappingSnapshot = { at: now.toISOString(), files: Object.fromEntries(entries.filter(([, text]) => text !== undefined) as [string, string][]) }
  const path = mappingPath(cwd, feature)
  await mkdir(dirname(path), { recursive: true })
  const staged = `${path}.${randomUUID()}.tmp`
  await writeFile(staged, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  await replaceFile(staged, path)
}

/** The snapshot of the feature's mapping; none when no check has taken one, or when what is there cannot be read as one. */
export async function readMappingSnapshot(cwd: string, feature: string): Promise<MappingSnapshot | undefined> {
  const text = await readOptional(mappingPath(cwd, feature))
  if (text === undefined) return undefined
  try {
    const parsed = JSON.parse(text) as MappingSnapshot
    return typeof parsed.at === 'string' && typeof parsed.files === 'object' && parsed.files !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * How far the files have moved since the mapping read them: one entry per
 * mapped file that now reads differently, none for a file the mapping never
 * saw. Only the files asked about, so a task is told about its own surface.
 */
export async function mappingDrift(cwd: string, snapshot: MappingSnapshot | undefined, files: string[]): Promise<FileDrift[]> {
  if (!snapshot) return []
  const drift: FileDrift[] = []
  for (const file of files) {
    const before = snapshot.files[file]
    if (before === undefined) continue
    const after = await readFile(join(cwd, file), 'utf8').catch(() => undefined)
    if (after === undefined) {
      drift.push({ file, ranges: [], gone: true })
      continue
    }
    const ranges = changedRanges(before, after)
    if (ranges.length > 0) drift.push({ file, ranges })
  }
  return drift
}

/** Beyond this many ranges a file has been worked over rather than touched, and the count says more than the list. */
const RANGES_SHOWN = 8

/** What the drift is told as, one line per file; empty when nothing moved. */
export function driftLines(drift: FileDrift[]): string[] {
  if (drift.length === 0) return []
  return [
    "These files changed since the check mapped them, by a hand other than this feature's own work. Read the places named before you build on them:",
    ...drift.map((d) => `- ${d.file}: ${d.gone ? 'gone' : describeRanges(d.ranges)}`),
  ]
}

function describeRanges(ranges: LineRange[]): string {
  if (ranges.length > RANGES_SHOWN) return `changed throughout, in ${ranges.length} places`
  return `line${ranges.length === 1 && ranges[0]!.from === ranges[0]!.to ? '' : 's'} ${ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join(', ')}`
}
