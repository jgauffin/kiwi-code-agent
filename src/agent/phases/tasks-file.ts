import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { readOptional } from '../workspace-files'
import { WORK_DIR, featureSlug } from './blind-plan'

/**
 * The feature's task board, `.agent/plan/<slug>.tasks.json`: what to build and
 * where, written by the mapping run through its tool once the spec is settled,
 * and moved along by the implementer through its own. The file is the only
 * state: it survives a fresh session and the plan view reads it as it is.
 */

/** `blocked` is unfinished work with a reason; only `tested` is a finish. */
export type TaskState = 'open' | 'in_progress' | 'done' | 'tested' | 'blocked'

/** The test that proves one delivered rule: the evidence shown on the spec. */
export type Proof = { item: string; file: string; test: string }

export type Task = {
  /** Unique on the board, stable across re-runs. */
  name: string
  /** One sentence for the person: what the task does. */
  text: string
  /** Names of the spec rules the task delivers. */
  delivers: string[]
  /** The scenario the task delivers, as the board groups it; absent on a flat board. */
  group?: string
  /** Workspace-relative paths the task touches; what verification runs over. */
  files: string[]
  /** Of `files`, those the mapping said the task creates. */
  newFiles: string[]
  /** Paths the mapping run read to reach the task: what the implementer starts from and does not have to find again. */
  context: string[]
  /** The mapper's note to the implementer, markdown: what reading the files would not tell (the pattern to follow, a constraint the code imposes, what not to touch). Empty when the board carries none. */
  how: string
  /** What the implementer proved, item by item. */
  proves: Proof[]
  /** The implementer's note: where the build departed from `how` and why, or a choice the spec left open. */
  note: string
  /** What the task left that a later task builds on, by name and file: the hand-off to the next task's session, which starts without this one's conversation. */
  built: string
  state: TaskState
  /** Why a blocked task cannot be finished; present only while it is blocked. */
  blockedReason?: string
  /** The mapping run says the task is gone. */
  removed: boolean
}

/** One run of the test commands. */
export type VerificationRecord = { at: string; ok: boolean; text: string }

/**
 * What the user said about the cleanup the size sweep offered: put off until
 * they ask for it, refused for this feature, or carried out. Absent while the
 * offer has not been answered.
 */
export type CleanupDecision = 'postponed' | 'skipped' | 'done'

export type TaskBoard = {
  /** Fingerprint of the spec the board was mapped from; absent on a board migrated from before the stamp existed. */
  spec?: string
  cleanup?: CleanupDecision
  tasks: Task[]
  /** Newest first. */
  verification: VerificationRecord[]
}

export type TasksState =
  | { exists: false }
  | {
      exists: true
      tasks: Task[]
      /** The newest test run. */
      verification: VerificationRecord | undefined
      spec: string | undefined
      /** What the user said about the cleanup offer; absent while it stands open. */
      cleanup: CleanupDecision | undefined
    }

export const TASKS_SUFFIX = '.tasks.json'

export function tasksPath(cwd: string, feature: string): string {
  return join(cwd, tasksFile(feature))
}

/** Workspace-relative path of the board, the form used in prompts and scopes. */
export function tasksFile(feature: string): string {
  return `${WORK_DIR}/${featureSlug(feature)}${TASKS_SUFFIX}`
}

const TASK_STATES = ['open', 'in_progress', 'done', 'tested', 'blocked'] as const

const boardSchema = z.object({
  spec: z.string().optional(),
  cleanup: z.enum(['postponed', 'skipped', 'done']).optional(),
  tasks: z.array(
    z.object({
      name: z.string().min(1),
      text: z.string(),
      delivers: z.array(z.string()),
      group: z.string().optional(),
      files: z.array(z.string()),
      newFiles: z.array(z.string()),
      context: z.array(z.string()),
      how: z.string(),
      proves: z.array(z.object({ item: z.string(), file: z.string(), test: z.string() })),
      note: z.string(),
      built: z.string().default(''),
      state: z.enum(TASK_STATES),
      blockedReason: z.string().optional(),
      removed: z.boolean(),
    }),
  ),
  verification: z.array(z.object({ at: z.string(), ok: z.boolean(), text: z.string() })),
})

