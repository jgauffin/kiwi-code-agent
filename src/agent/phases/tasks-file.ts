import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PLAN_DIR, featureSlug } from './blind-plan'
import { bodyOf, frontMatterValue, withFrontMatterValue } from './spec-file'

/**
 * The feature's task board, `plan/<slug>.tasks.md`: what to build and where,
 * written by the mapping run once the spec is settled, and marked by the
 * implementer as it goes. The file is the only state: markers survive a fresh
 * session and the plan view reads them as they are.
 */

/** `blocked` is unfinished work with a reason; only `tested` is a finish. */
export type TaskState = 'open' | 'in_progress' | 'done' | 'tested' | 'blocked'

/** The test that proves one delivered rule: the evidence shown on the spec. */
export type Proof = { item: string; file: string; test: string }

export type Task = {
  /** The bold lead-in; unique in the file, stable across re-runs. */
  name: string
  /** The line's text after the name, markers included, as written. */
  text: string
  /** Names of the spec rules the task delivers. */
  delivers: string[]
  /** The `##` heading the task sits under, the scenario it delivers; absent on a flat board. */
  group?: string
  /** Workspace-relative paths the task touches; what verification runs over. */
  files: string[]
  /** Paths the mapping run read to reach the task: what the implementer starts from and does not have to find again. */
  context: string[]
  /** What the implementer proved, item by item. */
  proves: Proof[]
  state: TaskState
  /** The mapping run says the task is gone. */
  removed: boolean
}

/** One run of the test commands, newest first in the file. */
export type VerificationRecord = { at: string; ok: boolean; text: string }

export type TasksState =
  | { exists: false }
  | {
      exists: true
      tasks: Task[]
      verification: VerificationRecord | undefined
      /** Fingerprint of the spec the board was mapped from; absent on a board written before the stamp existed. */
      spec: string | undefined
    }

export const VERIFICATION_SECTION = 'Verification'
const SPEC_KEY = 'spec'

export function tasksPath(cwd: string, feature: string): string {
  return join(cwd, PLAN_DIR, `${featureSlug(feature)}.tasks.md`)
}

/** Workspace-relative path of the tasks file, the form used in prompts and scopes. */
export function tasksFile(feature: string): string {
  return `${PLAN_DIR}/${featureSlug(feature)}.tasks.md`
}

/** `- **Name** (Rule a, Rule b): text`; the delivered rules ride between the name and the colon. */
const TASK = /^-\s+\*\*([^*]+?)\*\*\s*(?:\(([^)]*)\))?\s*:?\s*(.*)$/
const FILES = /^\s+-\s+files\s*:\s*(.*)$/i
const CONTEXT = /^\s+-\s+context\s*:\s*(.*)$/i
const PROVES = /^\s+-\s+proves\s*:\s*(.*)$/i
/** `Rule name → test/file.ts test_name`; the arrow keeps a name with spaces apart from the path. */
const PROOF = /^(.+?)\s*(?:→|->)\s*(\S+)\s+(.+)$/
const HEADING = /^#{1,6}\s+(.*)$/
const GROUP = /^##\s+(.*)$/
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

/** `Cancel command → test/a.test.ts a_rule_holds`; an entry that does not parse is kept out, not guessed at. */
function proofs(text: string): Proof[] {
  return list(text).flatMap((entry) => {
    const match = PROOF.exec(entry)
    return match ? [{ item: match[1]!, file: match[2]!, test: match[3]!.trim() }] : []
  })
}

export function parseTasks(text: string): { tasks: Task[]; verification: VerificationRecord | undefined; spec: string | undefined } {
  const tasks: Task[] = []
  let task: Task | undefined
  let group: string | undefined
  let inVerification = false
  let verification: VerificationRecord | undefined
  for (const raw of bodyOf(text).split(/\r?\n/)) {
    const line = raw.trimEnd()
    const heading = HEADING.exec(line.trim())
    if (heading) {
      inVerification = heading[1]!.trim() === VERIFICATION_SECTION
      const section = GROUP.exec(line.trim())
      if (section && !inVerification) group = section[1]!.trim()
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
    const context = CONTEXT.exec(line)
    if (context && task) {
      task.context = list(context[1]!)
      continue
    }
    const proves = PROVES.exec(line)
    if (proves && task) {
      task.proves = proofs(proves[1]!)
      continue
    }
    const match = TASK.exec(line.trim())
    if (!match) continue
    const body = match[3]!.trim()
    task = {
      name: match[1]!.trim().replace(/:$/, '').trim(),
      text: body,
      delivers: list(match[2] ?? ''),
      ...(group !== undefined ? { group } : {}),
      files: [],
      context: [],
      proves: [],
      state: stateOf(body),
      removed: REMOVED.test(body),
    }
    tasks.push(task)
  }
  return { tasks, verification, spec: frontMatterValue(text, SPEC_KEY) }
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

/** Names match as the planner wrote them, whatever the case. */
export const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The live task that delivers a rule, first in file order. */
export function deliveredBy(tasks: Task[], item: string): Task | undefined {
  return liveTasks(tasks).find((t) => t.delivers.some((d) => sameName(d, item)))
}

/** The proof a live task recorded for a rule. */
export function provenBy(tasks: Task[], item: string): Proof | undefined {
  return liveTasks(tasks).flatMap((t) => t.proves).find((p) => sameName(p.item, item))
}

/** Rules a task marked tested without naming a test for: a finish the evidence does not back. */
export function unprovenItems(tasks: Task[]): string[] {
  return liveTasks(tasks)
    .filter((t) => t.state === 'tested')
    .flatMap((t) => t.delivers.filter((item) => !t.proves.some((p) => sameName(p.item, item))))
}

/** Of the given rule names, those no live task delivers. */
export function undeliveredItems(tasks: Task[], items: string[]): string[] {
  return items.filter((item) => deliveredBy(tasks, item) === undefined)
}

/** The board was mapped from the spec as it stands now. A board without a stamp is taken as fresh: it predates the stamp. */
export function tasksFresh(tasks: Extract<TasksState, { exists: true }>, fingerprint: string): boolean {
  return tasks.spec === undefined || tasks.spec === fingerprint
}

export const withSpecFingerprint = (text: string, fingerprint: string): string => withFrontMatterValue(text, SPEC_KEY, fingerprint)

export async function stampSpecFingerprint(path: string, fingerprint: string): Promise<void> {
  const text = await readFile(path, 'utf8')
  await writeFile(path, withSpecFingerprint(text, fingerprint), 'utf8')
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
