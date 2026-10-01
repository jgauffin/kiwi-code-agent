import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { changeBoard, nextTask, readBoard, sameName, tasksFile, tasksPath, updateTask, type Task, type TaskBoard, type TaskProgress } from '../../phases/tasks-file'
import type { FileHands } from '../../session/file-hands'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../../session/hooks'
import { fail, ok, type Tool, type ToolOutput } from './tool'

/**
 * The feature's task board as tools, so the implementer never reads or edits
 * the file itself: a state change is one small call, read from disk each
 * time, and the rest of the board stays as the extension derived it.
 */

export const READ_TASKS_TOOL = 'ReadTasks'
export const UPDATE_TASK_TOOL = 'UpdateTask'

const STATES = ['open', 'in_progress', 'done', 'tested', 'blocked'] as const

/** A task's state as the board shows it, with a blocked task's reason. */
export function marker(task: Task): string {
  if (task.removed) return 'removed'
  if (task.state === 'blocked') return task.blockedReason ? `blocked: ${task.blockedReason}` : 'blocked'
  return task.state.replace('_', ' ')
}

const headline = (task: Task): string => `${task.name} [${marker(task)}]${task.delivers.length > 0 ? ` (${task.delivers.join(', ')})` : ''}: ${task.text}`

/** One task in full: what an implementer starts the task from. */
export function detail(task: Task): string {
  const lines = [headline(task)]
  if (task.files.length > 0) lines.push(`files: ${task.files.map((f) => (task.newFiles.includes(f) ? `${f} (new)` : f)).join(', ')}`)
  if (task.foreignFiles.length > 0) lines.push(`foreign changes: ${task.foreignFiles.join(', ')}`)
  if (task.context.length > 0) lines.push(`context: ${task.context.join(', ')}`)
  if (task.how.trim()) lines.push('how:', ...task.how.split('\n').map((l) => `  ${l}`))
  if (task.proves.length > 0) lines.push(`proves: ${task.proves.map((p) => `${p.item} → ${p.file} ${p.test}`).join(', ')}`)
  if (task.note.trim()) lines.push(`note: ${task.note}`)
  if (task.built.trim()) lines.push(`built: ${task.built}`)
  return lines.join('\n')
}

/** One line per task under its group, then the first unfinished task in full: what an implementer needs to pick up the work. */
function overview(board: TaskBoard): string {
  const lines: string[] = []
  let group: string | undefined
  for (const task of board.tasks) {
    if (task.group !== undefined && task.group !== group) lines.push(`## ${task.group}`)
    group = task.group
    lines.push(`- ${headline(task)}`)
  }
  const next = nextTask(board)
  lines.push('', next ? `Next:\n${detail(next)}` : 'Every task is tested or blocked.')
  return lines.join('\n')
}

const readSchema = z.object({
  task: z.string().optional().describe('A task name, for that task in full. Leave out for the whole board, one line per task, with the next unfinished task in full.'),
})

function readTasksTool(feature: string): Tool<typeof readSchema> {
  return {
    name: READ_TASKS_TOOL,
    description: `Read the task board of "${feature}": each task's state, the rules it delivers and what it does, or one task in full (files, context, how, proves, note).`,
    schema: readSchema,
    readOnly: true,
    async execute(input, ctx): Promise<ToolOutput> {
      const board = await readBoard(tasksPath(ctx.cwd, feature))
      if (!board) return ok('The board is empty: no task has been written yet.')
      if (input.task === undefined) return ok(overview(board))
      const task = board.tasks.find((t) => sameName(t.name, input.task!))
      return task ? ok(detail(task)) : fail(`No task named "${input.task}". The board has: ${board.tasks.map((t) => t.name).join(', ')}.`)
    },
  }
}

