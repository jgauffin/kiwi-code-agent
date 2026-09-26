import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { PostToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { DOCS_MAP_ROOT, ENTRY_DIR } from './map-files'

/**
 * One doc as the map describes it: a line for the doc, and a line per heading
 * saying what a reader would find under it. That is the whole contract, and
 * the extension holds the run to it on every write, so a bad entry is answered
 * in the turn that wrote it rather than shipped into a planner's prompt.
 *
 * A heading is kept verbatim because it is an anchor: a planner cites a rule
 * as `path#Heading`, and a heading the map invented or misspelled is a
 * citation that leads nowhere. That failure is silent (no build and no test
 * would report it), which is why the check is here and not left to review.
 */

export type MappedHeading = { heading: string; line: string }

export type DocsMapEntry = {
  /** Workspace-relative path of the doc this describes. */
  doc: string
  /** One line: what the doc as a whole is for. */
  summary: string
  headings: MappedHeading[]
  /** Contract violations, each naming what is wrong; empty when the entry is on contract. */
  problems: string[]
}

/** `- \`#Heading\`: what the section holds`. The backticks fence the heading, which may hold a colon of its own. */
const HEADING_LINE = /^-\s+`#(.+)`\s*:\s*(.+)$/
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const DOC_FIELD = /^doc:\s*(.+)$/m
const FENCE = /^\s*(```|~~~)/
/** `##` and `###` only: the title says what the doc is, and nothing deeper is worth a line of its own. */
const HEADING = /^(#{2,3})\s+(.+?)\s*#*\s*$/

/**
 * The headings of a doc, in file order, as a citation would name them. Lines
 * inside a fenced block are examples, not structure: the spec contract is
 * quoted as fenced markdown in more than one doc here, and every `##` in it
 * would otherwise become an anchor that does not exist.
 */
export function docHeadings(text: string): string[] {
  const headings: string[] = []
  let fenced = false
  for (const raw of text.split(/\r?\n/)) {
    if (FENCE.test(raw)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = HEADING.exec(raw)
    if (match) headings.push(match[2]!.trim())
  }
  return headings
}

/** Reads the entry as written. What does not fit the grammar is a problem, never dropped in silence. */
export function parseEntry(text: string): DocsMapEntry {
  const entry: DocsMapEntry = { doc: '', summary: '', headings: [], problems: [] }
  const front = FRONT_MATTER.exec(text)
  if (!front) {
    entry.problems.push('no front matter: the first line has to be `---`, then `doc: <path>`, then `---`.')
  } else {
    const doc = DOC_FIELD.exec(front[1]!)
    if (!doc) entry.problems.push('the front matter has no `doc:` line naming the doc this describes.')
    else entry.doc = doc[1]!.trim()
  }
  const body = front ? text.slice(front[0].length) : text
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const match = HEADING_LINE.exec(line)
    if (match) {
      entry.headings.push({ heading: match[1]!.trim(), line: match[2]!.trim() })
      continue
    }
    if (line.startsWith('-')) {
      entry.problems.push(`\`${clip(line)}\` is not a heading line; write it as \`- \\\`#Heading\\\`: what the section holds\`.`)
      continue
    }
    if (entry.summary === '' && entry.headings.length === 0) entry.summary = line
    else entry.problems.push(`\`${clip(line)}\` is neither the doc's line nor a heading line.`)
  }
  if (entry.summary === '') entry.problems.push("the doc's own line is missing: one line under the front matter saying what the doc is for.")
  return entry
}

/**
 * The entry against the doc it describes: every heading named has to exist,
 * every heading of the doc has to be named, and the order has to be the doc's.
 */
export function checkEntry(entry: DocsMapEntry, headings: string[]): string[] {
  const problems: string[] = []
  const actual = new Set(headings)
  const named = new Set<string>()
  for (const { heading } of entry.headings) {
    if (!actual.has(heading)) problems.push(`\`#${heading}\` is not a heading of the doc; a citation to it would lead nowhere.`)
    else named.add(heading)
  }
  for (const heading of headings) {
    if (!named.has(heading)) problems.push(`\`#${heading}\` is a heading of the doc with no line.`)
  }
  const order = entry.headings.map((h) => h.heading).filter((h) => actual.has(h))
  const expected = headings.filter((h) => named.has(h))
  if (problems.length === 0 && order.join('\u0000') !== expected.join('\u0000')) {
    problems.push('the lines are not in the order the headings appear in the doc.')
  }
  return problems
}

/** The doc an entry file describes, taken from where the file sits; undefined for a path outside the entries. */
export function docOfEntry(path: string): string | undefined {
  const prefix = `${DOCS_MAP_ROOT}/${ENTRY_DIR}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined
}

/**
 * Holds the map run to the entry contract on every write, the way the spec
 * contract holds the planner: the problems come back on the same tool result,
 * so the run fixes the entry in the turn that wrote it.
 */
export class DocsMapContract implements SessionHooks {
  constructor(private readonly cwd: string) {}

  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome> {
    if (tool.isError || (tool.toolName !== 'Write' && tool.toolName !== 'Edit')) return undefined
    const input = (typeof tool.input === 'object' && tool.input !== null ? tool.input : {}) as Record<string, unknown>
    const raw = input['file_path']
    if (typeof raw !== 'string') return undefined
    const absolute = isAbsolute(raw) ? raw : resolve(this.cwd, raw)
    const rel = relative(this.cwd, absolute).split('\\').join('/')
    const doc = docOfEntry(rel)
    if (doc === undefined) return undefined
    const entry = parseEntry(await readFile(absolute, 'utf8'))
    const text = await readFile(join(this.cwd, ...doc.split('/')), 'utf8').catch(() => undefined)
    const problems = [
      ...entry.problems,
      ...(entry.doc !== '' && entry.doc !== doc ? [`the \`doc:\` line says \`${entry.doc}\`, but the entry sits at the path of \`${doc}\`.`] : []),
      ...(text === undefined ? [`\`${doc}\` could not be read, so the headings could not be checked.`] : checkEntry(entry, docHeadings(text))),
    ]
    if (problems.length === 0) return undefined
    return { additionalContext: entryProblems(rel, problems) }
  }
}

export function entryProblems(file: string, problems: string[]): string {
  return [
    `\`${file}\` is off contract. Fix it before you stop:`,
    ...problems.map((p) => `- ${p}`),
    '',
    "The contract: `---`, `doc: <path>`, `---`, then one line saying what the doc is for, then one ``- `#Heading`: what the section holds`` line per `##` and `###` of the doc, in the doc's order, the heading copied exactly.",
  ].join('\n')
}

const clip = (text: string, max = 60): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
