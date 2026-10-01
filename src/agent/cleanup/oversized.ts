import { readFile, stat } from 'node:fs/promises'
import { matchesGlob, relative } from 'node:path'
import { describeBreaches, type Breach } from './breach'
import { measureUnits, type Unit } from './unit-size'

/**
 * Code lines a unit of each kind may have, and the cognitive complexity a
 * function may have; 0 turns that limit off. Complexity is what a function
 * is held to; its line limit only catches the long one that never branches.
 */
export type Thresholds = { functionLines: number; functionComplexity: number; typeLines: number; fileLines: number }

/**
 * What a file is measured against. A test file gets its own, larger limits:
 * it stays one file per tested file, so it grows with the code it covers.
 */
export type Limits = { source: Thresholds; tests: Thresholds; testGlobs: string[] }

/**
 * A file name that starts or ends with "test", which covers the conventions of
 * most languages (`FooTests.cs`, `FooTest.java`, `foo_test.go`, `test_foo.py`)
 * without taking in a name that merely holds it (`attestation.ts`). Also the
 * `kiwiAgent.cleanup.tests` default in package.json; the two must agree.
 */
export const DEFAULT_TEST_GLOBS = ['**/*.test.*', '**/*test.*', '**/*tests.*', '**/test*', '**/*.spec.*']

/** Test globs ignore case: `Shop.Tests` and `TEST_cart.py` are tests as much as `cart.test.ts`. */
const isTest = (rel: string, globs: string[]): boolean =>
  globs.some((glob) => matchesGlob(rel.toLowerCase(), glob.toLowerCase()))

/** A unit over one or more of its limits, flagged once with each limit it passed. */
export type Oversized = Unit & { path: string; breaches: Breach[] }

/** Beyond this a file is not measured: it is generated or data, not a unit anyone splits. */
const MAX_BYTES = 1_000_000

const lineLimit = (unit: Unit, thresholds: Thresholds): number =>
  unit.kind === 'function' ? thresholds.functionLines : unit.kind === 'type' ? thresholds.typeLines : thresholds.fileLines

const anyOf = (thresholds: Thresholds): boolean =>
  thresholds.functionLines > 0 || thresholds.functionComplexity > 0 || thresholds.typeLines > 0 || thresholds.fileLines > 0

export const anyLimit = (limits: Limits): boolean => anyOf(limits.source) || anyOf(limits.tests)

/** Complexity first: it is what the split is meant to bring down. */
function breaches(unit: Unit, thresholds: Thresholds): Breach[] {
  const found: Breach[] = []
  const over = (measure: Breach['measure'], value: number | undefined, limit: number): void => {
    if (value !== undefined && limit > 0 && value > limit) found.push({ measure, value, limit })
  }
  if (unit.kind === 'function') over('complexity', unit.complexity, thresholds.functionComplexity)
  over('lines', unit.lines, lineLimit(unit, thresholds))
  return found
}

/** The units strictly over a limit of their kind; a limit of 0 flags nothing. */
export function oversized(path: string, units: Unit[], thresholds: Thresholds): Oversized[] {
  return units.flatMap((unit) => {
    const found = breaches(unit, thresholds)
    return found.length > 0 ? [{ ...unit, path, breaches: found }] : []
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
    found.push(...oversized(path, measureUnits(path, text), isTest(rel, limits.testGlobs) ? limits.tests : limits.source))
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

/** One line per unit, as the cleanup run reads it: `src/a.ts:12 name (function, complexity 22, limit 15; 70 lines, limit 60)`. */
export function sizeReport(cwd: string, items: Oversized[]): string {
  return items.map((u) => `${relative(cwd, u.path).split('\\').join('/')}:${u.line} ${u.name} (${u.kind}, ${describeBreaches(u.breaches)})`).join('\n')
}
