import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PLAN_DIR, WORK_DIR } from './blind-plan'
import { finished } from './plan-list'
import { statusOf, withStatus } from './spec-file'
import { readTasks } from './tasks-file'

/**
 * A feature's working files are kept this long after they were last touched,
 * once the feature is finished or its spec is gone: long enough for the Tasks
 * tab to stay readable after verification, and to outlast a branch switch that
 * hides the spec for a while.
 */
export const WORKING_FILES_KEPT_MS = 7 * 24 * 60 * 60 * 1000

const WORKING_FILE = /^(.+)\.(review|decisions|tasks)\.md$/

/** Workspace-relative paths, by what happened to them. */
export type SweepReport = {
  /** Working files moved out of `plan/`, where they lived before they had a directory of their own. */
  moved: string[]
  /** Working files left in `plan/` because the working directory already holds one of that name. */
  blocked: string[]
  /** Specs marked implemented before their working files went. */
  implemented: string[]
  /** Working files deleted. */
  removed: string[]
}

/**
 * Removes the working files of every feature that is finished, or whose spec
 * is gone, and that nobody has touched for a week. A finished feature's spec
 * is marked implemented first, so its stage outlives the files it was derived
 * from. A draft or a feature under development is never touched, however old.
 */
export async function sweepPlans(cwd: string, now: Date): Promise<SweepReport> {
  const report: SweepReport = { moved: [], blocked: [], implemented: [], removed: [] }
  await moveLegacyFiles(cwd, report)
  const workDir = join(cwd, WORK_DIR)
  for (const [slug, files] of bySlug(await namesIn(workDir))) {
    const touched = await Promise.all(files.map(async (f) => (await stat(join(workDir, f))).mtimeMs))
    if (now.getTime() - Math.max(...touched) < WORKING_FILES_KEPT_MS) continue
    const spec = join(cwd, PLAN_DIR, `${slug}.spec.md`)
    const text = await readIfThere(spec)
    if (text !== undefined && statusOf(text) !== 'implemented') {
      if (!finished(statusOf(text), await readTasks(join(workDir, `${slug}.tasks.md`)))) continue
      await writeFile(spec, withStatus(text, 'implemented'), 'utf8')
      report.implemented.push(`${PLAN_DIR}/${slug}.spec.md`)
    }
    for (const file of files) {
      await rm(join(workDir, file))
      report.removed.push(`${WORK_DIR}/${file}`)
      // A copy the move could not take, such as one an older branch brought back, goes with the file it duplicates.
      const copy = `${PLAN_DIR}/${file}`
      if (report.blocked.includes(copy)) {
        await rm(join(cwd, PLAN_DIR, file))
        report.blocked.splice(report.blocked.indexOf(copy), 1)
        report.removed.push(copy)
      }
    }
  }
  return report
}

async function moveLegacyFiles(cwd: string, report: SweepReport): Promise<void> {
  const legacy = (await namesIn(join(cwd, PLAN_DIR))).filter((n) => WORKING_FILE.test(n))
  if (legacy.length === 0) return
  await mkdir(join(cwd, WORK_DIR), { recursive: true })
  for (const name of legacy) {
    const target = join(cwd, WORK_DIR, name)
    if (await exists(target)) {
      report.blocked.push(`${PLAN_DIR}/${name}`)
      continue
    }
    await rename(join(cwd, PLAN_DIR, name), target)
    report.moved.push(`${PLAN_DIR}/${name}`)
  }
}

function bySlug(names: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const slug = WORKING_FILE.exec(name)?.[1]
    if (slug !== undefined) groups.set(slug, [...(groups.get(slug) ?? []), name])
  }
  return groups
}

async function namesIn(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function readIfThere(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
