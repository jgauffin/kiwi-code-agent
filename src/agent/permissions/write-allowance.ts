import { isAbsolute, relative, resolve } from 'node:path'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { TRANSFER_TOOLS, WRITE_TOOLS } from './permission-rules'

/**
 * The session's "Allow writes" switch: while it is on, file writes go through
 * without a prompt. A move or copy passes only when both ends lie inside the
 * project, so the switch never carries files in or out of it. Composed after
 * the permission policy and a phase's scope guard, so a deny from either
 * still blocks the write.
 */
export class WriteAllowance implements SessionHooks {
  constructor(
    private readonly cwd: string,
    private readonly enabled: () => boolean,
  ) {}

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    if (!WRITE_TOOLS.has(tool.toolName) || !this.enabled()) return undefined
    if (!TRANSFER_TOOLS.has(tool.toolName)) return { allow: true }
    const input = (tool.input ?? {}) as Record<string, unknown>
    return [input['source'], input['destination']].every((p) => this.insideProject(p)) ? { allow: true } : undefined
  }

  /** Strictly below the project root: the root itself is not a file to move. */
  private insideProject(path: unknown): boolean {
    if (typeof path !== 'string') return false
    const rel = relative(this.cwd, isAbsolute(path) ? path : resolve(this.cwd, path))
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  }
}
