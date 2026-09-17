import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { PostToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { PLAN_DIR } from './blind-plan'
import type { PlanItem } from './plan-review'
import { bodyOf } from './spec-file'

/**
 * The spec as a contract: a goal, scenarios from the user's side holding the
 * rules with their edge cases nested under the rule they qualify, and open
 * questions. Every rule has a name, the bold lead-in of its line, and the
 * name is what everything else refers to: a comment, a task, a test, a
 * decision. Parsed once, here; what does not fit the contract is reported as
 * a problem, never dropped, so the planner is told and the view can show it.
 */

export type Item = {
  /** The bold lead-in; unique in the spec, never changed once written. */
  name: string
  /** The line's text after the name, markers included, citation removed. */
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
  /** Contract violations, each naming its line; empty when the spec is on contract. */
  problems: string[]
}

export const GOAL_SECTION = 'Goal'
export const QUESTIONS_SECTION = 'Open questions'
/** Where decisions used to live; a spec still holding the section is migrated, not parsed. */
export const LEGACY_DECISIONS_SECTION = 'Decisions'

const TITLE = /^#\s+(.*)$/
const SECTION = /^##\s+(.*)$/
const SUBHEADING = /^#{3,6}\s+/
const BULLET = /^(\s*)-\s+(.*)$/
/** `- **Name**: text`, tolerating the colon inside the bold and a `(was Old name)` note after it. */
const ITEM = /^(\s*)-\s+\*\*([^*]+?)\*\*\s*(?:\(was\s+[^)]*\))?\s*:?\s*(.*)$/
/** A trailing `(path#Heading)` before the markers; a parenthesis without a hash is prose. */
const CITATION = /^(.*?)\s*\(([^\s()]+#[^()]*)\)((?:\s*\[[^\]]*\])*)$/
const FORBIDDEN = /[*,:()]/
const REMOVED = /\[removed\]/i

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The file as written, front matter and all: problems then name the lines the model sees when it reads the file. */
export function parseSpecText(text: string): Spec {
  const body = bodyOf(text)
  const offset = text.split(/\r?\n/).length - body.split(/\r?\n/).length
  return parseSpec(body, offset + 1)
}

export function parseSpec(body: string, firstLine = 1): Spec {
  const spec: Spec = { title: '', goal: '', scenarios: [], questions: [], problems: [] }
  const names = new Set<string>()
  let section: 'none' | 'goal' | 'scenario' | 'questions' | 'decisions' = 'none'
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
      else if (same(name, LEGACY_DECISIONS_SECTION)) {
        section = 'decisions'
        problem(number, `a \`## ${LEGACY_DECISIONS_SECTION}\` section; decisions live in the feature's decisions file, and Repair moves them there: leave the section alone.`)
      } else {
        section = 'scenario'
        scenario = { title: name, intro: '', behaviours: [] }
        intro = []
        spec.scenarios.push(scenario)
      }
      continue
    }
    // A legacy section is reported once, above; its lines are the migration's.
    if (section === 'decisions') continue
    if (SUBHEADING.test(line)) {
      problem(number, `"${line}": sub-headings are not part of the contract; a scenario is a \`##\` heading, its rules are items.`)
      continue
    }

    const bullet = BULLET.exec(raw)
    if (!bullet) {
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
        case 'questions':
          problem(number, `"${clip(line)}": Open questions holds \`- **Name**: question\` items only.`)
          break
        case 'none':
          problem(number, `"${clip(line)}": text before the first section; the spec starts with \`## ${GOAL_SECTION}\`.`)
          break
      }
      continue
    }

    const item = ITEM.exec(raw)
    if (!item) {
      if (section === 'questions') problem(number, `"${clip(line)}": Open questions holds \`- **Name**: question\` items only.`)
      else problem(number, `"${clip(line)}": a rule without a name; a rule is \`- **Name**: text\`.`)
      continue
    }
    const indent = item[1]!.length
    const name = item[2]!.trim().replace(/:$/, '').trim()
    const entry = withCitation(name, item[3]!.trim())
    if (FORBIDDEN.test(name)) problem(number, `"${name}": a name has no \`* , : ( )\` in it.`)
    const key = name.toLowerCase()
    if (names.has(key)) problem(number, `"${name}" is used twice; a name belongs to one rule for good.`)
    names.add(key)

    switch (section) {
      case 'scenario': {
        if (!scenario) break
        if (indent === 0) {
          behaviour = { ...entry, edges: [] }
          scenario.behaviours.push(behaviour)
        } else if (indent <= 3) {
          if (!behaviour) problem(number, `${name}: nested under nothing; an edge case sits under the rule it qualifies.`)
          else behaviour.edges.push(entry)
        } else {
          problem(number, `${name}: nested too deep; a scenario holds rules, a rule holds edge cases, and that is all.`)
        }
        break
      }
      case 'questions':
        if (indent > 0) problem(number, `${name}: Open questions is a flat list.`)
        spec.questions.push(entry)
        break
      case 'goal':
        problem(number, `${name}: Goal is prose; a rule belongs in a scenario.`)
        break
      case 'none':
        problem(number, `${name}: an item before the first section.`)
        break
    }
  }
  spec.problems.sort(byLine)
  spec.goal = goal.join('\n')
  if (!spec.goal) spec.problems.push(`no \`## ${GOAL_SECTION}\` section.`)
  if (spec.scenarios.length === 0) spec.problems.push('no scenario: at least one `##` section with the rules.')
  for (const s of spec.scenarios) {
    if (s.behaviours.length === 0) spec.problems.push(`scenario "${s.title}" has no rule.`)
  }
  return spec
}

function withCitation(name: string, rest: string): Item {
  const cited = CITATION.exec(rest)
  const text = cited ? `${cited[1]}${cited[3]}`.trim() : rest
  return { name, text, ...(cited ? { citation: cited[2]!.trim() } : {}), removed: REMOVED.test(text) }
}

/** Problems read in file order whichever parser found them. */
function byLine(a: string, b: string): number {
  const line = (p: string) => Number(/^line (\d+):/.exec(p)?.[1] ?? Number.MAX_SAFE_INTEGER)
  return line(a) - line(b)
}

function clip(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Every rule and question in file order, in the shape the review addresses: an edge under its rule, section = scenario title. */
export function specItems(spec: Spec): PlanItem[] {
  const items: PlanItem[] = []
  const cite = (item: Item): string => (item.citation ? `${item.text} (${item.citation})` : item.text)
  for (const scenario of spec.scenarios) {
    for (const behaviour of scenario.behaviours) {
      items.push({ name: behaviour.name, text: cite(behaviour), section: scenario.title, removed: behaviour.removed })
      for (const edge of behaviour.edges) items.push({ name: edge.name, text: cite(edge), section: scenario.title, removed: edge.removed })
    }
  }
  for (const question of spec.questions) {
    items.push({ name: question.name, text: cite(question), section: QUESTIONS_SECTION, removed: question.removed })
  }
  return items
}

/** The scenario a rule sits in, for grouping tasks by what they deliver. */
export function scenarioOf(spec: Spec, name: string): Scenario | undefined {
  return spec.scenarios.find((s) => s.behaviours.some((b) => same(b.name, name) || b.edges.some((e) => same(e.name, name))))
}

/** What the tasks were mapped from: the goal, the scenarios and the questions. */
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
    `The contract: \`## ${GOAL_SECTION}\` as prose, then one \`##\` per scenario holding \`- **Name**: rule\` items with their edge cases nested as \`  - **Name**: ...\`, then \`## ${QUESTIONS_SECTION}\` with \`- **Name**: question\` items. Nothing else.`,
  ].join('\n')
}
