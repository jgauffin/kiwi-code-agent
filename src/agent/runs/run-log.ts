import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { KIWI_DIR } from '../kiwi-dir'
import type { SessionEvent } from '../session/code-session'
import { sealEvent, unsealEvent } from './seal'

export type RunLogEntry = { at: string; event: SessionEvent }

/**
 * Append-only JSONL of every event a session produced, one file per session
 * under `.kiwi/runs/<session id>/events.jsonl`. The transcript view is
 * rebuilt from it after a reload, and later phases read it for observability.
 *
 * Writes are chained so entries land in emission order even when the caller
 * does not await.
 */
export class RunLog {
  private chain: Promise<void> = Promise.resolve()

  /** The session's run directory; what belongs to this run and not to the workspace lives here. */
  constructor(readonly dir: string) {}

  static forSession(workspaceRoot: string, sessionId: string): RunLog {
    return new RunLog(join(workspaceRoot, KIWI_DIR, 'runs', sessionId))
  }

  get path(): string {
    return join(this.dir, 'events.jsonl')
  }

  /** Resolves once every append queued so far has landed, so a read sees them. */
  settled(): Promise<void> {
    return this.chain
  }

  append(event: SessionEvent): Promise<void> {
    const entry: RunLogEntry = { at: new Date().toISOString(), event: sealEvent(event) }
    this.chain = this.chain.then(async () => {
      await mkdir(this.dir, { recursive: true })
      await appendFile(this.path, JSON.stringify(entry) + '\n', 'utf8')
    })
    return this.chain
  }

  async read(): Promise<RunLogEntry[]> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return []
      throw error
    }
    return text
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const entry = JSON.parse(line) as RunLogEntry
        return { ...entry, event: unsealEvent(entry.event) }
      })
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
