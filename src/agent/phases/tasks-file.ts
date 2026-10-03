import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { readOptional, replaceFile } from '../workspace-files'
import { WORK_DIR, featureSlug } from './blind-plan'
import type { Decision } from './decisions'
import { specFingerprint, type Scenario, type Spec } from './spec-model'

/**
 * The feature's task board, `.kiwi/specs/<slug>.tasks.json`: derived from the
 * spec once the check against the code is clean, and moved along by the
 * implementer through its tool. The file is the only state: it survives a
 * fresh session and the plan view reads it as it is.
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
  /** Workspace-relative paths the task touched, as the implementer names them; what verification runs over. */
  files: string[]
  /** Of `files`, those a mapping run said the task creates; empty on a derived board. */
  newFiles: string[]
  /** Of `files`, those whose current content a foreign hand left rather than this feature's own runs: recorded, not folded silently into the task's work. */
  foreignFiles: string[]
  /** Paths the task starts from: where the spec check found its scenario is built, or what a mapping run read on an older board. */
  context: string[]
  /** A mapping run's note to the implementer, markdown; empty on a derived board, unless the spec is migrated behaviour the check found this scenario already built, in which case it says to add tests only. */
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
  /** Its scenario is gone from the spec; kept for the implementer's record. */
  removed: boolean
}

/** One run of the test commands. `foreign`, present only when the run ended in failures that were foreign both times, names the files and the hand behind each: what `Held rather than verified` shows on the board. */
export type VerificationRecord = { at: string; ok: boolean; text: string; foreign?: { command: string; files: string[]; hand: string }[] }

/**
 * What the user said about the cleanup the size sweep offered: put off until
 * they ask for it, refused for this feature, or carried out. Absent while the
 * offer has not been answered.
 */
export type CleanupDecision = 'postponed' | 'skipped' | 'done'

export type TaskBoard = {
  /** Fingerprint of the spec the board was derived from; absent on a board migrated from before the stamp existed. */
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
      newFiles: z.array(z.string()).default([]),
      foreignFiles: z.array(z.string()).default([]),
      context: z.array(z.string()).default([]),
      how: z.string().default(''),
      proves: z.array(z.object({ item: z.string(), file: z.string(), test: z.string() })),
      note: z.string(),
      built: z.string().default(''),
      state: z.enum(TASK_STATES),
      blockedReason: z.string().optional(),
      removed: z.boolean(),
    }),
  ),
  verification: z.array(
    z.object({
      at: z.string(),
      ok: z.boolean(),
      text: z.string(),
      foreign: z.array(z.object({ command: z.string(), files: z.array(z.string()), hand: z.string() })).optional(),
    }),
  ),
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
    verification: verification.map(({ foreign, ...record }) => ({ ...record, ...(foreign !== undefined ? { foreign } : {}) })),
  }
}

export const renderBoard = (board: TaskBoard): string => `${JSON.stringify(board, null, 2)}\n`

export const emptyBoard = (): TaskBoard => ({ tasks: [], verification: [] })

export async function readBoard(path: string): Promise<TaskBoard | undefined> {
  const text = await readOptional(path)
  return text === undefined ? undefined : parseBoard(text, path)
}

export function writeBoard(path: string, board: TaskBoard): Promise<void> {
  return queued(path, () => replaceBoard(path, board))
}

/** A reader never sees a board half written: it is staged beside the file and renamed into place. */
async function replaceBoard(path: string, board: TaskBoard): Promise<void> {
  const staged = `${path}.${randomUUID()}.tmp`
  await writeFile(staged, renderBoard(board), 'utf8')
  await replaceFile(staged, path)
}

const pending = new Map<string, Promise<unknown>>()

