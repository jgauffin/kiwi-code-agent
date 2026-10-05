import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SPECS_DIR, WORK_DIR, featureSlug, specPath } from './blind-plan'
import { draftStage, type PlanStage } from './plan-stage'
import { readReview, reviewPath } from './plan-review'
import { authorshipOf, bodyOf, builtOf, statusOf } from './spec-file'
import { isSettled, type Authorship, type SpecStatus } from './spec-status'
import { readTasks, TASKS_SUFFIX, tasksDone, type TasksState } from './tasks-file'

/** The spec's own status, with `verified` derived from the board for a spec that has yet to record it. */
export type PlanStatus = SpecStatus

/** How far a draft's review has got: `draftStage`'s three outcomes short of approval. */
export type ReviewProgress = Extract<PlanStage, 'created' | 'under_review' | 'final_draft'>

/**
 * A planned feature, at its stage. `authored` and `review` say how the draft
 * came to be and how far its review got; they mean nothing once a spec is
 * settled, so they are left out past `draft`.
 */
export type PlanSummary = { feature: string; path: string; status: PlanStatus; authored?: Authorship; review?: ReviewProgress }

const SPEC_SUFFIX = '.spec.md'

/** Every spec in the plan directory, by file name; the slug stands in when the front matter names no feature. */
export async function listPlans(cwd: string): Promise<PlanSummary[]> {
  const dir = join(cwd, SPECS_DIR)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const plans: PlanSummary[] = []
  for (const name of names.filter((n) => n.endsWith(SPEC_SUFFIX)).sort()) {
    const path = join(dir, name)
    const slug = name.slice(0, -SPEC_SUFFIX.length)
    const text = await readFile(path, 'utf8')
    const rawStatus = statusOf(text)
    const tasks = await readTasks(join(cwd, WORK_DIR, `${slug}${TASKS_SUFFIX}`))
    const status = finished(rawStatus, tasks) ? 'verified' : rawStatus
    const draft = status === 'draft' ? { authored: authorshipOf(text), review: await reviewProgress(cwd, slug, text) } : {}
    plans.push({ feature: featureOf(text) ?? slug, path, status, ...draft })
  }
  return plans
}

/**
 * Every feature name in use, one per feature: each spec by the name it carries,
 * then the names planning sessions hold. For telling a model which names it may
 * not offer, so it is the names as a person reads them, not the slugs.
 */
export async function takenFeatureNames(cwd: string, planned: string[]): Promise<string[]> {
  const seen = new Set<string>()
  return [...(await listPlans(cwd)).map((p) => p.feature), ...planned].filter((name) => {
    const slug = featureSlug(name)
    if (seen.has(slug)) return false
    seen.add(slug)
    return true
  })
}

/**
 * The feature already answering to a name, matched by the spec file the name
 * resolves to rather than by its spelling. `planned` are the names feature
 * planning sessions hold, which covers one that has yet to write its spec.
 */
export async function featureAlreadyNamed(cwd: string, feature: string, planned: string[]): Promise<string | undefined> {
  const path = specPath(cwd, feature)
  const spec = (await listPlans(cwd)).find((p) => p.path === path)
  if (spec) return spec.feature
  return planned.find((name) => specPath(cwd, name) === path)
}

/** How far a draft's review has got, read from its review file (none yet counts as never reviewed). */
async function reviewProgress(cwd: string, slug: string, text: string): Promise<ReviewProgress> {
  const review = await readReview(reviewPath(cwd, slug))
  const spec = { exists: true as const, status: 'draft' as const, body: bodyOf(text), built: builtOf(text) }
  return draftStage(spec, review) as ReviewProgress
}

/** Built and proven: the tests passed. What the cleanup left is the dev's to decide on, so it never holds the feature open. */
export function finished(status: SpecStatus, tasks: TasksState): boolean {
  return isSettled(status) && tasks.exists && tasksDone(tasks.tasks) && tasks.verification?.ok === true
}

/** The specs still waiting for approval. */
export async function listDraftPlans(cwd: string): Promise<PlanSummary[]> {
  return (await listPlans(cwd)).filter((p) => p.status === 'draft')
}

function featureOf(text: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const line = match?.[1]?.split(/\r?\n/).find((l) => /^feature:/.test(l))
  const value = line?.slice('feature:'.length).trim()
  return value || undefined
}
