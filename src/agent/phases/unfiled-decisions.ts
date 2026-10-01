import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { PostToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { WRITES_NAMED_FILE } from '../permissions/tool-classes'
import { readOptional } from '../workspace-files'

/**
 * Decisions the user made outside a plan session, in an implement run's
 * question or in chat, that reach features other than the one at hand. A blind
 * planner reads this file with the specs, so what was decided is not decided
 * again before the filing session has moved each entry into the specs and
 * docs it belongs in. Committed, since it is intent.
 */
export const UNFILED_FILE = 'specs/unfiled-decisions.md'

/** What an unfiled decision is and how an entry is written; each session adds where its own decisions go. */
export const UNFILED_DECISIONS = `A decision the user makes in this conversation is worth recording when a planner, reading only the docs and the specs and never the code, could decide it otherwise: what the product does, or a constraint every feature has to respect, such as which identity provider owns sign-in. A build choice the code already shows is not one. Record it in the product's language, with no source path or symbol: it is read by a planner who never sees the code. An entry in \`${UNFILED_FILE}\` is \`### Title\`, then \`- decided: <the decision, one sentence>\` and \`- affects: <the features it reaches by name, and docs when no spec holds it yet, comma separated>\`. Add yours with Edit, or create the file with Write, and leave the other entries alone.`

/** Chat belongs to no feature, so whatever it settles waits in the unfiled file. */
export const CHAT_DECISIONS = `When the user settles something about the product in this conversation, record it as unfiled: ${UNFILED_DECISIONS}`

export type UnfiledDecision = {
  /** The `###` heading. */
  title: string
  decided: string
  /** Features by name, and `docs` for what no spec holds yet. */
  affects: string[]
}

const TITLE = /^#{1,2}\s+/
const HEADING = /^###\s+(.*?)\s*$/
const META = /^-\s+(decided|affects)\s*:\s*(.*)$/i

/** Problems name their line counting from one, as the model reads the file. */
export function parseUnfiled(text: string): { entries: UnfiledDecision[]; problems: string[] } {
  const entries: UnfiledDecision[] = []
  const problems: string[] = []
  let current: { entry: UnfiledDecision; line: number } | undefined
  const close = (): void => {
    if (current && !current.entry.decided) problems.push(`line ${current.line}: "${current.entry.title}" has no decided line.`)
    current = undefined
  }
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    const number = index + 1
    if (line.length === 0) continue
    if (TITLE.test(line)) {
      close()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      close()
      current = { entry: { title: heading[1]!, decided: '', affects: [] }, line: number }
      entries.push(current.entry)
      continue
    }
    const meta = current ? META.exec(line) : null
    if (!current || !meta) {
      problems.push(`line ${number}: "${line}": an entry is a \`### Title\` with decided and affects lines only.`)
      continue
    }
    const value = meta[2]!.trim()
    if (meta[1]!.toLowerCase() === 'decided') current.entry.decided = value
    else current.entry.affects = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  }
  close()
  problems.sort((a, b) => lineOf(a) - lineOf(b))
  return { entries, problems }
}

const lineOf = (problem: string): number => Number(/^line (\d+):/.exec(problem)?.[1] ?? 0)

/** The workspace's unfiled decisions; none when the file does not exist. */
export async function readUnfiled(cwd: string): Promise<UnfiledDecision[]> {
  const text = await readOptional(join(cwd, UNFILED_FILE))
  return text === undefined ? [] : parseUnfiled(text).entries
}

/** Tells the model, right after it wrote the file, what does not fit an entry's shape, so it fixes it in the same turn. */
export class UnfiledContract implements SessionHooks {
  constructor(private readonly cwd: string) {}

  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome> {
    if (tool.isError || !WRITES_NAMED_FILE.has(tool.toolName)) return undefined
    const input = (typeof tool.input === 'object' && tool.input !== null ? tool.input : {}) as Record<string, unknown>
    const raw = input['file_path']
    if (typeof raw !== 'string') return undefined
    const path = isAbsolute(raw) ? raw : resolve(this.cwd, raw)
    if (relative(this.cwd, path).split('\\').join('/') !== UNFILED_FILE) return undefined
    const { problems } = parseUnfiled(await readFile(path, 'utf8'))
    if (problems.length === 0) return undefined
    return {
      additionalContext: [
        `\`${UNFILED_FILE}\` is off shape. Fix it before you stop:`,
        ...problems.map((p) => `- ${p}`),
        '',
        'An entry: `### Title`, then `- decided: ...` and `- affects: ...`. Nothing else.',
      ].join('\n'),
    }
  }
}
