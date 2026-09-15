import { readFile, writeFile } from 'node:fs/promises'
import { specPath } from './blind-plan'
import { intentPath, readAmendments } from './intent-writeback'
import { reviewPath } from './plan-review'
import { parseSpecText, specFingerprint } from './spec-model'
import { readTasks, stampSpecFingerprint, tasksPath } from './tasks-file'

/**
 * Brings a feature's plan files to the contract. What can be done by rule is
 * done here: a legacy task section becomes the tasks file, the id-based shapes
 * become the named ones with the old id standing in as the name, names the
 * planner changed are followed through every file, the board is stamped. What
 * needs judgment (scenarios, nesting, real names for the rules) is left to the
 * planner, whose prompt the caller sends when `problems` remain; running this
 * again after that turn finishes the job. Every legacy shape is known here
 * and nowhere else, so the parsers read one contract.
 */

export type MigrationReport = {
  feature: string
  /** What was changed on disk, one line each. */
  steps: string[]
  /** What still departs from the contract, for the planner. */
  problems: string[]
}

const SECTION = /^##\s+(.*)$/
const TASKS_HEADING = 'Tasks'
const ID = '[A-Z]{1,3}\\d+'
/** Old form: `- T1: text (B1, B2) [done]`; the delivered ids trailed the text. */
const TRAILING_IDS = new RegExp(`^-\\s+(T\\d+)\\s*:\\s*(.*?)\\s*\\((${ID}(?:\\s*,\\s*${ID})*)\\)\\s*((?:\\[[^\\]]*\\]\\s*)*)$`)
/** `- **New name** (was Old name): text`: the planner's note that a rule survived under a new name. */
const WAS = /^(\s*-\s+\*\*([^*]+?)\*\*)\s*\(was\s+([^)]+)\)(.*)$/
/** `- B1 (docs/x.md#H): text [removed]`: a rule by id, its citation after the id. */
const ID_ITEM = new RegExp(`^(\\s*)-\\s+(${ID})\\b\\s*(?:\\(([^)]*)\\))?\\s*:\\s*(.*)$`)
const TRAILING_WAS = new RegExp(`^(.*?)\\s*\\(was\\s+(${ID})\\)\\s*$`)
const MARKERS = /^(.*?)((?:\s*\[[^\]]*\])*)$/
const FINDING_ROW = /^\|\s*(F\d+)\s*(?:\(([^)]*)\))?\s*:?\s*([^|]*)\|([^|]*)\|/
const KINDS = ['contradiction', 'breakage', 'naive']
const ID_TASK = new RegExp(`^-\\s+(T\\d+)\\b\\s*(?:\\(([^)]*)\\))?\\s*:\\s*(.*)$`)
const PROVES = /^(\s+-\s+proves\s*:\s*)(.*)$/i
const ID_PROOF = new RegExp(`^(${ID})\\s+(?!→|->)(\\S+)\\s+(.+)$`)
const ID_COMMENT = /^-\s+C\d+\s*\(([^)]*)\)\s*:\s*(.*)$/
const STRUCK = /^-\s+struck\s*:\s*(.*)$/i
const ACCEPTED = /^(\s+-\s+)accepted\b(.*)$/i
const ROUND = /^(##\s+Round\s+\d+)\s+—\s+(.*)$/
const ID_AMENDMENT = /^##\s+A\d+\s*\(([A-Za-z]+)\)\s+(.+?)\s*(\[applied\])?\s*$/
const OLD_REVIEW_NOTE = 'A submitted comment keeps its id.'
const REVIEW_NOTE = 'A comment names the rule it is on.'

/** Lifts a `## Tasks` section out of the spec as tasks-file lines, ids first. */
export function extractLegacyTasks(specText: string): { spec: string; tasks: string[] } {
  const lines = specText.split(/\r?\n/)
  const kept: string[] = []
  const tasks: string[] = []
  let inTasks = false
  for (const line of lines) {
    const heading = SECTION.exec(line.trim())
    if (heading) inTasks = heading[1]!.trim().toLowerCase() === TASKS_HEADING.toLowerCase()
    if (!inTasks) {
      kept.push(line)
      continue
    }
    if (heading || line.trim().length === 0) continue
    const trailing = TRAILING_IDS.exec(line.trim())
    if (trailing) {
      const markers = trailing[4]!.trim()
      tasks.push(`- ${trailing[1]} (${trailing[3]}): ${trailing[2]}${markers ? ` ${markers}` : ''}`)
    } else tasks.push(line.trimEnd())
  }
  return { spec: kept.join('\n').replace(/\n{3,}/g, '\n\n'), tasks }
}

const mapLines = (text: string, fn: (line: string) => string): string => text.split(/\r?\n/).map(fn).join('\n')

/** `- B1 (cite): text [removed]` becomes `- **B1**: text (cite) [removed]`; a trailing `(was X)` moves up beside the name. */
export function modernizeSpecItems(text: string): string {
  return mapLines(text, (line) => {
    const match = ID_ITEM.exec(line.trimEnd())
    if (!match) return line
    const [, indent, id, cite, rest] = match
    let body = rest!.trim()
    let was = ''
    const renamed = TRAILING_WAS.exec(body)
    if (renamed) {
      body = renamed[1]!
      was = ` (was ${renamed[2]})`
    }
    const split = MARKERS.exec(body)!
    const cited = cite ? `${split[1]}${split[1] ? ' ' : ''}(${cite.trim()})${split[2]}` : body
    return `${indent}- **${id}**${was}: ${cited}`
  })
}

/** The `## Findings` table becomes `## Decisions`, one section per row, the old id as the title. */
export function modernizeFindings(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let inFindings = false
  let first = true
  for (const raw of lines) {
    const line = raw.trim()
    const heading = SECTION.exec(line)
    if (heading) {
      inFindings = heading[1]!.trim().toLowerCase() === 'findings'
      out.push(inFindings ? '## Decisions' : raw)
      continue
    }
    if (!inFindings) {
      out.push(raw)
      continue
    }
    const row = FINDING_ROW.exec(line)
    if (!row) {
      // The table's header and rule lines go; anything else in the section is kept as it was.
      if (!/^\|/.test(line)) out.push(raw)
      continue
    }
    const [, id, paren, findingCell, proposal] = row
    const on = (paren ?? '')
      .split(/[,/]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !KINDS.includes(s.toLowerCase()))
    const finding = findingCell!.trim()
    const marker = /\[resolved\]/i.test(finding) ? ' [applied]' : /\[removed\]/i.test(finding) ? ' [withdrawn]' : ''
    if (!first) out.push('')
    first = false
    out.push(`### ${id}${marker}`)
    if (on.length > 0) out.push(`- on: ${on.join(', ')}`)
    out.push(`- finding: ${finding.replace(/\s*\[(resolved|removed)\]/gi, '').trim()}`)
    if (proposal!.trim()) out.push(`- proposed: ${proposal!.trim()}`)
  }
  return out.join('\n')
}

/** `- T1 (B1): text` becomes `- **T1** (B1): text`; a proof `B1 file test` becomes `B1 → file test`. */
export function modernizeTasks(text: string): string {
  return mapLines(text, (line) => {
    const task = ID_TASK.exec(line.trimEnd())
    if (task) return `- **${task[1]}**${task[2] !== undefined ? ` (${task[2]})` : ''}: ${task[3]!.trim()}`
    const proves = PROVES.exec(line.trimEnd())
    if (!proves) return line
    const entries = proves[2]!.split(',').map((entry) => {
      const proof = ID_PROOF.exec(entry.trim())
      return proof ? `${proof[1]} → ${proof[2]} ${proof[3]}` : entry.trim()
    })
    return `${proves[1]}${entries.join(', ')}`
  })
}

/** `- C1 (B3): text` becomes `- on B3: text`, `struck` becomes `remove`, `accepted` becomes `resolved`. */
export function modernizeReview(text: string): string {
  return mapLines(text, (raw) => {
    const line = raw.trimEnd()
    const round = ROUND.exec(line.trim())
    if (round) return `${round[1]}, ${round[2]}`
    const comment = ID_COMMENT.exec(line.trim())
    if (comment) {
      const target = comment[1]!.trim()
      return `- on ${target.toLowerCase() === 'plan' ? 'the plan' : target}: ${comment[2]!.trim()}`
    }
    const struck = STRUCK.exec(line.trim())
    if (struck) return `- remove: ${struck[1]!.trim()}`
    const accepted = ACCEPTED.exec(line)
    if (accepted) return `${accepted[1]}resolved${accepted[2]}`
    if (line.includes(OLD_REVIEW_NOTE)) return line.replace(OLD_REVIEW_NOTE, REVIEW_NOTE)
    return raw
  })
}

/** `## A1 (append) docs/x.md#H [applied]` becomes `## docs/x.md#H (append) [applied]`. */
export function modernizeIntent(text: string): string {
  return mapLines(text, (line) => {
    const match = ID_AMENDMENT.exec(line.trim())
    if (!match) return line
    return `## ${match[2]} (${match[1]!.toLowerCase()})${match[3] ? ' [applied]' : ''}`
  })
}

/** Strips the planner's `(was X)` notes and returns what they say: old name → new name. */
export function collectRenames(specText: string): { spec: string; renames: Map<string, string> } {
  const renames = new Map<string, string>()
  const lines = specText.split(/\r?\n/).map((line) => {
    const match = WAS.exec(line)
    if (!match) return line
    renames.set(match[3]!.trim(), match[2]!.trim())
    return `${match[1]}${match[4]}`
  })
  return { spec: lines.join('\n'), renames }
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Rewrites every whole-word occurrence of a renamed name, in whatever file refers to it. */
export function applyRenames(text: string, renames: Map<string, string>): string {
  let result = text
  for (const [from, to] of renames) result = result.replace(new RegExp(`\\b${escape(from)}\\b`, 'g'), to)
  return result
}

async function readIfThere(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** The mechanical part, safe to run any number of times. */
export async function migratePlan(cwd: string, feature: string): Promise<MigrationReport> {
  const report: MigrationReport = { feature, steps: [], problems: [] }
  const spec = specPath(cwd, feature)
  const tasks = tasksPath(cwd, feature)
  const review = reviewPath(cwd, feature)
  const intent = intentPath(cwd, feature)
  let specText = await readIfThere(spec)
  if (specText === undefined) {
    report.problems.push('no spec file.')
    return report
  }
  const before = specText

  const legacy = extractLegacyTasks(specText)
  if (legacy.tasks.length > 0) {
    specText = legacy.spec
    const existing = await readIfThere(tasks)
    if (existing === undefined) {
      const title = /^#\s+(.*)$/m.exec(specText)?.[1]?.trim() ?? feature
      await writeFile(tasks, `# Tasks for ${title}\n\n${legacy.tasks.join('\n')}\n`, 'utf8')
      report.steps.push(`moved ${legacy.tasks.length} task line(s) from the spec into the tasks file.`)
    } else report.steps.push('dropped the spec’s task section; the tasks file already holds the board.')
  }

  const named = modernizeFindings(modernizeSpecItems(specText))
  if (named !== specText) {
    specText = named
    report.steps.push('rewrote the spec to the named-rule contract.')
  }

  const renamed = collectRenames(specText)
  if (renamed.renames.size > 0) {
    specText = applyRenames(renamed.spec, renamed.renames)
    const pairs = [...renamed.renames].map(([from, to]) => `${from} → ${to}`).join(', ')
    for (const path of [review, tasks]) {
      const text = await readIfThere(path)
      if (text === undefined) continue
      const next = applyRenames(text, renamed.renames)
      if (next !== text) await writeFile(path, next, 'utf8')
    }
    report.steps.push(`renamed ${pairs} across the spec, the review and the tasks file.`)
  }

  if (specText !== before) await writeFile(spec, specText, 'utf8')

  let boardChanged = false
  const modernized: [string, (text: string) => string, string][] = [
    [tasks, modernizeTasks, 'the tasks file'],
    [review, modernizeReview, 'the review'],
    [intent, modernizeIntent, 'the intent file'],
  ]
  for (const [path, modernize, what] of modernized) {
    const text = await readIfThere(path)
    if (text === undefined) continue
    const next = modernize(text)
    if (next === text) continue
    await writeFile(path, next, 'utf8')
    if (path === tasks) boardChanged = true
    report.steps.push(`rewrote ${what} to the named-rule contract.`)
  }

  const parsed = parseSpecText(specText)
  const board = await readTasks(tasks)
  // A rewrite of either file changes what the fingerprint covers; a board that is otherwise current is stamped again rather than left stale.
  const restamp = board.exists && parsed.problems.length === 0 && (board.spec === undefined || specText !== before || boardChanged)
  if (restamp) {
    await stampSpecFingerprint(tasks, specFingerprint(parsed))
    report.steps.push('stamped the tasks file with the spec it was mapped from.')
  }

  try {
    await readAmendments(intent)
  } catch (error) {
    report.problems.push(`intent file cannot be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  report.problems.push(...parsed.problems)
  return report
}
