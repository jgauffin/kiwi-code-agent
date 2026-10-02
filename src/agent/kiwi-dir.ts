import { mkdir, rename, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { errorMessage } from '../error-message'
import { exists, namesIn } from './workspace-files'

/** The extension's own folder in a workspace and in the user's home: run logs, maps, working files, scratch, skills. Never committed. */
export const KIWI_DIR = '.kiwi'

/** One folder moved to where the current layout keeps it, as it is shown: workspace-relative, or under `~/`. */
export type LayoutMove = { from: string; to: string }

/** One entry the system refused to move, as it is shown, with what it said. */
export type LayoutFailure = { path: string; reason: string }

export type LayoutReport = {
  moved: LayoutMove[]
  /** Entries left where they were because their new place already holds one of that name. */
  blocked: string[]
  /** Entries left where they were because the move itself failed. */
  failed: LayoutFailure[]
}

/**
 * What `.agent/` held when it was ours. Only these move: the name is generic
 * enough that another tool may keep its own files there.
 */
const AGENT_ENTRIES: Record<string, string> = {
  'docs-map': 'docs-map',
  'repo-map': 'repo-map',
  runs: 'runs',
  sessions: 'sessions',
  scratch: 'scratch',
  skills: 'skills',
  plan: 'specs',
}

/**
 * Moves a workspace laid out before the rename into the current layout:
 * `.agent/` to `.kiwi/`, `plan/` to `specs/`, and the user's own skills from
 * `~/.agent/skills`. Nothing is overwritten: an entry whose new place is
 * taken stays where it was and is reported. One entry the system refuses to
 * move never stops the others: everything that can move, moves.
 */
export async function migrateLayout(cwd: string, home: string): Promise<LayoutReport> {
  const report: LayoutReport = { moved: [], blocked: [], failed: [] }
  for (const [from, to] of Object.entries(AGENT_ENTRIES)) {
    await moveFolder(cwd, `.agent/${from}`, `${KIWI_DIR}/${to}`, '', report)
  }
  await removeIfEmpty(join(cwd, '.agent'))
  await moveFolder(cwd, 'plan', 'specs', '', report)
  await moveFolder(home, '.agent/skills', `${KIWI_DIR}/skills`, '~/', report)
  await removeIfEmpty(join(home, '.agent'))
  return report
}

/**
 * The whole folder in one rename when its new place is free, otherwise entry by
 * entry. Windows refuses a folder rename while anything under it is held open,
 * so a refused folder is tried entry by entry too, and only the entries that
 * stay put are reported.
 */
async function moveFolder(root: string, from: string, to: string, shownAs: string, report: LayoutReport): Promise<void> {
  const source = join(root, from)
  if (!(await exists(source))) return
  const target = join(root, to)
  if (!(await exists(target)) && (await renamed(join(target, '..'), source, target))) {
    report.moved.push({ from: `${shownAs}${from}`, to: `${shownAs}${to}` })
    return
  }
  for (const name of await namesIn(source)) {
    if (await exists(join(target, name))) {
      report.blocked.push(`${shownAs}${from}/${name}`)
      continue
    }
    try {
      await mkdir(target, { recursive: true })
      await rename(join(source, name), join(target, name))
      report.moved.push({ from: `${shownAs}${from}/${name}`, to: `${shownAs}${to}/${name}` })
    } catch (error) {
      report.failed.push({ path: `${shownAs}${from}/${name}`, reason: errorMessage(error) })
    }
  }
  await removeIfEmpty(source)
}

/** Whether the rename went through; a refusal is the caller's to work around, entry by entry. */
async function renamed(parent: string, source: string, target: string): Promise<boolean> {
  try {
    await mkdir(parent, { recursive: true })
    await rename(source, target)
    return true
  } catch {
    return false
  }
}

async function removeIfEmpty(dir: string): Promise<void> {
  if ((await exists(dir)) && (await namesIn(dir)).length === 0) await rmdir(dir)
}
