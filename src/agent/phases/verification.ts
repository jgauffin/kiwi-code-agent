import { readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from 'node:path'
import { readTasks, recordVerification, taskFiles, tasksDone, tasksFile, tasksPath, type TasksState, type VerificationRecord } from './tasks-file'

/**
 * A rule says which files, when touched, make which command run, and where.
 * `{project}` in the command is the nearest file matching `project` above the
 * touched file; `{projectDir}` is its directory. Without `project`, the
 * command runs in the workspace root. A repo with a backend and a frontend
 * bundle carries one rule each, and a feature runs only the suites of the
 * projects its tasks touched.
 */
export type VerifyRule = {
  match: string
  command: string
  project?: string
}

export type CommandRunner = (command: string, cwd: string) => Promise<{ ok: boolean; output: string }>

export type VerifyCommand = { command: string; cwd: string }

export type VerificationFailure = VerifyCommand & { output: string }

export type VerificationOutcome = { record: VerificationRecord; failures: VerificationFailure[] }

/** Commands for the touched files, deduplicated, in rule order per file. */
export function commandsFor(files: string[], rules: VerifyRule[], cwd: string): VerifyCommand[] {
  const seen = new Map<string, VerifyCommand>()
  for (const entry of files) {
    const file = isAbsolute(entry) ? entry : resolve(cwd, entry)
    const rel = relative(cwd, file).split('\\').join('/')
    for (const rule of rules) {
      if (!matchesGlob(rel, rule.match)) continue
      const project = rule.project ? findUpward(dirname(file), rule.project, cwd) : undefined
      const projectDir = project ? dirname(project) : cwd
      const command = rule.command
        .replaceAll('{project}', project ?? '')
        .replaceAll('{projectDir}', projectDir)
        .replaceAll('{file}', file)
      const dir = project ? projectDir : cwd
      seen.set(`${dir}::${command}`, { command, cwd: dir })
    }
  }
  return [...seen.values()]
}

/** Nearest file matching `pattern` in `start` or its parents, stopping at `root`. */
export function findUpward(start: string, pattern: string, root: string): string | undefined {
  let dir = start
  for (;;) {
    const hit = safeReaddir(dir).find((name) => matchesGlob(name, pattern))
    if (hit) return join(dir, hit)
    if (resolve(dir) === resolve(root)) return undefined
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * The test run is owed: every task is tested and no run has passed since. Read
 * from the board when an implement turn ends, so the fix after a failure is
 * verified again whether or not the implementer moved a marker to get there.
 */
export function verificationDue(tasks: TasksState): boolean {
  return tasks.exists && tasksDone(tasks.tasks) && tasks.verification?.ok !== true
}

export const describeCommand =(c: VerifyCommand, cwd: string): string => `\`${c.command}\` in ${relative(cwd, c.cwd).split('\\').join('/') || '.'}`

/**
 * Runs the test commands the tasks' files select and records the outcome in
 * the tasks file, newest first. No rule matching any file is recorded as
 * passed with nothing run: there was nothing configured to prove, and the
 * record says so.
 */
export async function runVerification(options: {
  cwd: string
  feature: string
  rules: VerifyRule[]
  run: CommandRunner
  now?: string
  /** Output past this size is cut from the front; the tail holds the errors. */
  maxOutputChars?: number
  /** Fires before each command, so the UI can say what is running. */
  onStart?: (command: VerifyCommand) => void
}): Promise<VerificationOutcome> {
  const { cwd, feature, rules, run } = options
  const path = tasksPath(cwd, feature)
  const tasks = await readTasks(path)
  if (!tasks.exists) throw new Error(`No tasks file for "${feature}": nothing to verify.`)
  const commands = commandsFor(taskFiles(tasks.tasks), rules, cwd)
  const failures: VerificationFailure[] = []
  for (const command of commands) {
    options.onStart?.(command)
    const result = await run(command.command, command.cwd)
    if (!result.ok) failures.push({ ...command, output: trimFront(result.output, options.maxOutputChars ?? 8000) })
  }
  const ran = commands.map((c) => describeCommand(c, cwd)).join('; ')
  const record: VerificationRecord = {
    at: options.now ?? new Date().toISOString(),
    ok: failures.length === 0,
    text: failures.length > 0 ? failures.map((f) => describeCommand(f, cwd)).join('; ') : ran || 'nothing to run',
  }
  await recordVerification(path, record)
  return { record, failures }
}

/** The message the implementer gets when the test run failed: the commands, their output, and what to do about it. */
export function verificationHandoffPrompt(feature: string, failures: VerificationFailure[], cwd: string): string {
  const lines = [
    `The test run for "${feature}" failed after every task in \`${tasksFile(feature)}\` was marked tested.`,
    '',
  ]
  for (const failure of failures) {
    lines.push(`${describeCommand(failure, cwd)}:`, '```', failure.output.trim(), '```', '')
  }
  lines.push(
    'Fix what the output names. Mark the tasks it touches ` [in progress]` while you work and ` [tested]` once their tests pass; leave the rest of the board as it is. The run runs again when you stop with every task tested.',
  )
  return lines.join('\n')
}

function trimFront(text: string, max: number): string {
  return text.length <= max ? text : `[...]\n${text.slice(text.length - max)}`
}
