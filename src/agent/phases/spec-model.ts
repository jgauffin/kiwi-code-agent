import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { PostToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { PLAN_DIR } from './blind-plan'
import type { PlanItem } from './plan-review'
import { FINDINGS_SECTION, findings, type Finding } from './reconcile'
import { bodyOf } from './spec-file'

/**
 * The spec as a contract: a goal, scenarios from the user's side holding the
 * behaviours with their edge cases nested under the rule they qualify, open
 * questions, and the findings a mapping run wrote. Parsed once, here; what
 * does not fit the contract is reported as a problem, never dropped, so the
 * planner is told and the view can show it.
 */

export type Item = {
  id: string
  /** The line's text after the id, markers included, as written. */
  text: string
  /** `path#Heading` of the intent section the item came from; absent on the planner's own default. */
  citation?: string
  removed: boolean
}

export type Behaviour = Item & { edges: Item[] }

export type Scenario = { title: string; intro: string; behaviours: Behaviour[] }

export type Spec = {
  title: string
  goal: string
  scenarios: Scenario[]
  questions: Item[]
  findings: Finding[]
  /** Contract violations, each naming its line; empty when the spec is on contract. */
  problems: string[]
}

export const GOAL_SECTION = 'Goal'
export const QUESTIONS_SECTION = 'Open questions'
const RESERVED = [GOAL_SECTION, QUESTIONS_SECTION, FINDINGS_SECTION]

const TITLE = /^#\s+(.*)$/
const SECTION = /^##\s+(.*)$/
const SUBHEADING = /^#{3,6}\s+/
const ITEM = /^(\s*)-\s+([A-Z]{1,3}\d+)\b\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/
const REMOVED = /\[removed\]/i

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The file as written, front matter and all: problems then name the lines the model sees when it reads the file. */
export function parseSpecText(text: string): Spec {
  const body = bodyOf(text)
  const offset = text.split(/\r?\n/).length - body.split(/\r?\n/).length
  return parseSpec(body, offset + 1)
}

export function parseSpec(body: string, firstLine = 1): Spec {
  const spec: Spec = { title: '', goal: '', scenarios: [], questions: [], findings: findings(body), problems: [] }
  const ids = new Set<string>()
  let section: 'none' | 'goal' | 'scenario' | 'questions' | 'findings' = 'none'
  let scenario: Scenario | undefined
  let behaviour: Behaviour | undefined
  let goal: string[] = []
  let intro: string[] = []
  const problem = (line: number, text: string) => spec.problems.push(`line ${line}: ${text}`)

  const lines = body.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const number = index + firstLine
    const raw = lines[index]!.trimEnd()
    const line = raw.trim()
    if (line.length === 0) continue

    const title = TITLE.exec(line)
    if (title) {
      if (spec.title) problem(number, 'a second title; the spec has one `#` heading.')
      else spec.title = title[1]!.trim()
      continue
    }
    const heading = SECTION.exec(line)
    if (heading) {
      const name = heading[1]!.trim()
      behaviour = undefined
      if (same(name, GOAL_SECTION)) section = 'goal'
      else if (same(name, QUESTIONS_SECTION)) section = 'questions'
      else if (same(name, FINDINGS_SECTION)) section = 'findings'
      else {
        section = 'scenario'
        scenario = { title: name, intro: '', behaviours: [] }
        intro = []
        spec.scenarios.push(scenario)
      }
      continue
    }
    if (SUBHEADING.test(line)) {
      problem(number, `"${line}": sub-headings are not part of the contract; a scenario is a \`##\` heading, its rules are items.`)
      continue
    }

    const item = ITEM.exec(raw)
    if (!item) {
      switch (section) {
        case 'goal':
          goal.push(line)
          break
        case 'scenario':
          if (scenario && scenario.behaviours.length === 0) {
            intro.push(line)
            scenario.intro = intro.join('\n')
          } else problem(number, `"${clip(line)}": prose after a scenario's items; a rule is an item, a remark belongs in the intro.`)
          break
        case 'findings':
          break
        case 'questions':
          problem(number, `"${clip(line)}": Open questions holds \`- Q1: ...\` items only.`)
          break
        case 'none':
          problem(number, `"${clip(line)}": text before the first section; the spec starts with \`## ${GOAL_SECTION}\`.`)
          break
      }
      continue
    }

    const indent = item[1]!.length
    const id = item[2]!
    const prefix = id.replace(/\d+$/, '')
    const text = item[4]!.trim()
    const entry: Item = { id, text, ...(item[3] ? { citation: item[3].trim() } : {}), removed: REMOVED.test(text) }
    if (ids.has(id)) problem(number, `${id} is used twice; an id belongs to one item for good.`)
    ids.add(id)

    switch (section) {
      case 'scenario': {
        if (!scenario) break
        if (indent === 0) {
          if (prefix !== 'B') {
            problem(number, `${id}: only behaviours (B) sit directly under a scenario; ${describePrefix(prefix)}.`)
          }
          behaviour = { ...entry, edges: [] }
          scenario.behaviours.push(behaviour)
        } else if (indent <= 3) {
          if (prefix !== 'E') problem(number, `${id}: only edge cases (E) nest under a behaviour; ${describePrefix(prefix)}.`)
          if (!behaviour) problem(number, `${id}: nested under nothing; an edge case sits under the behaviour it qualifies.`)
          else behaviour.edges.push(entry)
        } else {
          problem(number, `${id}: nested too deep; a scenario holds behaviours, a behaviour holds edge cases, and that is all.`)
        }
        break
      }
      case 'questions':
        if (indent > 0) problem(number, `${id}: Open questions is a flat list.`)
        if (prefix !== 'Q') problem(number, `${id}: only questions (Q) go under Open questions; a rule belongs in a scenario.`)
        else spec.questions.push(entry)
        break
      case 'findings':
        problem(number, `${id}: Findings is a table, one row per finding.`)
        break
      case 'goal':
        problem(number, `${id}: Goal is prose; a rule belongs in a scenario.`)
        break
      case 'none':
        problem(number, `${id}: an item before the first section.`)
        break
    }
  }
  spec.goal = goal.join('\n')
  if (!spec.goal) spec.problems.push(`no \`## ${GOAL_SECTION}\` section.`)
  if (spec.scenarios.length === 0) spec.problems.push('no scenario: at least one `##` section with the behaviours.')
  for (const s of spec.scenarios) {
    if (s.behaviours.length === 0) spec.problems.push(`scenario "${s.title}" has no behaviour.`)
  }
  return spec
}

