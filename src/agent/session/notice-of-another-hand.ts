import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { editedPath } from '../edits/edit-tools'
import { describeHand, type FileHands } from './file-hands'
import type { PostToolUseOutcome, SessionHooks, ToolUse } from './hooks'

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/**
 * Tells a session, as a one-line tail on its next tool result, when another
 * hand changed a file this session has written or read: the file may never
 * come up again on its own, so nothing else would surface the change while
 * the turn is still in play. Added once per session, alongside
 * StaleWriteGuard, so it runs on the same PostToolUse every tool call takes,
 * not only on a write attempt against the changed file itself.
 */
export class NoticeOfAnotherHand implements SessionHooks {
  /** What this session last saw of each file it has read or written, absolute path to mtime. */
  private readonly seenAt = new Map<string, number>()
  /** Files already reported since this session last saw them; seeing the file again clears it, so a further change can be reported too. */
  private readonly notified = new Set<string>()

  constructor(
    private readonly cwd: string,
    private readonly hands: FileHands,
  ) {}

  async postToolUse(tool: ToolUse & { isError: boolean }): Promise<PostToolUseOutcome> {
    if (!tool.isError) await this.see(tool)
    const changed = await this.sweep()
    if (changed.length === 0) return undefined
    if (changed.length === 1) {
      const [path, mtimeMs] = changed[0]!
      const hand = await this.hands.handFor(path, mtimeMs)
      return { additionalContext: `Notice: ${this.rel(path)} changed since you last saw it. ${describeHand(hand)}` }
    }
    return { additionalContext: `Notice: ${changed.length} files changed since you last saw them.` }
  }

  /** A read, or (per "Own writes are seeing") this session's own write, counts as seeing the file: tracking starts fresh and any pending notice on it is cleared. */
  private async see(tool: ToolUse): Promise<void> {
    const raw = seenPath(tool)
    if (!raw) return
    const path = this.abs(raw)
    if (!existsSync(path)) return
    this.seenAt.set(path, (await stat(path)).mtimeMs)
    this.notified.delete(path)
  }

  /**
   * Every seen file not yet reported whose mtime moved since this session
   * last saw it, with the mtime that moved it. `seenAt` is left as it was:
   * only truly seeing the file again (`see`) counts as seeing it, so a
   * further drift while unnotified stays folded into the one pending notice.
   */
  private async sweep(): Promise<[path: string, mtimeMs: number][]> {
    const changed: [string, number][] = []
    for (const [path, mtimeMs] of this.seenAt) {
      if (this.notified.has(path) || !existsSync(path)) continue
      const current = (await stat(path)).mtimeMs
      if (current === mtimeMs) continue
      this.notified.add(path)
      changed.push([path, current])
    }
    return changed
  }

  private abs(path: string): string {
    return isAbsolute(path) ? path : resolve(this.cwd, path)
  }

  private rel(path: string): string {
    return relative(this.cwd, path).split('\\').join('/')
  }
}

function seenPath(tool: ToolUse): string | undefined {
  if (WRITE_TOOLS.has(tool.toolName)) return editedPath(tool.input)
  if (tool.toolName !== 'Read') return undefined
  const input = tool.input
  const value = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)['file_path'] : undefined
  return typeof value === 'string' ? value : undefined
}
