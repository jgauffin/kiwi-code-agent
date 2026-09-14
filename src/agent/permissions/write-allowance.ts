import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { WRITE_TOOLS } from './permission-rules'

/**
 * The session's "Allow writes" switch: while it is on, file writes go through
 * without a prompt. Composed after the permission policy and a phase's scope
 * guard, so a deny from either still blocks the write.
 */
export class WriteAllowance implements SessionHooks {
  constructor(private readonly enabled: () => boolean) {}

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    return WRITE_TOOLS.has(tool.toolName) && this.enabled() ? { allow: true } : undefined
  }
}