function describePrefix(prefix: string): string {
  switch (prefix) {
    case 'E':
      return 'an edge case is indented under the behaviour it qualifies'
    case 'I':
    case 'A':
      return 'an invariant or acceptance criterion is a behaviour, or restates one and goes'
    case 'T':
      return 'tasks live in the tasks file, written when the spec is mapped against the code'
    case 'Q':
      return 'a question goes under Open questions'
    case 'B':
      return 'a rule belongs in a scenario'
    case 'F':
      return 'a finding is a row of the Findings table'
    default:
      return `the contract knows B, E, Q and F`
  }
}

function clip(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Every item in file order, in the shape the review addresses: E under its behaviour, section = scenario title. */
export function specItems(spec: Spec): PlanItem[] {
  const items: PlanItem[] = []
  const cite = (item: Item): string => (item.citation ? `(${item.citation}) ${item.text}` : item.text)
  for (const scenario of spec.scenarios) {
    for (const behaviour of scenario.behaviours) {
      items.push({ id: behaviour.id, text: cite(behaviour), section: scenario.title, removed: behaviour.removed })
      for (const edge of behaviour.edges) items.push({ id: edge.id, text: cite(edge), section: scenario.title, removed: edge.removed })
    }
  }
  for (const question of spec.questions) {
    items.push({ id: question.id, text: cite(question), section: QUESTIONS_SECTION, removed: question.removed })
  }
  for (const finding of spec.findings) {
    items.push({ id: finding.id, text: finding.text, section: FINDINGS_SECTION, removed: REMOVED.test(finding.text) })
  }
  return items
}

/** The scenario an item sits in, for grouping tasks by what they deliver. */
export function scenarioOf(spec: Spec, id: string): Scenario | undefined {
  return spec.scenarios.find((s) => s.behaviours.some((b) => b.id === id || b.edges.some((e) => e.id === id)))
}

/**
 * What the tasks were mapped from: the goal, the scenarios and the questions.
 * Findings are left out on purpose, so a proposal filled into the table is
 * not a change to the plan the board was built for.
 */
export function specFingerprint(spec: Spec): string {
  const hash = createHash('sha1')
  hash.update(JSON.stringify({ goal: spec.goal, scenarios: spec.scenarios, questions: spec.questions }))
  return hash.digest('hex').slice(0, 8)
}

/**
 * Tells the model, right after it wrote the spec, what does not fit the
 * contract. The file is already on disk, so the answer rides on the tool
 * result and the model fixes it in the same turn.
 */
export class SpecContract implements SessionHooks {
  constructor(private readonly cwd: string) {}

  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome> {
    if (tool.isError || (tool.toolName !== 'Write' && tool.toolName !== 'Edit')) return undefined
    const input = (typeof tool.input === 'object' && tool.input !== null ? tool.input : {}) as Record<string, unknown>
    const raw = input['file_path']
    if (typeof raw !== 'string') return undefined
    const path = isAbsolute(raw) ? raw : resolve(this.cwd, raw)
    const rel = relative(this.cwd, path).split('\\').join('/')
    if (!rel.startsWith(`${PLAN_DIR}/`) || !rel.endsWith('.spec.md')) return undefined
    const spec = parseSpecText(await readFile(path, 'utf8'))
    if (spec.problems.length === 0) return undefined
    return { additionalContext: contractProblems(rel, spec.problems) }
  }
}

export function contractProblems(file: string, problems: string[]): string {
  return [
    `\`${file}\` is off contract. Fix it before you stop:`,
    ...problems.map((p) => `- ${p}`),
    '',
    `The contract: \`## ${GOAL_SECTION}\` as prose, then one \`##\` per scenario holding \`- B1: ...\` behaviours with their edge cases nested as \`  - E1: ...\`, then \`## ${QUESTIONS_SECTION}\` with \`- Q1: ...\`, then \`## ${FINDINGS_SECTION}\` as a table. Nothing else.`,
  ].join('\n')
}
