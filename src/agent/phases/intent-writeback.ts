import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { DOCS_DIR, PLAN_DIR, featureSlug } from './blind-plan'
import type { SpecState } from './spec-file'

/**
 * Phase 1 plans blind: it reads `docs/**` and nothing else. So a ruling made
 * in a spec — a `naive` finding the user upheld, a contradiction decided in
 * the spec's favour — is invisible to the next feature's planner unless it
 * reaches the intent docs. Without this, intent rots and the same question is
 * re-decided, possibly the other way.
 *
 * The agent cannot edit `docs/` itself: intent is the user's. So it proposes,
 * in `plan/<feature>.intent.md`, and the human applies. Applying is mechanical
 * and done by the extension, so what lands in `docs/` is what was proposed and
 * is reviewable as a git diff.
 */

/** How an amendment changes the section it names. */
export type AmendmentMode = 'append' | 'replace' | 'new'

export type Amendment = {
  /** A1, A2, ... stable once written; the agent never renumbers. */
  id: string
  mode: AmendmentMode
  /** Workspace-relative path of the intent doc, always under `docs/`. */
  doc: string
  /** Heading the amendment lands under; absent means the end of the document. */
  heading?: string
  /** The spec item or finding the amendment came from, for the record. */
  from?: string
  /** Why intent has to change, in the agent's words. */
  why?: string
  /** The markdown to put into the doc, as written. */
  text: string
  /** Already written into `docs/`; it is never applied twice. */
  applied: boolean
  /** Line index of the heading in the intent file, for marking it applied. */
  line: number
}

export function intentPath(cwd: string, feature: string): string {
  return join(cwd, PLAN_DIR, `${featureSlug(feature)}.intent.md`)
}

/** Workspace-relative path of the amendment file, the form used in prompts and scopes. */
export function intentFile(feature: string): string {
  return `${PLAN_DIR}/${featureSlug(feature)}.intent.md`
}

// `## A1 (append) docs/intent/orders.md#Cancellation [applied]`
const AMENDMENT = /^##\s+(A\d+)\s*\(([A-Za-z]+)\)\s+(\S+?)\s*(\[applied\])?\s*$/
const META = /^-\s+(from|why)\s*:\s*(.*)$/i
const MODES: AmendmentMode[] = ['append', 'replace', 'new']

export function parseAmendments(text: string): Amendment[] {
  const amendments: Amendment[] = []
  let current: Amendment | undefined
  let body: string[] = []
  const flush = (): void => {
    if (current) current.text = body.join('\n').trim()
    body = []
  }
  const lines = text.split(/\r?\n/)
  for (const [index, raw] of lines.entries()) {
    const match = AMENDMENT.exec(raw.trim())
    if (match) {
      flush()
      const mode = match[2]!.toLowerCase()
      // An unknown mode is not a silent append: the file is the agent's output and has to say what it means.
      if (!MODES.includes(mode as AmendmentMode)) {
        current = undefined
        continue
      }
      const [doc, heading] = splitTarget(match[3]!)
      current = {
        id: match[1]!,
        mode: mode as AmendmentMode,
        doc,
        ...(heading ? { heading } : {}),
        text: '',
        applied: match[4] !== undefined,
        line: index,
      }
      amendments.push(current)
      continue
    }
    if (!current) continue
    const meta = META.exec(raw.trim())
    // Metadata only counts before the prose starts; a `- why:` inside the body is body.
    if (meta && body.every((l) => l.trim().length === 0)) {
      if (meta[1]!.toLowerCase() === 'from') current.from = meta[2]!.trim()
      else current.why = meta[2]!.trim()
      continue
    }
    body.push(raw)
  }
  flush()
  return amendments
}

function splitTarget(target: string): [string, string | undefined] {
  const hash = target.indexOf('#')
  if (hash === -1) return [target, undefined]
  return [target.slice(0, hash), target.slice(hash + 1).trim() || undefined]
}

