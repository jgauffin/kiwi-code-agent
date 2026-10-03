import type { SessionEvent } from '../agent/session/code-session'
import { MOVES_FILE } from '../agent/phases/cleanup'
import { progressLine } from '../agent/phases/reconcile'
import type { CleanupUnit } from './protocol'

/** Waiting for the run to reach its file, being worked on, measured within its limit, or still over it once the run ended. */
export type UnitState = 'waiting' | 'working' | 'within' | 'over'

export type UnitProgress = CleanupUnit & { state: UnitState }

/** The run splitting, stopped on a question to the person, the tests running after it, or how that ended. */
export type CleanupStage = 'splitting' | 'asking' | 'testing' | 'done' | 'failed'

/**
 * A cleanup run's split as the Cleanup tab shows it: the units the sweep
 * flagged and where each stands, the files the split created, and whether
 * pieces were noted to move elsewhere. The chat holds the detail.
 */
export type CleanupProgress = {
  units: UnitProgress[]
  /** Workspace-relative, in the order they were written. */
  newFiles: string[]
  /** Where the run noted pieces that belong in a file already there; absent until it noted one. */
  movesFile?: string
  /** The run's latest step, one line. */
  activity?: string
  stage: CleanupStage
  outcome?: string
}

const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write'])

export function startProgress(units: CleanupUnit[]): CleanupProgress {
  return { units: units.map((u) => ({ ...u, state: 'waiting' })), newFiles: [], stage: 'splitting' }
}

const isFlagged = (progress: CleanupProgress, path: string): boolean => progress.units.some((u) => u.path === path)

const sameUnit = (a: CleanupUnit, b: CleanupUnit): boolean => a.path === b.path && a.name === b.name && a.kind === b.kind

/** `relativeTo` turns a path the run named into the workspace-relative form the units carry. */
export function advance(progress: CleanupProgress, event: SessionEvent, relativeTo: (path: string) => string): CleanupProgress {
  const line = progressLine(event, 'Cleanup')
  let next: CleanupProgress = line === undefined ? progress : { ...progress, activity: line }
  switch (event.type) {
    case 'tool_call': {
      const file = FILE_TOOLS.has(event.name) ? filePath(event.input) : undefined
      const path = file === undefined ? undefined : relativeTo(file)
      if (path === undefined || !isFlagged(next, path)) break
      next = { ...next, units: next.units.map((u) => (u.path === path && u.state === 'waiting' ? { ...u, state: 'working' } : u)) }
      break
    }
    case 'tool_result': {
      if (event.isError || !event.edit) break
      const path = relativeTo(event.edit.path)
      if (path === MOVES_FILE) next = { ...next, movesFile: MOVES_FILE }
      else if (!isFlagged(next, path) && !next.newFiles.includes(path)) next = { ...next, newFiles: [...next.newFiles, path] }
      break
    }
    case 'question_request':
      next = { ...next, stage: 'asking' }
      break
    case 'question_resolved':
      if (next.stage === 'asking') next = { ...next, stage: 'splitting' }
      break
  }
  return next
}

/** The flagged file an edit just changed, which is measured again so the tab follows the split as it lands. */
export function editedUnitFile(progress: CleanupProgress, event: SessionEvent, relativeTo: (path: string) => string): string | undefined {
  if (event.type !== 'tool_result' || event.isError || !event.edit) return undefined
  const path = relativeTo(event.edit.path)
  return isFlagged(progress, path) ? path : undefined
}

/** One file measured again: its units the measure no longer flags are within their limit. Matched by name, since a split moves lines. */
export function measured(progress: CleanupProgress, path: string, stillOver: CleanupUnit[]): CleanupProgress {
  return {
    ...progress,
    units: progress.units.map((u) => {
      if (u.path !== path) return u
      const over = stillOver.some((o) => sameUnit(o, u))
      return over ? { ...u, state: u.state === 'within' ? 'working' : u.state } : { ...u, state: 'within' }
    }),
  }
}

/** The run ended: what the last measure still flags is over, the rest within; the tests run next. */
export function finished(progress: CleanupProgress, stillOver: CleanupUnit[]): CleanupProgress {
  return {
    ...progress,
    stage: 'testing',
    units: progress.units.map((u) => ({ ...u, state: stillOver.some((o) => sameUnit(o, u)) ? 'over' : 'within' })),
  }
}

export function settled(progress: CleanupProgress, ok: boolean, outcome: string): CleanupProgress {
  return { ...progress, stage: ok ? 'done' : 'failed', outcome }
}

/** The person talks to a cleanup that had ended: it splits again, and what was still over waits for it once more. */
export function resumed(progress: CleanupProgress): CleanupProgress {
  const { outcome: _outcome, ...rest } = progress
  return { ...rest, stage: 'splitting', units: progress.units.map((u) => (u.state === 'over' ? { ...u, state: 'waiting' } : u)) }
}

function filePath(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const value = (input as Record<string, unknown>)['file_path']
  return typeof value === 'string' ? value : undefined
}
