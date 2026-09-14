import { readFile, writeFile } from 'node:fs/promises'
import { specPath } from './blind-plan'
import { intentPath, readAmendments } from './intent-writeback'
import { reviewPath } from './plan-review'
import { parseSpecText, specFingerprint } from './spec-model'
import { readTasks, stampSpecFingerprint, tasksPath } from './tasks-file'

/**
 * Brings a feature's plan files to the contract. What can be done by rule is
 * done here: a legacy task section becomes the tasks file, ids the planner
 * renamed are followed through every file, the board is stamped. What needs
 * judgment (scenarios, nesting, folding restated rules) is left to the
 * planner, whose prompt the caller sends when `problems` remain; running this
 * again after that turn finishes the job.
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
/** Old form: `- T1: text (B1, B2) [done]`; the delivered ids trailed the text. */
const TRAILING_IDS = /^-\s+(T\d+)\s*:\s*(.*?)\s*\(([A-Z]{1,3}\d+(?:\s*,\s*[A-Z]{1,3}\d+)*)\)\s*((?:\[[^\]]*\]\s*)*)$/
/** `- B7: text (was I3)`: the planner's note that a folded item survived under a new id. */
const WAS = /^(\s*-\s+([A-Z]{1,3}\d+)\b.*?)\s*\(was\s+([A-Z]{1,3}\d+)\)\s*$/

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

/** Strips the planner's `(was X)` notes and returns what they say: old id → new id. */
export function collectRenames(specText: string): { spec: string; renames: Map<string, string> } {
  const renames = new Map<string, string>()
  const lines = specText.split(/\r?\n/).map((line) => {
    const match = WAS.exec(line)
    if (!match) return line
    renames.set(match[3]!, match[2]!)
    return match[1]!
  })
  return { spec: lines.join('\n'), renames }
}

/** Rewrites every whole-word occurrence of a renamed id, in whatever file refers to it. */
export function applyRenames(text: string, renames: Map<string, string>): string {
  let result = text
  for (const [from, to] of renames) result = result.replace(new RegExp(`\\b${from}\\b`, 'g'), to)
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

  const parsed = parseSpecText(specText)
  const board = await readTasks(tasks)
  if (board.exists && board.spec === undefined && parsed.problems.length === 0) {
    await stampSpecFingerprint(tasks, specFingerprint(parsed))
    report.steps.push('stamped the tasks file with the spec it was mapped from.')
  }

  try {
    await readAmendments(intentPath(cwd, feature))
  } catch (error) {
    report.problems.push(`intent file cannot be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  report.problems.push(...parsed.problems)
  return report
}
