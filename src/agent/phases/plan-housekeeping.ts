import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { exists, namesIn, readOptional } from '../workspace-files'
import { SPECS_DIR, WORK_DIR } from './blind-plan'
import { emptyReview } from './plan-review'
import { finished } from './plan-list'
import { planStage, statusForStage } from './plan-stage'
import { alignSpecStatus, readSpecState, statusOf } from './spec-file'
import type { SpecStatus } from './spec-status'
import { readTasks, TASKS_SUFFIX } from './tasks-file'
import { convertLegacyBoard, LEGACY_TASKS_SUFFIX } from './legacy-tasks'

/**
 * A feature's working files are kept this long after they were last touched,
 * once the feature is finished or its spec is gone: long enough for the Tasks
 * tab to stay readable after verification, and to outlast a branch switch that
 * hides the spec for a while.
 */
export const WORKING_FILES_KEPT_MS = 7 * 24 * 60 * 60 * 1000

const WORKING_FILE = /^(.+)\.(review\.md|decisions\.md|tasks\.md|tasks\.json)$/

const SPEC_SUFFIX = '.spec.md'

/** Workspace-relative paths, by what happened to them. */
export type SweepReport = {
  /** Markdown task boards converted to JSON. */
  converted: string[]
  /** Working files moved out of `specs/`, where they lived before they had a directory of their own. */
  moved: string[]
  /** Working files left in `specs/` because the working directory already holds one of that name. */
  blocked: string[]
  /** Specs whose status was rewritten to the stage their files put them at. */
  recorded: { path: string; status: SpecStatus }[]
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
  const report: SweepReport = { converted: [], moved: [], blocked: [], recorded: [], removed: [] }
  await moveLegacyFiles(cwd, report)
  const workDir = join(cwd, WORK_DIR)
  for (const name of (await namesIn(workDir)).filter((n) => n.endsWith(LEGACY_TASKS_SUFFIX))) {
    if (await convertLegacyBoard(join(workDir, name))) report.converted.push(`${WORK_DIR}/${name}`)
  }
  await recordStatuses(cwd, report)
  for (const [slug, files] of bySlug(await namesIn(workDir))) {
    const touched = await Promise.all(files.map(async (f) => (await stat(join(workDir, f))).mtimeMs))
    if (now.getTime() - Math.max(...touched) < WORKING_FILES_KEPT_MS) continue
    const text = await readOptional(join(cwd, SPECS_DIR, `${slug}${SPEC_SUFFIX}`))
    if (text !== undefined) {
      const tasks = await readTasks(join(workDir, `${slug}${TASKS_SUFFIX}`))
      // A postponed cleanup is the dev's word to come back to it, and the board holds what to come back to.
      if (!finished(statusOf(text), tasks) || (tasks.exists && tasks.cleanup === 'postponed')) continue
    }
    for (const file of files) {
      await rm(join(workDir, file))
      report.removed.push(`${WORK_DIR}/${file}`)
    }
    // A copy the move could not take, such as one an older branch brought back, goes with the feature it duplicates.
    for (const copy of report.blocked.filter((b) => WORKING_FILE.exec(b.slice(SPECS_DIR.length + 1))?.[1] === slug)) {
      await rm(join(cwd, copy))
      report.blocked.splice(report.blocked.indexOf(copy), 1)
      report.removed.push(copy)
    }
  }
  return report
}

/**
 * Every spec records the stage its files put its feature at, so the status
 * never lags the board and still says where the feature stands once the board
 * is swept. Which status a stage maps to never turns on the review or the
 * decisions, so the board alone is read here.
 */
async function recordStatuses(cwd: string, report: SweepReport): Promise<void> {
  const specDir = join(cwd, SPECS_DIR)
  for (const name of (await namesIn(specDir)).filter((n) => n.endsWith(SPEC_SUFFIX))) {
    const path = join(specDir, name)
    const spec = await readSpecState(path)
    if (!spec.exists) continue
    const tasks = await readTasks(join(cwd, WORK_DIR, `${name.slice(0, -SPEC_SUFFIX.length)}${TASKS_SUFFIX}`))
    // `implemented` was the terminal status before it came to name the build, and only a sweep of a verified feature ever wrote it with no board left.
    const status = spec.status === 'implemented' && !tasks.exists ? 'verified' : statusForStage(planStage(spec, emptyReview(), tasks))
    if (status !== undefined && (await alignSpecStatus(path, status))) report.recorded.push({ path: `${SPECS_DIR}/${name}`, status })
  }
}

async function moveLegacyFiles(cwd: string, report: SweepReport): Promise<void> {
  const legacy = (await namesIn(join(cwd, SPECS_DIR))).filter((n) => WORKING_FILE.test(n))
  if (legacy.length === 0) return
  await mkdir(join(cwd, WORK_DIR), { recursive: true })
  for (const name of legacy) {
    const target = join(cwd, WORK_DIR, name)
    if (await exists(target)) {
      report.blocked.push(`${SPECS_DIR}/${name}`)
      continue
    }
    await rename(join(cwd, SPECS_DIR, name), target)
    report.moved.push(`${SPECS_DIR}/${name}`)
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