export async function readAmendments(path: string): Promise<Amendment[]> {
  try {
    return parseAmendments(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export const pending = (amendments: Amendment[]): Amendment[] => amendments.filter((a) => !a.applied)

/**
 * Intent is amended from a settled plan only. On a draft the rulings can still
 * change, and a doc written from one would have to be taken back.
 */
export function assertAmendable(state: SpecState): void {
  if (!state.exists) throw new Error('No spec yet: there is nothing to write back to intent.')
  if (state.status !== 'approved') throw new Error('The spec is a draft: approve it before amending intent.')
}

// --- applying ----------------------------------------------------------------

const HEADING = /^(#{1,6})\s+(.*)$/

type Section = { heading: number; level: number; end: number }

/** The named section: its heading line, and where its body stops (the next heading of the same or higher rank). */
export function findSection(lines: string[], heading: string): Section | undefined {
  const wanted = heading.trim().toLowerCase()
  for (const [index, line] of lines.entries()) {
    const match = HEADING.exec(line.trim())
    if (!match || match[2]!.trim().toLowerCase() !== wanted) continue
    const level = match[1]!.length
    let end = lines.length
    for (let next = index + 1; next < lines.length; next++) {
      const deeper = HEADING.exec(lines[next]!.trim())
      if (deeper && deeper[1]!.length <= level) {
        end = next
        break
      }
    }
    return { heading: index, level, end }
  }
  return undefined
}

/** Trailing blank lines belong to the gap between sections, not to the body being replaced or appended to. */
function trimEnd(lines: string[], from: number, to: number): number {
  let end = to
  while (end > from && lines[end - 1]!.trim().length === 0) end--
  return end
}

/**
 * The amendment written into the document's text. Pure, so what a test checks
 * is exactly what lands on disk.
 */
export function applyToDoc(doc: string, amendment: Amendment): string {
  const text = amendment.text.trim()
  if (!text) throw new Error(`${amendment.id} has no text to write.`)
  const lines = doc.length > 0 ? doc.split(/\r?\n/) : []

  if (amendment.mode === 'new') {
    if (amendment.heading && findSection(lines, amendment.heading)) {
      throw new Error(`${amendment.id}: "${amendment.heading}" already exists in ${amendment.doc}; use replace or append.`)
    }
    const body = amendment.heading ? `## ${amendment.heading}\n\n${text}` : text
    const head = lines.slice(0, trimEnd(lines, 0, lines.length))
    return [...head, ...(head.length > 0 ? [''] : []), ...body.split('\n'), ''].join('\n')
  }

  if (!amendment.heading) {
    if (amendment.mode === 'replace') throw new Error(`${amendment.id}: replace needs a heading (path#heading).`)
    const head = lines.slice(0, trimEnd(lines, 0, lines.length))
    return [...head, ...(head.length > 0 ? [''] : []), ...text.split('\n'), ''].join('\n')
  }

  const section = findSection(lines, amendment.heading)
  if (!section) throw new Error(`${amendment.id}: no heading "${amendment.heading}" in ${amendment.doc}.`)
  const bodyEnd = trimEnd(lines, section.heading + 1, section.end)
  const before = lines.slice(0, amendment.mode === 'replace' ? section.heading + 1 : bodyEnd)
  const after = lines.slice(section.end)
  return [...before, '', ...text.split('\n'), '', ...after].join('\n').replace(/\n{3,}/g, '\n\n')
}

/** Intent lives under `docs/`; an amendment that points anywhere else is refused, not written. */
function docPathOf(cwd: string, doc: string): string {
  const absolute = isAbsolute(doc) ? doc : resolve(cwd, doc)
  const rel = relative(cwd, absolute).split('\\').join('/')
  if (rel.startsWith('..')) throw new Error(`${doc} is outside the workspace.`)
  if (!rel.startsWith(`${DOCS_DIR}/`)) throw new Error(`${doc} is not an intent document: amendments write under ${DOCS_DIR}/ only.`)
  return absolute
}

async function readDoc(path: string, mode: AmendmentMode): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    // A new document is only created by `new`; the others name a doc that has to be there.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && mode === 'new') return ''
    throw error
  }
}

/** Marks the applied amendments in the file without touching anything else the agent wrote. */
export function markApplied(text: string, ids: string[]): string {
  if (ids.length === 0) return text
  const lines = text.split(/\r?\n/)
  for (const amendment of parseAmendments(text)) {
    if (amendment.applied || !ids.includes(amendment.id)) continue
    lines[amendment.line] = `${lines[amendment.line]!.trimEnd()} [applied]`
  }
  return lines.join('\n')
}

export type WriteBackResult = {
  applied: Amendment[]
  /** An amendment that could not be written, with the reason; the rest still go through. */
  failed: { amendment: Amendment; reason: string }[]
  /** Workspace-relative docs that changed, for the message to the user. */
  docs: string[]
}

/**
 * Writes every pending amendment into its document and marks it applied. One
 * bad amendment does not hold up the others: it is reported and stays pending,
 * so the agent can be asked to fix that one.
 */
export async function writeBackIntent(options: { cwd: string; feature: string }): Promise<WriteBackResult> {
  const { cwd, feature } = options
  const path = intentPath(cwd, feature)
  const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  const todo = pending(parseAmendments(text))
  const result: WriteBackResult = { applied: [], failed: [], docs: [] }
  if (todo.length === 0) return result

  for (const amendment of todo) {
    try {
      const doc = docPathOf(cwd, amendment.doc)
      const before = await readDoc(doc, amendment.mode)
      const after = applyToDoc(before, amendment)
      await mkdir(dirname(doc), { recursive: true })
      await writeFile(doc, after, 'utf8')
      result.applied.push(amendment)
      if (!result.docs.includes(amendment.doc)) result.docs.push(amendment.doc)
    } catch (error) {
      result.failed.push({ amendment, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  if (result.applied.length > 0) {
    await writeFile(path, markApplied(text, result.applied.map((a) => a.id)), 'utf8')
  }
  return result
}
