import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WORK_DIR, featureSlug } from './blind-plan'
import { KEEP_RULING } from './ruling'

export { KEEP_RULING }

/**
 * The decisions file, `.kiwi/specs/<feature>.decisions.md`: what the check of
 * the approved spec found in the code that the spec has to answer for, the planner's change
 * options, and what the user rules. A temporal state beside the spec, so the
 * spec holds rules only and never a path or a symbol. Rulings are written here
 * by the extension, so a click on the plan view is a line in the file and
 * nothing else; the planner reads the ruling from disk when it is handed over.
 */

/** Open awaits the user; ruled awaits the planner; applied and withdrawn are settled. */
export type DecisionState = 'open' | 'ruled' | 'applied' | 'withdrawn'

/** The planner's pick among the ways to settle a decision: a `proposed` line by its place, or keeping the rule. */
export type Recommendation = {
  choice: number | 'keep'
  /** Why that settles it best; empty when the planner gave no reason. */
  because: string
}

export type Decision = {
  /** The `###` heading, markers stripped; what a ruling and a handover name. */
  title: string
  /** Names of the rules the decision concerns. */
  on: string[]
  /** What the product does today, as behaviour, and how it stands against the rules; never where in the code. */
  finding: string
  /** The planner's change options, each a rule text as it would stand in the spec; empty until it has been asked. */
  proposals: string[]
  /** Which way the planner would settle it, and why; absent until it has said. */
  recommendation?: Recommendation
  /** The user's ruling: `keep`, one of the proposals, or their own text. */
  ruling?: string
  state: DecisionState
  /** Line index of the heading in the text it was parsed from. */
  line: number
  /** Line index just past the decision's last line, where a ruling is inserted. */
  end: number
}

export type DecisionProblem = { line: number; text: string }

export function decisionsFile(feature: string): string {
  return `${WORK_DIR}/${featureSlug(feature)}.decisions.md`
}

export function decisionsPath(cwd: string, feature: string): string {
  return join(cwd, decisionsFile(feature))
}

const TITLE = /^#{1,2}\s+/
const HEADING = /^###\s+(.*?)\s*(\[applied\]|\[withdrawn\])?\s*$/i
const META = /^-\s+(on|finding|proposed|recommended|because|ruling)\s*:\s*(.*)$/i

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

const list = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

/** Line indices are into `text` as given. A `#` or `##` line is the file's title and says nothing. */
export function parseDecisions(text: string): { decisions: Decision[]; problems: DecisionProblem[] } {
  const decisions: Decision[] = []
  const problems: DecisionProblem[] = []
  let current: Decision | undefined
  let recommended: string | undefined
  let because: string | undefined
  const lines = text.split(/\r?\n/)
  const close = (): void => {
    if (!current) return
    if (!current.finding) problems.push({ line: current.line, text: `"${current.title}": a decision without a finding line.` })
    if (recommended !== undefined) {
      const choice = choiceOf(recommended, current.proposals.length)
      if (choice === undefined) {
        problems.push({ line: current.line, text: `"${current.title}": "${recommended}" recommends nothing; a recommendation is a \`proposed\` line's number, or \`${KEEP_RULING}\`.` })
      } else current.recommendation = { choice, because: because ?? '' }
    }
    current = undefined
    recommended = undefined
    because = undefined
  }
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (TITLE.test(line)) {
      close()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      close()
      const marker = heading[2]?.toLowerCase()
      current = {
        title: heading[1]!,
        on: [],
        finding: '',
        proposals: [],
        state: marker === '[applied]' ? 'applied' : marker === '[withdrawn]' ? 'withdrawn' : 'open',
        line: index,
        end: index + 1,
      }
      decisions.push(current)
      continue
    }
    if (line.length === 0) continue
    if (!current) {
      problems.push({ line: index, text: `"${line}": the decisions file holds \`### Title\` sections only.` })
      continue
    }
    const meta = META.exec(line)
    if (!meta) {
      problems.push({ line: index, text: `"${line}": a decision holds on, finding, proposed and ruling lines only.` })
      continue
    }
    const value = meta[2]!.trim()
    switch (meta[1]!.toLowerCase()) {
      case 'on':
        current.on = list(value)
        break
      case 'finding':
        current.finding = value
        break
      case 'proposed':
        if (value) current.proposals.push(value)
        break
      case 'recommended':
        recommended = value
        break
      case 'because':
        because = value
        break
      case 'ruling':
        current.ruling = value
        if (current.state === 'open') current.state = 'ruled'
        break
    }
    current.end = index + 1
  }
  close()
  return { decisions, problems }
}

