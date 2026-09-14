import { readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from 'node:path'
import type {
  PostToolUseOutcome,
  SessionHooks,
  StopOutcome,
  ToolUse,
  VerificationResult,
  VerificationStarted,
} from '../session/hooks'

/**
 * A rule says which files, when edited, make which command run, and where.
 * `{project}` in the command is the nearest file matching `project` above the
 * edited file; `{projectDir}` is its directory. Without `project`, the
 * command runs in the workspace root.
 */
export type VerifyRule = {
  match: string
  command: string
  project?: string
}

export type CommandRunner = (command: string, cwd: string) => Promise<{ ok: boolean; output: string }>

export type TurnVerifierOptions = {
  cwd: string
  rules: VerifyRule[]
  run: CommandRunner
  /** Consecutive failed verifications before the model is allowed to stop anyway. */
  failureBudget?: number
  /** Output past this size is cut from the front; the tail holds the errors. */
  maxOutputChars?: number
}

const EDITING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * Verification at the turn boundary rather than per edit: edits are cheap,
 * builds are not, and a model usually touches several files before it is
 * done. When the model wants to stop, every project it touched gets its
 * command run; errors go back and the stop is blocked, up to the budget.
 */
export class TurnVerifier implements SessionHooks {
  private readonly touched = new Set<string>()
  private consecutiveFailures = 0
  /**
   * Off until the user turns it on: while a plan is still being discussed,
   * a build loop that forces the model to keep going only burns tokens.
   * Edits are tracked regardless, so enabling later verifies all of them.
   */
  enabled = false

  constructor(private readonly options: TurnVerifierOptions) {}

  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome> {
    if (tool.isError || !EDITING_TOOLS.has(tool.toolName)) return undefined
    const path = filePathOf(tool.input)
    if (path) this.touched.add(isAbsolute(path) ? path : resolve(this.options.cwd, path))
    return undefined
  }

  async stop(onStarted: (started: VerificationStarted) => void = () => {}): Promise<StopOutcome> {
    if (!this.enabled) return undefined
    const commands = this.plan()
    this.touched.clear()
    if (commands.length === 0) return undefined
    const verifications: VerificationResult[] = []
    for (const { command, cwd } of commands) {
      onStarted({ command, cwd })
      const result = await this.options.run(command, cwd)
      verifications.push({ command, cwd, ok: result.ok, output: trimFront(result.output, this.options.maxOutputChars ?? 8000) })
    }
    const failed = verifications.filter((v) => !v.ok)
    if (failed.length === 0) {
      this.consecutiveFailures = 0
      return { verifications }
    }
    this.consecutiveFailures++
    const budget = this.options.failureBudget ?? 3
    if (this.consecutiveFailures > budget) {
      this.consecutiveFailures = 0
      return { verifications }
    }
    const block = failed
      .map((v) => `Verification failed (${this.consecutiveFailures}/${budget}): \`${v.command}\` in ${v.cwd}\n${v.output}`)
      .join('\n\n')
    return { verifications, block: `${block}\n\nFix the errors above. Do not stop until the verification passes.` }
  }

  /** Commands to run for the touched files, deduplicated. */
  private plan(): { command: string; cwd: string }[] {
    const seen = new Map<string, { command: string; cwd: string }>()
    for (const file of this.touched) {
      const rel = relative(this.options.cwd, file).split('\\').join('/')
      for (const rule of this.options.rules) {
        if (!matchesGlob(rel, rule.match)) continue
        const project = rule.project ? findUpward(dirname(file), rule.project, this.options.cwd) : undefined
        const projectDir = project ? dirname(project) : this.options.cwd
        const command = rule.command
          .replaceAll('{project}', project ?? '')
          .replaceAll('{projectDir}', projectDir)
          .replaceAll('{file}', file)
        const cwd = project ? projectDir : this.options.cwd
        seen.set(`${cwd}::${command}`, { command, cwd })
      }
    }
    return [...seen.values()]
  }
}

function filePathOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const record = input as Record<string, unknown>
  const value = record['file_path'] ?? record['notebook_path']
  return typeof value === 'string' ? value : undefined
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

function trimFront(text: string, max: number): string {
  return text.length <= max ? text : `[...]\n${text.slice(text.length - max)}`
}
