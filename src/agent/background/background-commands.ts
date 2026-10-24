import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findBash, killProcessTree } from '../shell/run-shell'
import { scratchDir } from '../scratch/scratch-folder'

/** A command a session started and left running: what it ran, what the model said it was for, and where its output lands. */
export type BackgroundCommand = {
  id: string
  command: string
  purpose: string
  /** Workspace-relative, inside the session's scratch folder. */
  outputFile: string
}

/** How a command that exited on its own ended, with the last of what it printed. */
export type BackgroundEnd = BackgroundCommand & { exitCode: number | null; tail: string }

export type BackgroundEvent =
  | { kind: 'started'; command: BackgroundCommand }
  | { kind: 'ended'; end: BackgroundEnd }
  /** Stopped by the person, by the model or by the session ending; it is never told to the session. */
  | { kind: 'stopped'; command: BackgroundCommand }

/** Lines of output a notice carries; the rest is in the file. */
const TAIL_LINES = 20
const TAIL_CHARS = 4000

type Running = { info: BackgroundCommand; child: ChildProcess; stopped: boolean; silent: boolean; exited: Promise<number | null> }

/** A command a wait can follow: its output so far, and how it ended once it has. */
export type Watched = { info: BackgroundCommand; output: () => string; exited: Promise<number | null> }

/**
 * The commands sessions run in the background. It lives outside any engine, so
 * a session that changes model or engine keeps its commands and hears of them
 * ending on the engine it runs then. A command's output goes straight to a file
 * in the session's scratch folder, where the session reads it like any file.
 */
export class BackgroundCommands {
  private readonly running = new Map<string, Map<string, Running>>()
  /** Per session, the commands that exited and have not been told yet. */
  private readonly ended = new Map<string, BackgroundEnd[]>()

  constructor(
    private readonly workspaceRoot: string,
    private readonly onEvent: (sessionId: string, event: BackgroundEvent) => void,
    private readonly bashPath: string = findBash(),
  ) {}

