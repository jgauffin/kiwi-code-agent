import { isAbsolute, resolve } from 'node:path'
import { readSource } from '../code-structure/source-files'
import type { PostToolUseOutcome, PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { countTests } from '../test-outline/scan'
import { CODE_OUTLINE_TOOL } from './code-outline-tool'
import { CODE_SEARCH_TOOL } from './code-search'
import { outlineFile, type Outline } from './outline'
import { renderFiles } from './render'

/** A file this short costs less to read whole than to take in two calls. */
export const OUTLINE_THRESHOLD_LINES = 200

/** Said in every prompt, so the outline is the model's first move rather than the gate's correction. */
export const CODE_READING = `Find before you read code: ${CODE_OUTLINE_TOOL} outlines a file, folder or glob with line ranges (the tests of test files; the types, functions and doc summaries of other source files; its symbol parameter finds a declaration by name), ${CODE_SEARCH_TOOL} finds text and names the declaration each match sits in, and Read of a long source or test file answers with its outline first; then Read only the line ranges you need. Read every file or range you already know you need in one reply, not one per turn.`

const SUITE_HINT = `${CODE_OUTLINE_TOOL} lists the tests of a file, folder or glob without reading them: use it to see what the rest of the suite already covers.`

/**
 * Answers the first whole-file Read of a long source or test file with its
 * outline, as the docs gate does for markdown; a second whole-file Read goes
 * through. A shorter test file is read as asked, and the first such Read in a
 * session mentions the suite outline once.
 */
export class CodeOutlineGate implements SessionHooks {
  private readonly outlined = new Set<string>()
  private hinted = false

  constructor(private readonly cwd: string) {}

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    const input = inputOf(tool)
    const path = readPath(tool, input)
    if (!path || input['offset'] !== undefined || input['limit'] !== undefined) return undefined
    const full = this.resolve(path)
    if (this.outlined.has(full)) return undefined
    const file = await outlined(full)
    if (!file || file.lines <= OUTLINE_THRESHOLD_LINES) return undefined
    this.outlined.add(full)
    const tests = 'tests' in file.outline ? countTests(file.outline.tests) : undefined
    if (tests !== undefined) this.hinted = true
    return {
      deny: [
        `${path} has ${file.lines} lines${tests !== undefined ? ` and ${tests} tests` : ''}. Its outline instead of the whole file:`,
        '',
        renderFiles([{ path, ...file.outline }], []),
        '',
        'Read a line range (offset and limit) for what you need, or Read it again for the whole file.',
        ...(tests !== undefined ? [SUITE_HINT] : []),
      ].join('\n'),
    }
  }

  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome> {
    const path = readPath(tool, inputOf(tool))
    if (this.hinted || tool.isError || !path) return undefined
    const file = await outlined(this.resolve(path))
    if (!file || !('tests' in file.outline)) return undefined
    this.hinted = true
    return { additionalContext: SUITE_HINT }
  }

  private resolve(path: string): string {
    return isAbsolute(path) ? path : resolve(this.cwd, path)
  }
}

const inputOf = (tool: ToolUse): Record<string, unknown> => (typeof tool.input === 'object' && tool.input !== null ? (tool.input as Record<string, unknown>) : {})

function readPath(tool: ToolUse, input: Record<string, unknown>): string | undefined {
  if (tool.toolName !== 'Read') return undefined
  return typeof input['file_path'] === 'string' ? input['file_path'] : undefined
}

/** The file's outline and length. A file that cannot be read is Read's to report. */
async function outlined(full: string): Promise<{ outline: Outline; lines: number } | undefined> {
  const text = await readSource(full).catch(() => undefined)
  if (text === undefined) return undefined
  const outline = outlineFile(full, text)
  return outline ? { outline, lines: text.split(/\r?\n/).length } : undefined
}
