import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { editedPath } from '../edits/edit-tools'
import { ReadTracker } from '../openai-session/tools/read-tracker'
import { describeHand, type FileHands } from './file-hands'
import type { PostToolUseOutcome, PreToolUseOutcome, SessionHooks, ToolUse } from './hooks'

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/**
 * Holds every session that writes — plan, implement, cleanup, chat, on either
 * engine — to the one check: a write to a file this session never read, or
 * that changed on disk since it did, is refused. Added once, unconditionally,
 * so no phase's instructions have to ask for it, and it reaches the Claude
 * engine's native Edit/Write the own loop's inline checks never could,
 * because it runs on the PreToolUse/PostToolUse pair every engine maps onto.
 */
export class StaleWriteGuard implements SessionHooks {
  private readonly files = new ReadTracker()

  constructor(
    private readonly cwd: string,
    private readonly hands: FileHands,
  ) {}

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    const raw = writePath(tool)
    if (!raw) return undefined
    const path = this.abs(raw)
    // Writing a file that does not exist needs no prior read: there is nothing another hand could have changed.
    if (tool.toolName === 'Write' && !existsSync(path)) return undefined
    const reason = await this.files.staleness(path)
    if (!reason) return undefined
    const hand = existsSync(path) ? await this.hands.whoWrote(path, (await stat(path)).mtimeMs) : undefined
    return { deny: `${reason} ${describeHand(hand)}` }
  }

  async postToolUse(tool: ToolUse & { isError: boolean }): Promise<PostToolUseOutcome> {
    if (tool.isError) return undefined
    const raw = writePath(tool) ?? readPath(tool)
    if (!raw) return undefined
    const path = this.abs(raw)
    if (!existsSync(path)) return undefined
    // The session's own write counts as seeing the file, so the next edit in a row is never refused.
    await this.files.markRead(path)
    if (WRITE_TOOLS.has(tool.toolName)) {
      // The content is snapshotted alongside the mtime: verification's foreign-failure narrowing reads it back to tell its own code from another hand's, function by function.
      const text = await readFile(path, 'utf8').catch(() => undefined)
      await this.hands.recordWrite(path, (await stat(path)).mtimeMs, text)
    }
    return undefined
  }

  private abs(path: string): string {
    return isAbsolute(path) ? path : resolve(this.cwd, path)
  }
}

function writePath(tool: ToolUse): string | undefined {
  return WRITE_TOOLS.has(tool.toolName) ? editedPath(tool.input) : undefined
}

function readPath(tool: ToolUse): string | undefined {
  if (tool.toolName !== 'Read') return undefined
  const input = tool.input
  const value = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)['file_path'] : undefined
  return typeof value === 'string' ? value : undefined
}