  start(sessionId: string, command: string, purpose: string, cwd: string): BackgroundCommand {
    const dir = scratchDir(sessionId)
    mkdirSync(join(this.workspaceRoot, dir), { recursive: true })
    const id = this.freeId(sessionId, dir)
    const info: BackgroundCommand = { id, command, purpose, outputFile: `${dir}/${id}.log` }
    const file = join(this.workspaceRoot, info.outputFile)
    // Opened for writing, not appending: on Windows an append-only handle is refused by the shell's own runtime and nothing is written. The id is unused, so the file is new.
    const fd = openSync(file, 'w')
    const child = spawn(this.bashPath, ['-lc', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    closeSync(fd)
    let settle: (code: number | null) => void = () => undefined
    const exited = new Promise<number | null>((resolve) => (settle = resolve))
    const entry: Running = { info, child, stopped: false, silent: false, exited }
    this.of(sessionId).set(id, entry)
    let finished = false
    const finish = (code: number | null) => {
      if (finished) return
      finished = true
      this.of(sessionId).delete(id)
      try {
        if (entry.silent) return
        if (entry.stopped) return this.onEvent(sessionId, { kind: 'stopped', command: info })
        const end: BackgroundEnd = { ...info, exitCode: code, tail: tailOf(file) }
        this.ended.set(sessionId, [...(this.ended.get(sessionId) ?? []), end])
        this.onEvent(sessionId, { kind: 'ended', end })
      } finally {
        // After the end is recorded, so a wait that wakes on it can claim it.
        settle(code)
      }
    }
    child.on('error', (error) => {
      appendFileSync(file, `Cannot run bash (${this.bashPath}): ${error.message}\n`)
      finish(null)
    })
    child.on('exit', (code) => finish(code))
    this.onEvent(sessionId, { kind: 'started', command: info })
    return info
  }

  /** The commands the session has running now, oldest first. */
  runningOf(sessionId: string): BackgroundCommand[] {
    return [...this.of(sessionId).values()].map((r) => r.info)
  }

  /**
   * A command a wait can follow: one still running, or one that exited and has
   * not been told to the session yet. Undefined when the session has none by that id.
   */
  watch(sessionId: string, id: string): Watched | undefined {
    const entry = this.of(sessionId).get(id)
    const read = (outputFile: string) => () => {
      try {
        return readFileSync(join(this.workspaceRoot, outputFile), 'utf8')
      } catch {
        return ''
      }
    }
    if (entry) return { info: entry.info, output: read(entry.info.outputFile), exited: entry.exited }
    const end = this.ended.get(sessionId)?.find((e) => e.id === id)
    return end ? { info: end, output: read(end.outputFile), exited: Promise.resolve(end.exitCode) } : undefined
  }

  /** The wait has told the session how the command ended, so the notice would only say it twice. */
  claimEnd(sessionId: string, id: string): void {
    const rest = (this.ended.get(sessionId) ?? []).filter((e) => e.id !== id)
    if (rest.length > 0) this.ended.set(sessionId, rest)
    else this.ended.delete(sessionId)
  }

  /** Stops one running command; false when the session has none by that id. */
  stop(sessionId: string, id: string): boolean {
    const entry = this.of(sessionId).get(id)
    if (!entry) return false
    entry.stopped = true
    killProcessTree(entry.child)
    return true
  }

  /** The session is over: everything it started stops and nothing is ever told of it. */
  endSession(sessionId: string): void {
    this.ended.delete(sessionId)
    for (const entry of this.of(sessionId).values()) {
      entry.stopped = true
      killProcessTree(entry.child)
    }
  }

  /** The window goes away: every command stops without a word, so the next window can tell the sessions which were cut. */
  cutAll(): void {
    this.ended.clear()
    for (const sessions of this.running.values())
      for (const entry of sessions.values()) {
        entry.silent = true
        killProcessTree(entry.child)
      }
    this.running.clear()
  }

  hasEnded(sessionId: string): boolean {
    return (this.ended.get(sessionId)?.length ?? 0) > 0
  }

  /** Every command that exited since the session was last told, handed out once. */
  takeEnded(sessionId: string): BackgroundEnd[] {
    const ended = this.ended.get(sessionId) ?? []
    this.ended.delete(sessionId)
    return ended
  }

  private of(sessionId: string): Map<string, Running> {
    let sessions = this.running.get(sessionId)
    if (!sessions) this.running.set(sessionId, (sessions = new Map()))
    return sessions
  }

  /** An id no earlier command of the session, in this window or a previous one, wrote its output under. */
  private freeId(sessionId: string, dir: string): string {
    for (let n = 1; ; n++) {
      const id = `bg${n}`
      if (!this.of(sessionId).has(id) && !existsSync(join(this.workspaceRoot, `${dir}/${id}.log`))) return id
    }
  }
}

function tailOf(file: string): string {
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  const lines = text.trimEnd().split(/\r?\n/)
  const tail = lines.slice(-TAIL_LINES).join('\n')
  return tail.length > TAIL_CHARS ? tail.slice(-TAIL_CHARS) : tail
}

const exitText = (code: number | null): string => (code === null ? 'it could not be run' : `exit code ${code}`)

/** What the session is told when commands exited: each one's id, what it ran and was for, how it ended, the last of its output and where all of it is. */
export function describeEnds(ends: readonly BackgroundEnd[]): string {
  const parts = ends.map((e) =>
    [
      `Background command ${e.id} ended with ${exitText(e.exitCode)}.`,
      `Command: ${e.command}`,
      `Started for: ${e.purpose}`,
      `Full output: ${e.outputFile}`,
      e.tail ? `Last lines of output:\n${e.tail}` : 'It printed nothing.',
    ].join('\n'),
  )
  return `Notice: ${parts.join('\n\n')}`
}

/** What the session is told when the window went away under commands it had running. */
export function describeCut(cut: readonly BackgroundCommand[]): string {
  const lines = cut.map((c) => `- ${c.id}: ${c.command} (started for: ${c.purpose}); its output so far is in ${c.outputFile}`)
  return `Notice: the window was reloaded, which stopped ${cut.length === 1 ? 'a background command' : `${cut.length} background commands`}:\n${lines.join('\n')}`
}
