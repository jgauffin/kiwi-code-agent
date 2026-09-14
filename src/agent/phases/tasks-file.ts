import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PLAN_DIR, featureSlug } from './blind-plan'

/**
 * The feature's task board, `plan/<slug>.tasks.md`: what to build and where,
 * written by the mapping run once the spec is settled, and marked by the
 * implementer as it goes. The file is the only state: markers survive a fresh
 * session and the plan view reads them as they are.
 */

/** `blocked` is unfinished work with a reason; only `tested` is a finish. */
export type TaskState = 'open' | 'in_progress' | 'done' | 'tested' | 'blocked'

export type Task = {
  id: string
  /** The line's text after the id, markers included, as written. */
  text: string
  /** Spec item ids the task delivers (B1, E2). */
  delivers: string[]
  /** Workspace-relative paths the task touches; what verification runs over. */
  files: string[]
  state: TaskState
  /** The mapping run says the task is gone. */
  removed: boolean
}

/** One run of the test commands, newest first in the file. */
export type VerificationRecord = { at: string; ok: boolean; text: string }

export type TasksState = { exists: false } | { exists: true; tasks: Task[]; verification: VerificationRecord | undefined }

export const VERIFICATION_SECTION = 'Verification'

export function tasksPath(cwd: string, feature: string): string {
  return join(cwd, PLAN_DIR, `${featureSlug(feature)}.tasks.md`)
}

/** Workspace-relative path of the tasks file, the form used in prompts and scopes. */
export function tasksFile(feature: string): string {
  return `${PLAN_DIR}/${featureSlug(feature)}.tasks.md`
}

const TASK = /^-\s+(T\d+)\b\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/
const FILES = /^\s+-\s+files\s*:\s*(.*)$/i
const HEADING = /^#{1,6}\s+(.*)$/
const RECORD = /^-\s+(\S+)\s*:\s*(passed|failed)\b\s*,?\s*(.*)$/i
const REMOVED = /\[removed\]/i
const BLOCKED = /\[blocked\b/i
const TESTED = /\[tested\]/i
const DONE = /\[done\]/i
const IN_PROGRESS = /\[in progress\]/i

/** Blocked wins over any finish: a task marked tested and then blocked on a re-run is not finished. */
function stateOf(text: string): TaskState {
  if (BLOCKED.test(text)) return 'blocked'
  if (TESTED.test(text)) return 'tested'
  if (DONE.test(text)) return 'done'
  if (IN_PROGRESS.test(text)) return 'in_progress'
  return 'open'
}

const list = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

/** `src/a.ts (new)` names a file the task creates; the path is what matters downstream. */
const pathOf = (entry: string): string => entry.replace(/\s*\(new\)\s*$/i, '').trim()

export function parseTasks(text: string): { tasks: Task[]; verification: VerificationRecord | undefined } {
  const tasks: Task[] = []
  let task: Task | undefined
  let inVerification = false
  let verification: VerificationRecord | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const heading = HEADING.exec(line.trim())
    if (heading) {
      inVerification = heading[1]!.trim() === VERIFICATION_SECTION
      task = undefined
      continue
    }
    if (inVerification) {
      const record = RECORD.exec(line.trim())
      // Newest first: the first record under the heading is the one that counts.
      if (record && !verification) {
        verification = { at: record[1]!, ok: record[2]!.toLowerCase() === 'passed', text: record[3]!.trim() }
      }
      continue
    }
    const files = FILES.exec(line)
    if (files && task) {
      task.files = list(files[1]!).map(pathOf)
      continue
    }
    const match = TASK.exec(line.trim())
    if (!match) continue
    const body = match[3]!.trim()
    task = {
      id: match[1]!,
      text: body,
      delivers: list(match[2] ?? ''),
      files: [],
      state: stateOf(body),
      removed: REMOVED.test(body),
    }
    tasks.push(task)
  }
  return { tasks, verification }
}

export async function readTasks(path: string): Promise<TasksState> {
  try {
    return { exists: true, ...parseTasks(await readFile(path, 'utf8')) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }
    throw error
  }
}

export const liveTasks = (tasks: Task[]): Task[] => tasks.filter((t) => !t.removed)

/** Work has started: some task carries a marker. */
export const started = (tasks: Task[]): boolean => liveTasks(tasks).some((t) => t.state !== 'open')

/**
 * Nothing is left to build. Derived from the markers rather than held anywhere
 * else, so it cannot go stale: a task added later makes the feature unfinished
 * again by itself.
 */
export function tasksDone(tasks: Task[]): boolean {
  const live = liveTasks(tasks)
  return live.length > 0 && live.every((t) => t.state === 'tested')
}

/** Every file the live tasks name, once each, in file order. */
export function taskFiles(tasks: Task[]): string[] {
  return [...new Set(liveTasks(tasks).flatMap((t) => t.files))]
}

export function renderRecord(record: VerificationRecord): string {
  return `- ${record.at}: ${record.ok ? 'passed' : 'failed'}${record.text ? `, ${record.text}` : ''}`
}

/** Prepends the record under the Verification heading, adding the section when the file has none. */
export function withRecord(text: string, record: VerificationRecord): string {
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((l) => {
    const heading = HEADING.exec(l.trim())
    return heading !== null && heading[1]!.trim() === VERIFICATION_SECTION
  })
  if (index === -1) {
    const body = text.replace(/\s+$/, '')
    return `${body}\n\n## ${VERIFICATION_SECTION}\n${renderRecord(record)}\n`
  }
  lines.splice(index + 1, 0, renderRecord(record))
  return lines.join('\n')
}

export async function recordVerification(path: string, record: VerificationRecord): Promise<void> {
  const text = await readFile(path, 'utf8')
  await writeFile(path, withRecord(text, record), 'utf8')
}
