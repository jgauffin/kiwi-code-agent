import { diffStats, firstChangedLine, unifiedDiff } from './unified-diff'

/** Lines of diff one step may spend in the chat, however many edits it carries. */
export const DIFF_LINE_BUDGET = 15

/** Context around a change, so the budget goes on changed lines. */
export const DIFF_CONTEXT = 3

/**
 * What one file-edit step did to its file, as the transcript keeps it. Built
 * by the extension from content it read itself, capped to what the chat shows,
 * and written to the run log so a reload renders the same thing without
 * touching the file again.
 */
export type FileEditChange = {
  /** Absolute path of the file the step writes. */
  path: string
  /** The path as the chat shows it: workspace-relative where the file lies inside. */
  label: string
  /** One unified diff per edit in the step, in order, already capped. */
  diffs: string[]
  /** Diff lines the cap left out; 0 when the whole diff is shown. */
  omitted: number
  /** Said in place of a diff: nothing changed, or the content is not readable as text. */
  summary?: string
  /** 1-based line of the first change, for opening the file where it happened. */
  line?: number
  /** The pre-edit content, kept under the session's run directory for the full-edit view. */
  snapshot?: string
  added?: number
  removed?: number
}

export type FileEditChangeInput = {
  path: string
  label: string
  /**
   * The file's content at each edit boundary: before the first edit, then
   * after each edit in the step. Two entries are one edit.
   */
  states?: string[]
  /** Why there is nothing to diff: the content is not readable as text. */
  unreadable?: string
  snapshot?: string
}

/** The link on a truncated diff says what it is hiding and where the rest is. */
export function omittedNotice(omitted: number): string {
  return `${omitted} more diff line${omitted === 1 ? '' : 's'} — open the full edit`
}

/**
 * The step's change as the chat shows it. Content that cannot be read as text
 * and a write that changed nothing both end as a one-line summary: an empty
 * diff block says less than a sentence.
 */
export function fileEditChange(input: FileEditChangeInput): FileEditChange {
  const { path, label } = input
  if (input.unreadable !== undefined || !input.states || input.states.length < 2) {
    return { path, label, diffs: [], omitted: 0, summary: `${label}: ${input.unreadable ?? 'changed'}` }
  }
  const states = input.states
  const first = states[0]!
  const last = states[states.length - 1]!
  const stats = diffStats(first, last)
  if (stats.added === 0 && stats.removed === 0) {
    return { path, label, diffs: [], omitted: 0, summary: `${label}: no change` }
  }
  const full: string[][] = []
  for (let i = 1; i < states.length; i++) {
    const diff = unifiedDiff(states[i - 1]!, states[i]!, DIFF_CONTEXT)
    if (diff.length > 0) full.push(diff)
  }
  const capped = capDiffs(full, DIFF_LINE_BUDGET)
  const line = firstChangedLine(first, last)
  return {
    path,
    label,
    diffs: capped.diffs.map((d) => d.join('\n')),
    omitted: capped.omitted,
    ...(line !== undefined ? { line } : {}),
    ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
    added: stats.added,
    removed: stats.removed,
  }
}

/**
 * The first `budget` lines of the step's diffs, whichever edit they belong to:
 * one step cannot flood the chat however many edits it carries.
 */
export function capDiffs(diffs: string[][], budget: number): { diffs: string[][]; omitted: number } {
  const total = diffs.reduce((sum, d) => sum + d.length, 0)
  if (total <= budget) return { diffs, omitted: 0 }
  const kept: string[][] = []
  let spent = 0
  for (const diff of diffs) {
    if (spent >= budget) break
    const room = budget - spent
    kept.push(diff.slice(0, room))
    spent += Math.min(room, diff.length)
  }
  return { diffs: kept, omitted: total - spent }
}