/** A board that does not fit the shape is refused with the field that broke it, never read half. */
export function parseBoard(text: string, path = 'tasks board'): TaskBoard {
  const result = boardSchema.safeParse(JSON.parse(text))
  if (!result.success) {
    const issue = result.error.issues[0]!
    throw new Error(`${path} is malformed at ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  const { spec, cleanup, tasks, verification } = result.data
  return {
    ...(spec !== undefined ? { spec } : {}),
    ...(cleanup !== undefined ? { cleanup } : {}),
    tasks: tasks.map(({ group, blockedReason, ...task }) => ({
      ...task,
      ...(group !== undefined ? { group } : {}),
      ...(blockedReason !== undefined ? { blockedReason } : {}),
    })),
    verification,
  }
}

export const renderBoard = (board: TaskBoard): string => `${JSON.stringify(board, null, 2)}\n`

export const emptyBoard = (): TaskBoard => ({ tasks: [], verification: [] })

export async function readBoard(path: string): Promise<TaskBoard | undefined> {
  const text = await readOptional(path)
  return text === undefined ? undefined : parseBoard(text, path)
}

export async function writeBoard(path: string, board: TaskBoard): Promise<void> {
  await writeFile(path, renderBoard(board), 'utf8')
}

export function stateOfBoard(board: TaskBoard | undefined): TasksState {
  if (!board) return { exists: false }
  return { exists: true, tasks: board.tasks, verification: board.verification[0], spec: board.spec, cleanup: board.cleanup }
}

export async function readTasks(path: string): Promise<TasksState> {
  return stateOfBoard(await readBoard(path))
}

export const liveTasks = (tasks: Task[]): Task[] => tasks.filter((t) => !t.removed)

/** The task to build next: the first live one that is neither tested nor blocked. */
export const nextTask = (board: TaskBoard): Task | undefined =>
  liveTasks(board.tasks).find((t) => t.state !== 'tested' && t.state !== 'blocked')

/** Work has started: some task has moved from open. */
export const started = (tasks: Task[]): boolean => liveTasks(tasks).some((t) => t.state !== 'open')

/**
 * Nothing is left to build. Derived from the task states rather than held
 * anywhere else, so it cannot go stale: a task added later makes the feature
 * unfinished again by itself.
 */
export function tasksDone(tasks: Task[]): boolean {
  const live = liveTasks(tasks)
  return live.length > 0 && live.every((t) => t.state === 'tested')
}

/** Every file the live tasks name, once each, in board order. */
export function taskFiles(tasks: Task[]): string[] {
  return [...new Set(liveTasks(tasks).flatMap((t) => t.files))]
}

/** Names match as the planner wrote them, whatever the case. */
export const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The live task that delivers a rule, first in board order. */
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

/** What the implementer may change on a task; everything else is the mapper's. */
export type TaskProgress = {
  state?: TaskState
  blockedReason?: string
  files?: string[]
  proves?: Proof[]
  note?: string
  built?: string
}

/**
 * Moves one task along. A blocked task needs its reason, and leaving blocked
 * drops it. `files` replaces the list; a file the mapping planned to create
 * stays marked new while the task still names it.
 */
export function updateTask(board: TaskBoard, name: string, change: TaskProgress): TaskBoard {
  const index = board.tasks.findIndex((t) => sameName(t.name, name))
  if (index === -1) throw new Error(`No task named "${name}". The board has: ${board.tasks.map((t) => t.name).join(', ') || 'no tasks'}.`)
  const current = board.tasks[index]!
  const state = change.state ?? current.state
  const reason = change.blockedReason?.trim() || (change.state === undefined ? current.blockedReason : undefined)
  if (state === 'blocked' && !reason) throw new Error(`A blocked task needs a reason: say what stands in the way of "${current.name}".`)
  const { blockedReason: _, ...rest } = current
  const files = change.files ?? current.files
  const next: Task = {
    ...rest,
    state,
    ...(state === 'blocked' ? { blockedReason: reason! } : {}),
    files,
    newFiles: current.newFiles.filter((f) => files.includes(f)),
    proves: change.proves ?? current.proves,
    note: change.note ?? current.note,
    built: change.built ?? current.built,
  }
  return { ...board, tasks: board.tasks.map((t, i) => (i === index ? next : t)) }
}

/** What the mapper says about a task; the implementer's progress on it is not the mapper's to write. */
export type MappedTask = {
  name: string
  text: string
  delivers: string[]
  group?: string
  files: string[]
  newFiles: string[]
  context: string[]
  how: string
}

export type Upsert = { board: TaskBoard; added: string[]; updated: string[]; removed: string[]; unknown: string[] }

/**
 * Writes the mapper's tasks onto the board by name. A task already there keeps
 * its state, proofs, note and hand-off, so a re-map never undoes work; a new one goes at
 * the end of its group, or of the board when its group is new. A removed task
 * stays on the board marked removed, so the implementer's record of it is kept.
 */
export function upsertTasks(board: TaskBoard, mapped: MappedTask[], remove: string[] = []): Upsert {
  const seen = new Set<string>()
  for (const task of mapped) {
    const key = task.name.trim().toLowerCase()
    if (seen.has(key)) throw new Error(`Task "${task.name}" is given twice: a name is unique on the board.`)
    seen.add(key)
  }
  const result: Upsert = { board, added: [], updated: [], removed: [], unknown: [] }
  let tasks = [...board.tasks]
  for (const task of mapped) {
    const index = tasks.findIndex((t) => sameName(t.name, task.name))
    const { group, ...fields } = task
    if (index !== -1) {
      const { group: _, ...current } = tasks[index]!
      tasks[index] = { ...current, ...fields, ...(group !== undefined ? { group } : {}), removed: false }
      result.updated.push(task.name)
      continue
    }
    const created: Task = { ...fields, ...(group !== undefined ? { group } : {}), proves: [], note: '', built: '', state: 'open', removed: false }
    const last = tasks.map((t) => t.group).lastIndexOf(group)
    tasks = last === -1 ? [...tasks, created] : [...tasks.slice(0, last + 1), created, ...tasks.slice(last + 1)]
    result.added.push(task.name)
  }
  for (const name of remove) {
    const index = tasks.findIndex((t) => sameName(t.name, name))
    if (index === -1) {
      result.unknown.push(name)
      continue
    }
    tasks[index] = { ...tasks[index]!, removed: true }
    result.removed.push(tasks[index]!.name)
  }
  result.board = { ...board, tasks }
  return result
}

export const withSpecFingerprint = (board: TaskBoard, fingerprint: string): TaskBoard => ({ ...board, spec: fingerprint })

export const withCleanupDecision = (board: TaskBoard, decision: CleanupDecision): TaskBoard => ({ ...board, cleanup: decision })

/** The newest record goes first. */
export const withRecord = (board: TaskBoard, record: VerificationRecord): TaskBoard => ({ ...board, verification: [record, ...board.verification] })

/** Reads, changes and writes the board in one go, so a change never lands on a copy another writer has since replaced. */
export async function changeBoard(path: string, change: (board: TaskBoard) => TaskBoard): Promise<TaskBoard> {
  const board = await readBoard(path)
  if (!board) throw new Error(`No tasks board at ${path}.`)
  const next = change(board)
  await writeBoard(path, next)
  return next
}

export async function stampSpecFingerprint(path: string, fingerprint: string): Promise<void> {
  await changeBoard(path, (board) => withSpecFingerprint(board, fingerprint))
}

export async function recordCleanupDecision(path: string, decision: CleanupDecision): Promise<void> {
  await changeBoard(path, (board) => withCleanupDecision(board, decision))
}

export async function recordVerification(path: string, record: VerificationRecord): Promise<void> {
  await changeBoard(path, (board) => withRecord(board, record))
}
