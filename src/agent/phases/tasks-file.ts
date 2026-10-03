import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { readOptional, replaceFile } from '../workspace-files'
import { WORK_DIR, featureSlug } from './blind-plan'
import type { Decision } from './decisions'
import { specFingerprint, type Item, type Scenario, type Spec } from './spec-model'

/**
 * The feature's task board, `.kiwi/specs/<slug>.tasks.json`: derived from the
 * spec once the check against the code is clean, and moved along by the
 * implementer through its tool. The file is the only state: it survives a
 * fresh session and the plan view reads it as it is.
 */

/** `blocked` is unfinished work with a reason; only `tested` is a finish, the developer's acceptance of a blocked task included. */
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
  /** Text of each live rule the task delivered, last time the board was derived from the scenario: what a later derivation diffs against to tell a gained, lost or amended rule from one the change left alone. Absent on a task derived before this was tracked. */
  rulesText?: Record<string, string>
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
  /** The reason it was blocked when the developer accepted it as it is: finished by their word, not by a test. Present only while it stays tested. */
  accepted?: string
  /** The build has handed it back once, blocked, after every other task was finished; it is not handed back again by itself. */
  reassessed?: true
  /** Its scenario is gone from the spec; kept for the implementer's record. */
  removed: boolean
}

/** One command of a test run, described as `describeCommand` does; a failure keeps the tail of its output. */
export type CommandOutcome = { command: string; ok: boolean; output?: string }

/**
 * One run of the test commands. `foreign`, present only when the run ended in
 * failures that were foreign both times, names the files and the hand behind
 * each: what `Held rather than verified` shows on the board. `runs` is each
 * command and how it ended, empty when no command applied; absent on a record
 * written before it was kept.
 */
export type VerificationRecord = { at: string; ok: boolean; text: string; foreign?: { command: string; files: string[]; hand: string }[]; runs?: CommandOutcome[] }

