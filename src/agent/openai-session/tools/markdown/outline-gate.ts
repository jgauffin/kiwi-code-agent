import { readFile } from 'node:fs/promises'
import { isAbsolute, matchesGlob, relative, resolve } from 'node:path'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../../../session/hooks'
import { formatOutline, isMarkdown, markdownLines } from './outline'

/** A doc this short costs less to read whole than to take in two calls. */
export const OUTLINE_THRESHOLD_LINES = 200

/** Said in every prompt, so the ranged read is the model's first move rather than the gate's correction. */
export const DOC_READING =
  "Find before you read docs: MarkdownSearch gives each match with the section it sits in, and Read of a long markdown file answers with its outline first; then Read only the section's line range. Read every doc or section you already know you need in one reply, not one per turn."

/**
 * Answers the first whole-file Read of a long markdown doc with its outline.
 * The model reaches for Read, not for a tool it has to remember, so the
 * outline is put where it already goes. A second whole-file Read of the same
 * doc goes through: the model asked for all of it knowing what that costs.
 *
 * One gate per session, and it runs after the scope checks, so a doc the
 * session may not read is denied by them before its outline is built.
 * `exempt` globs name docs that are read whole by design: a spec is the work,
 * not a reference to look something up in.
 */
export class OutlineGate implements SessionHooks {
  private readonly outlined = new Set<string>()

  constructor(
    private readonly cwd: string,
    private readonly exempt: string[] = [],
  ) {}

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    if (tool.toolName !== 'Read') return undefined
    const input = (typeof tool.input === 'object' && tool.input !== null ? tool.input : {}) as Record<string, unknown>
    const raw = input['file_path']
    if (typeof raw !== 'string' || !isMarkdown(raw)) return undefined
    if (input['offset'] !== undefined || input['limit'] !== undefined) return undefined
    const path = isAbsolute(raw) ? raw : resolve(this.cwd, raw)
    if (this.outlined.has(path)) return undefined
    const rel = relative(this.cwd, path).split('\\').join('/')
    if (this.exempt.some((glob) => matchesGlob(rel, glob))) return undefined
    // An unreadable file is Read's to report.
    const text = await readFile(path, 'utf8').catch(() => undefined)
    if (text === undefined || markdownLines(text).length <= OUTLINE_THRESHOLD_LINES) return undefined
    this.outlined.add(path)
    return {
      deny: [
        formatOutline(raw, text),
        '',
        'This doc is long, so here is its outline instead of the text. Read the section you need with offset (its first line) and limit (its line count). Read the file again without offset and limit only if you need all of it.',
      ].join('\n'),
    }
  }
}
