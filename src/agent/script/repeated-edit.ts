import { editedPath } from '../edits/edit-tools'
import type { PostToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'

/** Files with the same change before RunScript is pointed out: "more than a couple". */
const FILES_BEFORE_NOTE = 3

type TextEdit = { old_string?: unknown; new_string?: unknown }

/**
 * Notes, once per change, that the model is making the same edit file after
 * file. Two edits are the same change when what they remove and insert match
 * once the context around it is stripped, so `const u = getUser(id)` and
 * `return getUser(x)` both count as `get` becoming `fetch`.
 */
export class RepeatedEdit implements SessionHooks {
  private readonly filesByChange = new Map<string, string[]>()
  private readonly noted = new Set<string>()

  async postToolUse(tool: ToolUse & { isError: boolean }): Promise<PostToolUseOutcome> {
    if (tool.isError) return undefined
    const path = editedPath(tool.input)?.split('\\').join('/')
    if (!path) return undefined
    for (const change of changesOf(tool)) {
      const files = this.filesByChange.get(change) ?? []
      if (!files.includes(path)) files.push(path)
      this.filesByChange.set(change, files)
      if (files.length < FILES_BEFORE_NOTE || this.noted.has(change)) continue
      this.noted.add(change)
      const earlier = files.filter((f) => f !== path).join(', ')
      return {
        additionalContext: `This is the change you made in ${earlier}. If more files need it, one RunScript with replace() makes it in all of them and shows the user one diff.`,
      }
    }
    return undefined
  }
}

function changesOf(tool: ToolUse): string[] {
  const input = (tool.input ?? {}) as TextEdit & { edits?: unknown }
  const edits: TextEdit[] = tool.toolName === 'Edit' ? [input] : tool.toolName === 'MultiEdit' && Array.isArray(input.edits) ? input.edits : []
  return edits.flatMap((e) => (typeof e.old_string === 'string' && typeof e.new_string === 'string' ? [core(e.old_string, e.new_string)] : []))
}

/** What the edit removes and inserts, without the text the two sides share at either end. */
function core(before: string, after: string): string {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  return `${before.slice(start, before.length - end)}\u0000${after.slice(start, after.length - end)}`
}