/** The run had nothing to run: no test command applies to the tasks' files, so its pass proves nothing. */
export const nothingRan = (record: VerificationRecord): boolean => record.runs?.length === 0

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
      rulesText: z.record(z.string(), z.string()).optional(),
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
      accepted: z.string().optional(),
      reassessed: z.literal(true).optional(),
      removed: z.boolean(),
    }),
  ),
  verification: z.array(
    z.object({
      at: z.string(),
      ok: z.boolean(),
      text: z.string(),
      foreign: z.array(z.object({ command: z.string(), files: z.array(z.string()), hand: z.string() })).optional(),
      runs: z.array(z.object({ command: z.string(), ok: z.boolean(), output: z.string().optional() })).optional(),
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
    tasks: tasks.map(({ rulesText, group, blockedReason, accepted, reassessed, ...task }) => ({
      ...task,
      ...(rulesText !== undefined ? { rulesText } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(blockedReason !== undefined ? { blockedReason } : {}),
      ...(accepted !== undefined ? { accepted } : {}),
      ...(reassessed ? { reassessed } : {}),
    })),
    verification: verification.map(({ foreign, runs, ...record }) => ({
      ...record,
      ...(foreign !== undefined ? { foreign } : {}),
      ...(runs !== undefined ? { runs: runs.map(({ output, ...run }) => ({ ...run, ...(output !== undefined ? { output } : {}) })) } : {}),
    })),
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

/** The first live blocked task, or the one named: unfinished work, handed back when the person asks for the build again. */
export const blockedTask = (board: TaskBoard, name?: string): Task | undefined =>
  liveTasks(board.tasks).find((t) => t.state === 'blocked' && (name === undefined || sameName(t.name, name)))

/** A blocked task the build has not yet handed back by itself: once nothing else is left to build, it gets another look. */
export const blockedToReassess = (board: TaskBoard): Task | undefined => liveTasks(board.tasks).find((t) => t.state === 'blocked' && !t.reassessed)
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
  const { blockedReason: _, accepted, reassessed, ...rest } = current
  const files = change.files ?? current.files
  // The test sweep runs over the files the tasks name: a tested task naming none would pass it with nothing run.
  // A task the developer accepted stays as they left it until a run moves it again, files or none.
  const keepsAcceptance = accepted !== undefined && change.state === undefined
  if (state === 'tested' && files.length === 0 && !keepsAcceptance) throw new Error(`"${current.name}" names no file: give files, every file the task touched, with its tests.`)
  const next: Task = {
    ...rest,
    state,
    ...(state === 'blocked' ? { blockedReason: reason! } : {}),
    // Acceptance stands only while nothing moves the task again; another look holds through the look itself, so a task blocked again is not handed back once more.
    ...(keepsAcceptance ? { accepted } : {}),
    ...(reassessed && (state === 'blocked' || state === 'in_progress') ? { reassessed } : {}),
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

/** The build hands a blocked task back by itself once: marked so it is not handed back again. */
export function markReassessed(board: TaskBoard, name: string): TaskBoard {
  return { ...board, tasks: board.tasks.map((t) => (sameName(t.name, name) ? { ...t, reassessed: true as const } : t)) }
}

/**
 * The developer accepts a blocked task as it is: it counts as finished, and
 * the board keeps why it was blocked rather than claiming a test proved it.
 * Its rules stay without proof, so the view goes on saying so.
 */
export function acceptTask(board: TaskBoard, name: string): TaskBoard {
  const task = blockedTask(board, name)
  if (!task) throw new Error(`"${name}" is not a blocked task on the board: only a blocked task can be accepted as it is.`)
  const { blockedReason, reassessed: _, ...rest } = task
  const accepted: Task = { ...rest, state: 'tested', accepted: blockedReason ?? 'blocked' }
  return { ...board, tasks: board.tasks.map((t) => (t === task ? accepted : t)) }
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
 * A finished task whose scenario gained, lost or amended a rule since it was
 * last derived is unfinished again: its proofs for the rules the change left
 * alone stand, the rest drop, and its `how` says which rules are new or
 * amended, so the run it is handed to builds those rather than the scenario
 * anew. A task derived before rule changes were tracked this way is read as
 * unchanged the first time, so an older board is not reopened wholesale.
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
  const derived = scenariosToDerive(spec, kept)
  const tasks = reconcileExistingTasks(board, kept, derived, found)
  tasks.push(...newTasksFromDerived(derived, found, built, drift))
  return { ...board, tasks, spec: specFingerprint(spec) }
}

type DerivedScenario = { scenario: Scenario; delivers: string[]; items: Item[] }

/** Every scenario the board has nothing live for yet, by its title; a scenario whose rules are already all delivered has nothing to derive. */
function scenariosToDerive(spec: Spec, kept: Task[]): Map<string, DerivedScenario> {
  const derived = new Map<string, DerivedScenario>()
  for (const scenario of spec.scenarios) {
    const items = scenario.behaviours.flatMap((b) => [b, ...b.edges]).filter((i) => !i.removed)
    const delivers = items.map((i) => i.name).filter((name) => deliveredBy(kept, name) === undefined)
    if (delivers.length > 0) derived.set(scenario.title.trim().toLowerCase(), { scenario, delivers, items })
  }
  return derived
}

/** Every task the board already had, reconciled against what is still derived for its scenario; a scenario matched here is spent, taken out of `derived` for the caller. */
function reconcileExistingTasks(board: TaskBoard, kept: Task[], derived: Map<string, DerivedScenario>, found: Map<string, string[]>): Task[] {
  return board.tasks.map((t) => {
    if (kept.includes(t)) return t
    const entry = derived.get(t.name.trim().toLowerCase())
    if (!entry) return t.removed ? t : { ...t, removed: true }
    derived.delete(t.name.trim().toLowerCase())
    const override = reconciledScenario(t, entry)
    const { accepted: _accepted, ...withoutAccepted } = t
    // Reopened by the scenario change rather than left as the implementer settled it: no longer the accepted word on a blocked task.
    const base = override.state === 'open' && t.state === 'tested' ? withoutAccepted : t
    return { ...base, ...override, context: found.get(t.name.trim().toLowerCase()) ?? t.context, removed: false }
  })
}

/** A brand-new task for every scenario nothing existing claimed. */
function newTasksFromDerived(derived: Map<string, DerivedScenario>, found: Map<string, string[]>, built: boolean, drift: Set<string>): Task[] {
  const tasks: Task[] = []
  for (const [key, { scenario, delivers, items }] of derived) {
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
      rulesText: textsOf(items),
    })
  }
  return tasks
}

const fromScenario = (scenario: Scenario, delivers: string[]) => ({
  name: scenario.title,
  group: scenario.title,
  text: scenario.intro.trim() || scenario.title,
  delivers,
})

/** Each item's text by its name, the snapshot a later derivation diffs against. */
const textsOf = (items: Item[]): Record<string, string> => Object.fromEntries(items.map((i) => [i.name, i.text]))

const textOf = (texts: Record<string, string>, name: string): string | undefined => {
  const key = Object.keys(texts).find((k) => sameName(k, name))
  return key === undefined ? undefined : texts[key]
}

/**
 * An existing scenario task merged with what the scenario now holds: gained,
 * lost and amended rules reopen a tested task, with its proofs for the rules
 * the change left alone kept and the rest dropped, and its `how` naming what
 * is new or amended for the run to build. A task with no snapshot to diff
 * against (derived before this was tracked) is taken as unchanged.
 */
function reconciledScenario(t: Task, entry: { scenario: Scenario; delivers: string[]; items: Item[] }): Partial<Task> {
  const base = fromScenario(entry.scenario, entry.delivers)
  const rulesText = textsOf(entry.items)
  const prior = t.rulesText
  if (!prior) return { ...base, rulesText }
  const added = entry.items.filter((i) => textOf(prior, i.name) === undefined)
  const amended = entry.items.filter((i) => textOf(prior, i.name) !== undefined && textOf(prior, i.name) !== i.text)
  const lost = Object.keys(prior).filter((name) => !entry.items.some((i) => sameName(i.name, name)))
  if (added.length === 0 && amended.length === 0 && lost.length === 0) return { ...base, rulesText }
  const touched = [...added, ...amended].map((i) => i.name).concat(lost)
  const proves = t.proves.filter((p) => !touched.some((name) => sameName(p.item, name)))
  if (t.state !== 'tested') return { ...base, rulesText, proves }
  const changedNames = [...added, ...amended].map((i) => i.name)
  return { ...base, rulesText, proves, state: 'open', how: changedNames.length > 0 ? changedRulesHow(changedNames) : '' }
}

/** Told to whichever run picks the reopened task back up: builds the rules the change touched, not the scenario anew. */
function changedRulesHow(names: string[]): string {
  const quoted = names.map((n) => `"${n}"`).join(', ')
  return `The spec changed since this task was last built: ${quoted} ${names.length === 1 ? 'is' : 'are'} new or amended. Its other rules already stand as they are: build ${names.length === 1 ? 'this one' : 'these'} rather than the scenario anew.`
}

export const withSpecFingerprint = (board: TaskBoard, fingerprint: string): TaskBoard => ({ ...board, spec: fingerprint })

export const withCleanupDecision = (board: TaskBoard, decision: CleanupDecision): TaskBoard => ({ ...board, cleanup: decision })

/** The newest record goes first; only it keeps its failures' output, which the Verify step shows, so the board does not grow with every failed run. */
export const withRecord = (board: TaskBoard, record: VerificationRecord): TaskBoard => ({
  ...board,
  verification: [record, ...board.verification.map(withoutOutput)],
})

const withoutOutput = (record: VerificationRecord): VerificationRecord =>
  record.runs ? { ...record, runs: record.runs.map(({ output: _, ...run }) => run) } : record

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
