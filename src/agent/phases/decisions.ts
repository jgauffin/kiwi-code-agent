/**
 * The Decisions section of a spec: what the mapping run found in the code
 * that the spec has to answer for, what the planner proposes, and what the
 * user rules. Rulings are written here by the extension, so a click on the
 * plan view is a line in the file and nothing else; the planner reads the
 * ruling from disk when it is handed over.
 */

export const DECISIONS_SECTION = 'Decisions'

/** Open awaits the user; ruled awaits the planner; applied and withdrawn are settled. */
export type DecisionState = 'open' | 'ruled' | 'applied' | 'withdrawn'

export type Decision = {
  /** The `###` heading, markers stripped; what a ruling and a handover name. */
  title: string
  /** Names of the rules the decision concerns. */
  on: string[]
  /** What the code does, where, and what the spec says. */
  finding: string
  /** The planner's proposal; empty until it has been asked. */
  proposal: string
  /** The user's ruling: `accepted`, or their own text. */
  ruling?: string
  state: DecisionState
  /** Line index of the heading in the text it was parsed from. */
  line: number
  /** Line index just past the decision's last line, where a ruling is inserted. */
  end: number
}

export type DecisionProblem = { line: number; text: string }

const SECTION = /^##\s+(.*)$/
const HEADING = /^###\s+(.*?)\s*(\[applied\]|\[withdrawn\])?\s*$/i
const META = /^-\s+(on|finding|proposed|ruling)\s*:\s*(.*)$/i

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

const list = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

/** Line indices are into `text` as given; the caller adds whatever offset its own numbering needs. */
export function parseDecisions(text: string): { decisions: Decision[]; problems: DecisionProblem[] } {
  const decisions: Decision[] = []
  const problems: DecisionProblem[] = []
  let inSection = false
  let current: Decision | undefined
  const lines = text.split(/\r?\n/)
  const close = (): void => {
    if (!current) return
    if (!current.finding) problems.push({ line: current.line, text: `"${current.title}": a decision without a finding line.` })
    current = undefined
  }
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    const section = SECTION.exec(line)
    if (section) {
      close()
      inSection = same(section[1]!, DECISIONS_SECTION)
      continue
    }
    if (!inSection) continue
    const heading = HEADING.exec(line)
    if (heading) {
      close()
      const marker = heading[2]?.toLowerCase()
      current = {
        title: heading[1]!,
        on: [],
        finding: '',
        proposal: '',
        state: marker === '[applied]' ? 'applied' : marker === '[withdrawn]' ? 'withdrawn' : 'open',
        line: index,
        end: index + 1,
      }
      decisions.push(current)
      continue
    }
    if (line.length === 0) continue
    if (!current) {
      problems.push({ line: index, text: `"${line}": Decisions holds \`### Title\` sections only.` })
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
        current.proposal = value
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

export const decisions = (text: string): Decision[] => parseDecisions(text).decisions

/** Decisions the user has yet to rule on. */
export const openDecisions = (text: string): Decision[] => decisions(text).filter((d) => d.state === 'open')

/** Decisions not yet applied to the rules: ruled or still open. The board is not re-mapped over one. */
export const pendingDecisions = (text: string): Decision[] => decisions(text).filter((d) => d.state === 'open' || d.state === 'ruled')

/** Rulings are one line; a pasted paragraph keeps its words, not its line breaks. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The file with the ruling written under the decision, replacing an earlier ruling the planner has not applied yet. */
export function withRuling(text: string, title: string, ruling: string): string {
  const body = oneLine(ruling)
  if (!body) throw new Error('A ruling needs text.')
  const decision = decisions(text).find((d) => same(d.title, title))
  if (!decision) throw new Error(`No decision "${title}" in the spec.`)
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

/** Every open decision with a proposal is ruled `accepted`; what has no proposal yet is left for the user. */
export function acceptProposals(text: string): { text: string; accepted: string[] } {
  let result = text
  const accepted: string[] = []
  for (const decision of openDecisions(text)) {
    if (!decision.proposal) continue
    result = withRuling(result, decision.title, 'accepted')
    accepted.push(decision.title)
  }
  return { text: result, accepted }
}
