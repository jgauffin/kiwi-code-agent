import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { PostToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { WRITES_NAMED_FILE } from '../permissions/tool-classes'
import { readOptional } from '../workspace-files'

/**
 * Decisions the user made outside a plan session, in an implement run's
 * question or in chat, that reach beyond the work at hand. A blind planner
 * reads both files with the specs, so what was decided is not decided again
 * before the filing session has moved each entry where it belongs. Committed,
 * since they are intent.
 *
 * Two files, because the two are filed differently: how the product works
 * becomes a rule in the specs it reaches, while work decided for later is
 * intent to plan a feature from, and in a spec would be read as delivered.
 */
export const UNFILED_FILE = 'specs/unfiled-decisions.md'

/** Work the user decided on for later: filed into the docs as a feature to plan, never into a spec as a rule. */
export const FUTURE_FILE = 'specs/future-work.md'

/** Both files, for a scope that reads or writes decisions. */
export const DECISION_FILES = [UNFILED_FILE, FUTURE_FILE]

/** What an unfiled decision is, which file it goes in and how an entry is written; each session adds where its own decisions go. */
export const UNFILED_DECISIONS = `A decision the user makes in this conversation is worth recording when a planner, reading only the docs and the specs and never the code, could decide it otherwise: what the product does, or a constraint every feature has to respect, such as which identity provider owns sign-in. A build choice the code already shows is not one. Record it in the product's language, with no source path or symbol: it is read by a planner who never sees the code. How the product works, already or with the change at hand, goes in \`${UNFILED_FILE}\`, to be filed into the specs it reaches. Work decided for later goes in \`${FUTURE_FILE}\`, to be planned as a feature of its own. An entry in either is \`### Title\`, then \`- decided: <the decision, one sentence>\` and \`- affects: <the features it reaches by name, and docs when no spec holds it yet, comma separated>\`. Add yours with Edit, or create the file with Write, and leave the other entries alone.`

/** Chat belongs to no feature, so whatever it settles waits in one of the two files. */
export const CHAT_DECISIONS = `When the user settles something about the product in this conversation, record it: ${UNFILED_DECISIONS}`

export type UnfiledDecision = {
  /** The `###` heading. */
  title: string
  decided: string
  /** Features by name, and `docs` for what no spec holds yet. */
  affects: string[]
}

/** An entry as the filing reads it: `later` when it came from the future-work file. */
export type FiledDecision = UnfiledDecision & { later: boolean }

const TITLE = /^#{1,2}\s+/
const HEADING = /^###\s+(.*?)\s*$/
const META = /^-\s+(decided|affects|built)\s*:\s*(.*)$/i
const BUILT_LINE = /^-\s+built\s*:\s*(.*)$/i

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
    const key = meta[1]!.toLowerCase()
    if (key === 'decided') current.entry.decided = value
    else if (key === 'affects') current.entry.affects = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    else problems.push(`line ${number}: an entry has no built line: how the product works goes in \`${UNFILED_FILE}\`, work decided for later in \`${FUTURE_FILE}\`.`)
  }
  close()
  problems.sort((a, b) => lineOf(a) - lineOf(b))
  return { entries, problems }
}

const lineOf = (problem: string): number => Number(/^line (\d+):/.exec(problem)?.[1] ?? 0)

/** Both files' entries, the unfiled ones first; none when neither file exists. */
export async function readUnfiled(cwd: string): Promise<FiledDecision[]> {
  const read = async (file: string, later: boolean): Promise<FiledDecision[]> => {
    const text = await readOptional(join(cwd, file))
    return text === undefined ? [] : parseUnfiled(text).entries.map((entry) => ({ ...entry, later }))
  }
  return [...(await read(UNFILED_FILE, false)), ...(await read(FUTURE_FILE, true))]
}

/**
 * An unfiled file from before the split, its entries sorted by their `built`
 * line: `false` is work for later and moves out, everything else stays, and
 * the line itself goes from every entry. `changed` is false for a file that
 * has no built line left, which is then left alone.
 */
export function splitByBuilt(text: string): { now: string; later: string[]; changed: boolean } {
  const lines = text.split(/\r?\n/)
  const head: string[] = []
  const blocks: string[][] = []
  for (const line of lines) {
    if (HEADING.test(line.trim())) blocks.push([line])
    else if (blocks.length > 0) blocks[blocks.length - 1]!.push(line)
    else head.push(line)
  }
  let changed = false
  const now: string[][] = []
  const later: string[] = []
  for (const block of blocks) {
    const built = block.map((l) => BUILT_LINE.exec(l.trim())).find((m) => m !== null)
    if (!built) {
      now.push(block)
      continue
    }
    changed = true
    const kept = block.filter((l) => !BUILT_LINE.test(l.trim()))
    if (built[1]!.trim().toLowerCase() === 'false') later.push(kept.join('\n').trimEnd())
    else now.push(kept)
  }
  return { now: `${[...head, ...now.flat()].join('\n').trimEnd()}\n`, later, changed }
}

/**
 * Splits an unfiled file written before future work had a file of its own:
 * each entry marked `built: false` moves to the future-work file, after any
 * entries already there. `changed` is false, and nothing is written, when the
 * file has no built line left.
 */
export async function migrateUnfiled(cwd: string): Promise<{ changed: boolean; moved: number }> {
  const path = join(cwd, UNFILED_FILE)
  const text = await readOptional(path)
  if (text === undefined) return { changed: false, moved: 0 }
  const { now, later, changed } = splitByBuilt(text)
  if (!changed) return { changed: false, moved: 0 }
  await writeFile(path, now, 'utf8')
  if (later.length > 0) {
    const futurePath = join(cwd, FUTURE_FILE)
    const existing = (await readOptional(futurePath))?.trimEnd()
    await writeFile(futurePath, `${existing || '# Future work'}\n\n${later.join('\n\n')}\n`, 'utf8')
  }
  return { changed: true, moved: later.length }
}

/** Tells the model, right after it wrote either file, what does not fit an entry's shape, so it fixes it in the same turn. */
export class UnfiledContract implements SessionHooks {
  constructor(private readonly cwd: string) {}

  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome> {
    if (tool.isError || !WRITES_NAMED_FILE.has(tool.toolName)) return undefined
    const input = (typeof tool.input === 'object' && tool.input !== null ? tool.input : {}) as Record<string, unknown>
    const raw = input['file_path']
    if (typeof raw !== 'string') return undefined
    const path = isAbsolute(raw) ? raw : resolve(this.cwd, raw)
    const file = relative(this.cwd, path).split('\\').join('/')
    if (!DECISION_FILES.includes(file)) return undefined
    const { problems } = parseUnfiled(await readFile(path, 'utf8'))
    if (problems.length === 0) return undefined
    return {
      additionalContext: [
        `\`${file}\` is off shape. Fix it before you stop:`,
        ...problems.map((p) => `- ${p}`),
        '',
        'An entry: `### Title`, then `- decided: ...` and `- affects: ...`. Nothing else.',
      ].join('\n'),
    }
  }
}
