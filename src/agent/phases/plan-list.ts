import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SPECS_DIR, WORK_DIR } from './blind-plan'
import { statusOf, type SpecStatus } from './spec-file'
import { readTasks, TASKS_SUFFIX, tasksDone, type TasksState } from './tasks-file'

/** `verified` is derived from the task board and its verification record, as the plan bar does. */
export type PlanStatus = 'draft' | 'approved' | 'verified'

export type PlanSummary = { feature: string; path: string; status: PlanStatus }

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
    const status = statusOf(text)
    const tasks = await readTasks(join(cwd, WORK_DIR, `${slug}${TASKS_SUFFIX}`))
    plans.push({ feature: featureOf(text) ?? slug, path, status: status === 'implemented' || finished(status, tasks) ? 'verified' : status })
  }
  return plans
}

/** Built and proven: the tests passed. What the cleanup left is the dev's to decide on, so it never holds the feature open. */
export function finished(status: SpecStatus, tasks: TasksState): boolean {
  return status === 'approved' && tasks.exists && tasksDone(tasks.tasks) && tasks.verification?.ok === true
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
