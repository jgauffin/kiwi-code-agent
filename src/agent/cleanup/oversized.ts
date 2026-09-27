import { readFile, stat } from 'node:fs/promises'
import { matchesGlob, relative } from 'node:path'
import { measureUnits, type Unit, type UnitKind } from './unit-size'

/** Code lines a unit of each kind may have; 0 turns the limit off. */
export type Thresholds = { functionLines: number; typeLines: number; fileLines: number }

/**
 * What a file is measured against. A test file gets its own, larger limits:
 * it stays one file per tested file, so it grows with the code it covers.
 */
export type Limits = { source: Thresholds; tests: Thresholds; testGlobs: string[] }

export type Oversized = Unit & { path: string; threshold: number }

/** Beyond this a file is not measured: it is generated or data, not a unit anyone splits. */
const MAX_BYTES = 1_000_000

const limitFor = (kind: UnitKind, thresholds: Thresholds): number =>
  kind === 'function' ? thresholds.functionLines : kind === 'type' ? thresholds.typeLines : thresholds.fileLines

const anyOf = (thresholds: Thresholds): boolean =>
  thresholds.functionLines > 0 || thresholds.typeLines > 0 || thresholds.fileLines > 0

export const anyLimit = (limits: Limits): boolean => anyOf(limits.source) || anyOf(limits.tests)

/** The units strictly over their kind's limit; a limit of 0 flags nothing. */
export function oversized(path: string, units: Unit[], thresholds: Thresholds): Oversized[] {
  return units.flatMap((unit) => {
    const threshold = limitFor(unit.kind, thresholds)
    return threshold > 0 && unit.lines > threshold ? [{ ...unit, path, threshold }] : []
  })
}

/**
 * The oversized units across files, in the order given. A file that is gone,
 * binary, too large or matched by an ignore glob is passed over: nothing to
 * split there, or nothing anyone wants split (generated code).
 */
export async function oversizedFiles(cwd: string, files: string[], limits: Limits, ignore: string[]): Promise<Oversized[]> {
  const found: Oversized[] = []
  for (const path of files) {
    const rel = relative(cwd, path).split('\\').join('/')
    const matches = (globs: string[]) => globs.some((glob) => matchesGlob(rel, glob))
    if (matches(ignore)) continue
    const text = await readText(path)
    if (text === undefined) continue
    found.push(...oversized(path, measureUnits(path, text), matches(limits.testGlobs) ? limits.tests : limits.source))
  }
  return found
}

async function readText(path: string): Promise<string | undefined> {
  try {
    if ((await stat(path)).size > MAX_BYTES) return undefined
    const text = await readFile(path, 'utf8')
    return text.includes('\u0000') ? undefined : text
  } catch {
    // Deleted or moved since it was edited: nothing to measure.
    return undefined
  }
}

/** One line per unit, as the cleanup run reads it: `src/a.ts:12 name (function, 61 lines, limit 25)`. */
export function sizeReport(cwd: string, items: Oversized[]): string {
  return items
    .map((u) => `${relative(cwd, u.path).split('\\').join('/')}:${u.line} ${u.name} (${u.kind}, ${u.lines} lines, limit ${u.threshold})`)
    .join('\n')
}