/** Parallel sessions change the same board; each change waits for the one before it, so none is lost. */
function queued<T>(path: string, work: () => Promise<T>): Promise<T> {
  const next = (pending.get(path) ?? Promise.resolve()).then(work, work)
  const settled = next.catch(() => undefined)
  pending.set(path, settled)
  void settled.then(() => {
    if (pending.get(path) === settled) pending.delete(path)
  })
  return next
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

/** The first live blocked task: unfinished work, handed back when the person asks for the build again. */
export const blockedTask = (board: TaskBoard): Task | undefined => liveTasks(board.tasks).find((t) => t.state === 'blocked')

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

/** The board was derived from the spec as it stands now. A board without a stamp is taken as fresh: it predates the stamp. */
export function tasksFresh(tasks: Extract<TasksState, { exists: true }>, fingerprint: string): boolean {
  return tasks.spec === undefined || tasks.spec === fingerprint
}

/** What the implementer may change on a task; everything else is derived from the spec. */
export type TaskProgress = {
  state?: TaskState
  blockedReason?: string
  files?: string[]
  /** Of `files`, those a foreign hand's change was found on; recomputed by the caller whenever `files` is given. */
  foreignFiles?: string[]
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
  // The test sweep runs over the files the tasks name: a tested task naming none would pass it with nothing run.
  if (state === 'tested' && files.length === 0) throw new Error(`"${current.name}" names no file: give files, every file the task touched, with its tests.`)
  const next: Task = {
    ...rest,
    state,
    ...(state === 'blocked' ? { blockedReason: reason! } : {}),
    files,
    newFiles: current.newFiles.filter((f) => files.includes(f)),
    // Not counted as the task's own work by staying silent: a foreign change to a named file is recorded here instead, and drops off once the task no longer names the file.
    foreignFiles: (change.foreignFiles ?? current.foreignFiles).filter((f) => files.includes(f)),
    proves: change.proves ?? current.proves,
    note: change.note ?? current.note,
    built: change.built ?? current.built,
  }
  return { ...board, tasks: board.tasks.map((t, i) => (i === index ? next : t)) }
}

/**
 * The behaviour the migration marked built this spec already has: the code
 * already does it, so a brand-new task for it only adds the tests that prove
 * it. A rule the check found a decision on disagreed with that at some point,
 * so it builds like any other rule instead, whatever the ruling settled on;
 * a withdrawn decision no longer counts, since it no longer disagrees.
 */
export const TESTS_ONLY_HOW =
  'The behaviour already exists in the code: nothing here stood in its way, so do not change it. Read the files above, then add the test or tests that prove each rule, and move the task to tested once they pass.'

/**
 * The board as the spec defines it: one task per scenario, named and grouped
 * by its title, delivering its live rules and edge cases, so every rule is
 * delivered by construction. Deriving again keeps each task's progress and
 * files; a scenario gone from the spec leaves its task marked removed. A task
 * a mapping run wrote before boards were derived keeps its rules once work on
 * it has started, and gives way while it is still open. `context` is where the
 * spec check found each scenario is built, by scenario title: the newest check
 * replaces a task's, and a scenario it left out keeps what the task had.
 *
 * `built` and `decisions` carry what the check found for a spec migrated from
 * a doc about behaviour the code already has: a brand-new task whose rules the
 * check raised no decision on is told to add tests only, since nothing
 * disagreed with it; a task that shares a scenario with a decision builds as
 * any other, so only what disagreed gets built.
 */
export function deriveBoard(spec: Spec, board: TaskBoard = emptyBoard(), context: Map<string, string[]> = new Map(), built = false, decisions: Decision[] = []): TaskBoard {
  const found = new Map([...context].map(([title, paths]) => [title.trim().toLowerCase(), paths]))
  const drift = new Set(
    decisions
      .filter((d) => d.state !== 'withdrawn')
      .flatMap((d) => d.on)
      .map((name) => name.trim().toLowerCase()),
  )
  const scenarioTask = (t: Task) => sameName(t.group ?? '', t.name) || spec.scenarios.some((s) => sameName(s.title, t.name))
  const kept = board.tasks.filter((t) => !t.removed && !scenarioTask(t) && t.state !== 'open')
  const derived = new Map<string, { scenario: Scenario; delivers: string[] }>()
  for (const scenario of spec.scenarios) {
    const items = scenario.behaviours.flatMap((b) => [b, ...b.edges]).filter((i) => !i.removed)
    const delivers = items.map((i) => i.name).filter((name) => deliveredBy(kept, name) === undefined)
    if (delivers.length > 0) derived.set(scenario.title.trim().toLowerCase(), { scenario, delivers })
  }
  const tasks: Task[] = board.tasks.map((t) => {
    if (kept.includes(t)) return t
    const entry = derived.get(t.name.trim().toLowerCase())
    if (!entry) return t.removed ? t : { ...t, removed: true }
    derived.delete(t.name.trim().toLowerCase())
    return { ...t, ...fromScenario(entry.scenario, entry.delivers), context: found.get(t.name.trim().toLowerCase()) ?? t.context, removed: false }
  })
  for (const [key, { scenario, delivers }] of derived) {
    const testsOnly = built && delivers.every((name) => !drift.has(name.trim().toLowerCase()))
    tasks.push({
      ...fromScenario(scenario, delivers),
      files: [],
      newFiles: [],
      foreignFiles: [],
      context: found.get(key) ?? [],
      how: testsOnly ? TESTS_ONLY_HOW : '',
      proves: [],
      note: '',
      built: '',
      state: 'open',
      removed: false,
    })
  }
  return { ...board, tasks, spec: specFingerprint(spec) }
}

const fromScenario = (scenario: Scenario, delivers: string[]) => ({
  name: scenario.title,
  group: scenario.title,
  text: scenario.intro.trim() || scenario.title,
  delivers,
})

export const withSpecFingerprint = (board: TaskBoard, fingerprint: string): TaskBoard => ({ ...board, spec: fingerprint })

export const withCleanupDecision = (board: TaskBoard, decision: CleanupDecision): TaskBoard => ({ ...board, cleanup: decision })

/** The newest record goes first. */
export const withRecord = (board: TaskBoard, record: VerificationRecord): TaskBoard => ({ ...board, verification: [record, ...board.verification] })

/** Reads, changes and writes the board in one go, so a change never lands on a copy another writer has since replaced. */
export function changeBoard(path: string, change: (board: TaskBoard) => TaskBoard): Promise<TaskBoard> {
  return queued(path, async () => {
    const board = await readBoard(path)
    if (!board) throw new Error(`No tasks board at ${path}.`)
    const next = change(board)
    await replaceBoard(path, next)
    return next
  })
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
