import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import type { SessionEvent } from '../session/code-session'
import type { Ground } from './evaluator'
import type { KeptGrant } from './grants'
import { judgeCall, type CallContext, type CallJudgement } from './judge-call'
import { isWithin, normalizePlace } from './places'
import { NO_PROJECT_COMMANDS, type ProjectCommands } from './project-commands'
import { readOnlyTools, type ReadOnlyTools } from './tool-classes'
import { isRulesFile, isTrustFile } from './trust-files'

/** The kept answers in force for one session, every scope together, and the switch that refuses git writes. */
export type PermissionRules = { grants: readonly KeptGrant[]; denyGitWrites?: boolean }

/** What the policy has to ask the session about, beyond the rules themselves. */
export type PolicyContext = {
  /** Which tools only look. Without it only the engine's built-ins are known, so everything else is asked about. */
  readOnly?: ReadOnlyTools
  /** The commands the project defines for itself; they run without a prompt. */
  project?: () => ProjectCommands
  /** Is the session's "Allow writes" switch on? */
  writesAllowed?: () => boolean
  /** The session's scratch folder, project-relative: written without a prompt whatever the switch says. */
  scratch?: string
  /** Files and folders outside the project the session may read unasked: where its own instructions and its engine's command output live. */
  readable?: readonly string[]
  /** Files and folders outside the project the session writes unasked: where it is told to keep its memory notes. */
  writable?: readonly string[]
  /** Files where permission rules are kept outside the workspace: a write to one is always asked. */
  rulesFiles?: readonly string[]
  /** The person's home folder: what `~` stands for, and the ground no kept answer may reach. */
  home?: string
  /** Is this path one the repository ignores? Read from git by default. */
  ignored?: (path: string) => boolean
  /** Could git bring back everything a delete at this path removes? Read from git by default. */
  recoverable?: (path: string) => boolean
}

/**
 * Decides tool calls before any permission prompt, on every engine. Each call
 * is judged as the effects it would have; a kept denial refuses it, a call
 * every effect of which the ground or a kept allow covers runs unasked, and
 * anything else is put to the person. Everything it consults is read on each
 * call, so an answer just kept, a script just added or the switch just turned
 * on applies to the next call.
 */
export class PermissionPolicy implements SessionHooks {
  private readonly root: string
  private readonly readOnly: ReadOnlyTools
  private readonly project: () => ProjectCommands
  private readonly writesAllowed: () => boolean
  private readonly home: string
  private readonly ignored: (path: string) => boolean
  private readonly recoverable: (path: string) => boolean
  /** Where the engine's shell stood for each call, so its prompt is judged from the same place. */
  private readonly standing = new Map<string, string>()

  constructor(
    cwd: string,
    private readonly rules: () => PermissionRules,
    private readonly context: PolicyContext = {},
  ) {
    this.root = normalizePlace(cwd)
    this.readOnly = context.readOnly ?? readOnlyTools(() => [])
    this.project = context.project ?? (() => NO_PROJECT_COMMANDS)
    this.writesAllowed = context.writesAllowed ?? (() => false)
    this.home = normalizePlace(context.home ?? homedir())
    this.ignored = context.ignored ?? ((path) => gitIgnores(cwd, path))
    this.recoverable = context.recoverable ?? ((path) => gitCanRestore(cwd, path))
  }

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    if (tool.cwd !== undefined) this.standing.set(tool.toolUseId, tool.cwd)
    const judged = this.judge(tool.toolName, tool.input, tool.cwd, tool.agent)
    if (judged.decision === 'refused') return { deny: refusalText(judged) }
    if (judged.decision === 'passes') return { allow: true }
    return { ask: true }
  }

  /** A prompt lists the call as rows, one per effect, each with what the rules make of it. */
  decorate(event: SessionEvent): SessionEvent {
    if (event.type !== 'permission_request') return event
    const cwd = event.toolUseId !== undefined ? this.standing.get(event.toolUseId) : undefined
    return { ...event, rows: this.judge(event.toolName, event.input, cwd).rows }
  }

  /** The call judged from where the shell stands, or the workspace root, and inside which sub agent, if any. */
  judge(toolName: string, input: unknown, cwd: string | undefined, agent?: string): CallJudgement {
    const { grants, denyGitWrites } = this.rules()
    return judgeCall(toolName, input, cwd ?? this.root, this.callContext(grants, denyGitWrites ?? false), agent)
  }

  private callContext(grants: readonly KeptGrant[], denyGitWrites: boolean): CallContext {
    const scratch = this.context.scratch
    const rulesFiles = (this.context.rulesFiles ?? []).map(normalizePlace)
    const ground: Ground = {
      workspace: this.root,
      readable: (this.context.readable ?? []).map((p) => normalizePlace(isAbsolute(p) ? p : `${this.root}/${p}`)),
      writable: (this.context.writable ?? []).map((p) => normalizePlace(isAbsolute(p) ? p : `${this.root}/${p}`)),
      ...(scratch !== undefined ? { scratch: normalizePlace(isAbsolute(scratch) ? scratch : `${this.root}/${scratch}`) } : {}),
      writesAllowed: this.writesAllowed(),
      ignored: this.ignored,
      recoverable: this.recoverable,
      trusted: (path) => (isWithin(this.root, path) && isTrustFile(relativeTo(this.root, path))) || isRulesFile(path, rulesFiles),
      denyGitWrites,
      home: this.home,
    }
    return { grants, ground, home: this.home, exists, project: this.project(), tools: { readOnly: this.readOnly } }
  }
}

/** The reason the model is told a call was refused, naming each refused part. */
function refusalText(judged: CallJudgement): string {
  return judged.rows
    .filter((row) => row.verdict === 'refused')
    .map((row) => `\`${row.text}\` ${row.reason}`)
    .join('; ')
}

function exists(path: string): 'file' | 'directory' | undefined {
  try {
    const stat = statSync(path)
    return stat.isDirectory() ? 'directory' : 'file'
  } catch {
    // Absent, or out of reach: either way there is nothing there a write would replace.
    return undefined
  }
}

/** Does git ignore this path in the workspace's repository? A path outside it, or a failed check, is not ignored. */
function gitIgnores(cwd: string, path: string): boolean {
  const result = spawnSync('git', ['check-ignore', '-q', '--', path], { cwd, timeout: 3000, windowsHide: true })
  return result.status === 0
}

/**
 * Could git bring back everything at this path? Nothing there is untracked or
 * changed: `git status` lists neither, while what git ignores it leaves out.
 * A path outside the repository, or a failed check, is not.
 */
function gitCanRestore(cwd: string, path: string): boolean {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', path], { cwd, timeout: 5000, windowsHide: true, encoding: 'utf8' })
  return result.status === 0 && result.stdout.trim() === ''
}

function isAbsolute(path: string): boolean {
  return /^([\\/]|[A-Za-z]:)/.test(path)
}

function relativeTo(root: string, path: string): string {
  return path.length === root.length ? '' : path.slice(root.length + (root.endsWith('/') ? 0 : 1))
}
