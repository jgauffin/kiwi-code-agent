import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { exists, namesIn, readOptional } from '../workspace-files'
import { SPECS_DIR, WORK_DIR, specPath } from './blind-plan'
import { featureNameOf, specFiles } from './plan-list'
import { frontMatterValue, withFrontMatterValue } from './spec-file'

/**
 * Which file name each spec id was last seen under. The spec is the master:
 * its id survives a rename, and this is how the feature's working files and
 * sessions, which go by the file name, find the spec again.
 */
export const SPEC_IDS_FILE = `${WORK_DIR}/spec-ids.json`

const SPEC_SUFFIX = '.spec.md'

type Ledger = Record<string, string>

/** A spec now under another file name: `from` and `to` are file names without `.spec.md`, `feature` the name its sessions go by from now on. */
export type FeatureRename = { from: string; to: string; feature: string }

/** Workspace-relative paths, by what happened to them. */
export type IdentityReport = {
  renamed: FeatureRename[]
  /** Working files moved to the spec's new name. */
  moved: string[]
  /** Working files left under the old name because the new name already holds one. */
  blocked: string[]
  /** Specs given an id. */
  stamped: string[]
}

export function specIdOf(text: string): string | undefined {
  return frontMatterValue(text, 'id')
}

async function readLedger(cwd: string): Promise<Ledger> {
  const text = await readOptional(join(cwd, SPEC_IDS_FILE))
  if (text === undefined) return {}
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${SPEC_IDS_FILE} is not an object of spec ids`)
  return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'))
}

async function writeLedger(cwd: string, ledger: Ledger): Promise<void> {
  await mkdir(join(cwd, WORK_DIR), { recursive: true })
  await writeFile(join(cwd, SPEC_IDS_FILE), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
}

/** The spec's id, written into its front matter first when it has none (or only one another spec already took). */
async function stampedId(path: string, taken: ReadonlySet<string>): Promise<{ id: string; stamped: boolean }> {
  const text = await readFile(path, 'utf8')
  const id = specIdOf(text)
  if (id !== undefined && !taken.has(id)) return { id, stamped: false }
  const fresh = randomUUID()
  await writeFile(path, withFrontMatterValue(text, 'id', fresh), 'utf8')
  return { id: fresh, stamped: true }
}

async function moveWorkingFiles(cwd: string, from: string, to: string, report: IdentityReport): Promise<void> {
  const workDir = join(cwd, WORK_DIR)
  // A slug holds no dot, so the prefix names this feature's files and no other's.
  for (const name of (await namesIn(workDir)).filter((n) => n.startsWith(`${from}.`))) {
    const target = `${to}${name.slice(from.length)}`
    if (await exists(join(workDir, target))) {
      report.blocked.push(`${WORK_DIR}/${name}`)
      continue
    }
    await rename(join(workDir, name), join(workDir, target))
    report.moved.push(`${WORK_DIR}/${name}`)
  }
}

/**
 * Gives every spec an id and follows each one whose file name changed since
 * it was last seen: its working files take the new name, and `renamed` says
 * which sessions have to follow. Runs before anything reads the working
 * files by the spec's name, so a renamed feature keeps its board and review.
 */
export async function followSpecRenames(cwd: string): Promise<IdentityReport> {
  const report: IdentityReport = { renamed: [], moved: [], blocked: [], stamped: [] }
  const ledger = await readLedger(cwd)
  const seen = new Set<string>()
  let changed = false
  for (const { slug, path, folder } of await specFiles(join(cwd, SPECS_DIR))) {
    const { id, stamped } = await stampedId(path, seen)
    seen.add(id)
    if (stamped) report.stamped.push(`${SPECS_DIR}/${folder ? `${folder}/` : ''}${slug}${SPEC_SUFFIX}`)
    const previous = ledger[id]
    if (previous !== undefined && previous !== slug) {
      await moveWorkingFiles(cwd, previous, slug, report)
      report.renamed.push({ from: previous, to: slug, feature: featureNameOf(await readFile(path, 'utf8'), slug) })
    }
    if (previous !== slug) {
      ledger[id] = slug
      changed = true
    }
  }
  if (changed) await writeLedger(cwd, ledger)
  return report
}

/**
 * Gives a feature's spec its id as soon as it exists, so a rename made before
 * the next start is still followed. An id the ledger already knows is left
 * alone, even under another name: that is a rename the next start follows.
 */
export async function recordSpecId(cwd: string, feature: string): Promise<void> {
  const path = specPath(cwd, feature)
  const text = await readOptional(path)
  if (text === undefined) return
  const ledger = await readLedger(cwd)
  const known = specIdOf(text)
  if (known !== undefined && ledger[known] !== undefined) return
  const { id } = await stampedId(path, new Set())
  ledger[id] = basename(path, SPEC_SUFFIX)
  await writeLedger(cwd, ledger)
}
