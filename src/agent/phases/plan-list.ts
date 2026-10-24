import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { SPECS_DIR, WORK_DIR, featureSlug } from './blind-plan'
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
export type PlanSummary = { feature: string; path: string; status: PlanStatus; authored?: Authorship; review?: ReviewProgress; folder?: string }

const SPEC_SUFFIX = '.spec.md'

/**
 * Every spec file under the plan directory, any depth: a person may file one
 * deeper than the single domain folder a session ever proposes, and it is
 * still found. `rel` orders them so a folder lists in the same place its
 * files would sort at the root, and root-only files keep the order
 * `listPlans` always gave. `folder` is the first path segment under `specs/`,
 * absent for a spec at the root.
 */
export async function specFiles(dir: string): Promise<{ slug: string; path: string; folder?: string }[]> {
  const files: { slug: string; path: string; folder?: string; rel: string }[] = []
  async function walk(current: string, relDir: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isFile() && entry.name.endsWith(SPEC_SUFFIX)) {
        files.push({ slug: entry.name.slice(0, -SPEC_SUFFIX.length), path: join(current, entry.name), ...(relDir ? { folder: relDir } : {}), rel })
      } else if (entry.isDirectory()) {
        await walk(join(current, entry.name), rel)
      }
    }
  }
  await walk(dir, '')
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)).map(({ slug, path, folder }) => ({ slug, path, ...(folder ? { folder } : {}) }))
}

/** Every spec in the plan directory, at the root or any folder beneath it, each by the name its sessions go by. */
export async function listPlans(cwd: string): Promise<PlanSummary[]> {
  const dir = join(cwd, SPECS_DIR)
  const plans: PlanSummary[] = []
  for (const { slug, path, folder } of await specFiles(dir)) {
    const text = await readFile(path, 'utf8')
    const rawStatus = statusOf(text)
    const tasks = await readTasks(join(cwd, WORK_DIR, `${slug}${TASKS_SUFFIX}`))
    const status = finished(rawStatus, tasks) ? 'verified' : rawStatus
    const draft = status === 'draft' ? { authored: authorshipOf(text), review: await reviewProgress(cwd, slug, text) } : {}
    plans.push({ feature: featureNameOf(text, slug), path, status, ...(folder ? { folder } : {}), ...draft })
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
 * The feature already answering to a name, matched by the slug the name
 * resolves to rather than by its spelling or by where its spec sits: a spec
 * in a domain folder answers to its name exactly as a root one does, since
 * the folder groups specs and never identifies the feature. `planned` are
 * the names feature planning sessions hold, which covers one that has yet to
 * write its spec.
 */
export async function featureAlreadyNamed(cwd: string, feature: string, planned: string[]): Promise<string | undefined> {
  const slug = featureSlug(feature)
  const spec = (await listPlans(cwd)).find((p) => basename(p.path).slice(0, -SPEC_SUFFIX.length) === slug)
  if (spec) return spec.feature
  return planned.find((name) => featureSlug(name) === slug)
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

/**
 * The name a spec's sessions go by. Sessions find the spec and its working files by the slug of
 * that name, so the spec's own name is used only when it leads back to its file; one that does not
 * (`.NET analyzer` in `dotnet-analyzer.spec.md`) gives way to the file's slug.
 */
export function featureNameOf(text: string, slug: string): string {
  const named = featureOf(text)
  return named !== undefined && featureSlug(named) === slug ? named : slug
}

/** The feature name a spec's front matter carries, read straight off its raw text. */
export function featureOf(text: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const line = match?.[1]?.split(/\r?\n/).find((l) => /^feature:/.test(l))
  const value = line?.slice('feature:'.length).trim()
  return value || undefined
}