/** A recommendation names a proposal by its place in the decision, counting from one, or keeps the rule. */
function choiceOf(value: string, proposals: number): number | 'keep' | undefined {
  const text = value.trim()
  if (same(text, KEEP_RULING)) return 'keep'
  const place = /^#?(\d+)\.?$/.exec(text)
  if (!place) return undefined
  const index = Number(place[1])
  return index >= 1 && index <= proposals ? index : undefined
}

export const decisions = (text: string): Decision[] => parseDecisions(text).decisions

/** The file's decisions; none when the feature has not been mapped. */
export async function readDecisions(path: string): Promise<Decision[]> {
  try {
    return decisions(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Decisions the user has yet to rule on. */
export const openDecisions = (all: Decision[]): Decision[] => all.filter((d) => d.state === 'open')

/** Decisions not yet applied to the rules: ruled or still open. The spec is not checked again over one. */
export const pendingDecisions = (all: Decision[]): Decision[] => all.filter((d) => d.state === 'open' || d.state === 'ruled')

/** A draft an earlier mapping left decisions on is approved only once they are applied; Send rulings is the way past. */
export function assertRulingsSent(all: Decision[]): void {
  const pending = pendingDecisions(all).length
  if (pending > 0) throw new Error(`Send the rulings first: ${pending === 1 ? 'a decision is' : `${pending} decisions are`} pending.`)
}

/** Every ruling is the user's: with several change options there is no default to fall back on, so an open decision refuses the handover. */
export function assertAllRuled(all: Decision[]): void {
  const open = openDecisions(all).length
  if (open > 0) throw new Error(`Rule on ${open === 1 ? 'the open decision' : `the ${open} open decisions`} first.`)
}

/** Rulings are one line; a pasted paragraph keeps its words, not its line breaks. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The file with the ruling written under the decision, replacing an earlier ruling the planner has not applied yet. */
export function withRuling(text: string, title: string, ruling: string): string {
  const body = oneLine(ruling)
  if (!body) throw new Error('A ruling needs text.')
  const decision = decisions(text).find((d) => same(d.title, title))
  if (!decision) throw new Error(`No decision "${title}" in the decisions file.`)
  if (decision.state === 'applied' || decision.state === 'withdrawn') {
    throw new Error(`"${title}" is ${decision.state}; there is nothing left to rule on.`)
  }
  const lines = text.split(/\r?\n/)
  const ruled = `- ruling: ${body}`
  const existing = lines.findIndex((l, i) => i > decision.line && i < decision.end && /^-\s+ruling\s*:/i.test(l.trim()))
  if (existing !== -1) lines[existing] = ruled
  else lines.splice(decision.end, 0, ruled)
  return lines.join('\n')
}

/** The lines only a ruling needed: once it is applied, the spec holds the outcome and they are read by no one. */
const SPENT = /^-\s+(proposed|recommended|because)\s*:/i

/** The file with every applied decision cut to its heading, `on`, finding and ruling; the rest stay whole. */
export function compactApplied(text: string): string {
  const lines = text.split(/\r?\n/)
  const spent = new Set<number>()
  for (const decision of decisions(text)) {
    if (decision.state !== 'applied') continue
    for (let i = decision.line + 1; i < decision.end; i++) if (SPENT.test(lines[i]!.trim())) spent.add(i)
  }
  return lines.filter((_, i) => !spent.has(i)).join('\n')
}

/** Compacts the decisions file on disk; a missing one stays missing. */
export async function compactAppliedDecisions(path: string): Promise<void> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const compacted = compactApplied(text)
  if (compacted !== text) await writeFile(path, compacted, 'utf8')
}

/** The ruling's meaning for the planner: the rule stands, a proposal replaces it verbatim, or the user's own words. */
export function rulingKind(decision: Decision): 'keep' | 'proposal' | 'own' | undefined {
  if (decision.ruling === undefined) return undefined
  if (same(decision.ruling, KEEP_RULING)) return 'keep'
  return decision.proposals.some((p) => same(p, decision.ruling!)) ? 'proposal' : 'own'
}