const updateSchema = z.object({
  task: z.string().min(1).describe('The task name.'),
  state: z.enum(STATES).optional().describe('in_progress when you start it, done when its code is written and its project builds, tested when every rule it delivers is proven by a passing test named in proves, blocked when no answer would let you finish it.'),
  blockedReason: z.string().optional().describe('Why the task cannot be finished; required with state blocked.'),
  files: z.array(z.string()).optional().describe('Every workspace-relative file the task touched, its tests included, replacing the list. The test sweep runs over them, so tested needs them named.'),
  proves: z
    .array(
      z.object({
        rule: z.string().describe('A rule the task delivers, by its name in the spec.'),
        file: z.string().describe('The test file.'),
        test: z.string().describe('The test name, stating the rule it proves.'),
      }),
    )
    .optional()
    .describe('One entry per delivered rule, replacing the list.'),
  note: z.string().optional().describe('Where the build departed from the how and why, or a choice the spec left open.'),
  built: z
    .string()
    .optional()
    .describe('What this task left that a later task builds on: the types, functions, tables and test helpers it added or changed, by name and file. A few lines; the next task starts from them without your conversation.'),
})

function updateTaskTool(feature: string): Tool<typeof updateSchema> {
  return {
    name: UPDATE_TASK_TOOL,
    description: `Move a task of "${feature}" along: its state, the files it touched, the tests that prove its rules, your note. Only the fields you give change.`,
    schema: updateSchema,
    // It writes the session's own board, never the code; a state change is not put to a prompt.
    readOnly: true,
    async execute(input, ctx): Promise<ToolOutput> {
      const change: TaskProgress = {
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.blockedReason !== undefined ? { blockedReason: input.blockedReason } : {}),
        ...(input.files !== undefined ? { files: input.files.map((f) => workspacePath(ctx.cwd, f)) } : {}),
        ...(input.proves !== undefined ? { proves: input.proves.map((p) => ({ item: p.rule, file: workspacePath(ctx.cwd, p.file), test: p.test })) } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.built !== undefined ? { built: input.built } : {}),
      }
      let board: TaskBoard
      try {
        board = await changeBoard(tasksPath(ctx.cwd, feature), (b) => updateTask(b, input.task, change))
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error))
      }
      const task = board.tasks.find((t) => sameName(t.name, input.task))!
      const tested = task.state === 'tested'
      const unproven = tested ? task.delivers.filter((d) => !task.proves.some((p) => sameName(p.item, d))) : []
      const gaps = [
        ...(unproven.length > 0 ? [`No test named for ${unproven.join(', ')}: a tested task names one per rule it delivers.`] : []),
        ...(tested && !task.built.trim() ? ['Nothing said about what it built: give built, the names and files a later task builds on.'] : []),
      ]
      return ok([`${task.name}: ${marker(task)}.`, ...gaps].join(' '))
    },
  }
}

/** Paths are kept workspace-relative with forward slashes, whatever form the model gave. */
function workspacePath(cwd: string, path: string): string {
  const trimmed = path.trim()
  return (isAbsolute(trimmed) ? relative(cwd, trimmed) : trimmed).split('\\').join('/')
}

/** The board tools of one feature; a session is offered those its mode names. */
export function taskBoardTools(feature: string): Tool[] {
  return [readTasksTool(feature), updateTaskTool(feature)]
}

/**
 * Keeps an implement session off the board file itself: its progress goes
 * through the tools, which keep the rest of the board as the mapper wrote it.
 */
export class TaskBoardGuard implements SessionHooks {
  constructor(
    private readonly cwd: string,
    private readonly feature: string,
  ) {}

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    if (!['Write', 'Edit', 'MultiEdit'].includes(tool.toolName)) return undefined
    const raw = (typeof tool.input === 'object' && tool.input !== null ? (tool.input as Record<string, unknown>) : {})['file_path']
    if (typeof raw !== 'string') return undefined
    const rel = relative(this.cwd, isAbsolute(raw) ? raw : resolve(this.cwd, raw)).split('\\').join('/')
    if (rel !== tasksFile(this.feature)) return undefined
    return { deny: `The board is changed through ${UPDATE_TASK_TOOL}, not by editing ${rel}.` }
  }
}
