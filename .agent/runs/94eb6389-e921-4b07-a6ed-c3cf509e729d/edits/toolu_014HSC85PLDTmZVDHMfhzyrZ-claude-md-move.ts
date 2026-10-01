import { rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readOptional } from '../workspace-files'
import { bundleFilePath, type BundleScope } from './bundles'

/** Where a scope's `CLAUDE.md` sits: the workspace's own, or the person's under their home directory. */
export function claudeMdPath(scope: BundleScope, cwd: string, home: string = homedir()): string {
  return scope === 'project' ? join(cwd, 'CLAUDE.md') : join(home, '.claude', 'CLAUDE.md')
}

/** The heading an appended move reads under, so what it carried over is told apart from what `AGENTS.md` already held. */
const MOVED_HEADING = '## Moved from CLAUDE.md'

/**
 * What `AGENTS.md` reads once the move is made: `CLAUDE.md`'s whole text
 * when `AGENTS.md` held nothing yet, or that text appended under a heading
 * naming where it came from when `AGENTS.md` already held something of its
 * own \u2014 left exactly as it was, nothing outside the appended part touched.
 */
export function mergedAgentsText(claudeText: string, existingAgentsText: string | undefined): string {
  const existing = existingAgentsText?.trim()
  const claude = claudeText.trim()
  if (!existing) return `${claude}\n`
  return `${existing}\n\n${MOVED_HEADING}\n\n${claude}\n`
}

/** The move offered for one scope: what would change, for the person to see before they confirm it. */
export type PendingMove = {
  scope: BundleScope
  claudePath: string
  agentsPath: string
  claudeText: string
  agentsText: string | undefined
  mergedText: string
}

/** Whether this scope still has a `CLAUDE.md` with something in it \u2014 offered once, and gone once the move is made. */
export async function pendingMove(scope: BundleScope, cwd: string, home: string = homedir()): Promise<PendingMove | undefined> {
  const claudePath = claudeMdPath(scope, cwd, home)
  const claudeText = await readOptional(claudePath)
  if (!claudeText?.trim()) return undefined
  const agentsPath = bundleFilePath(scope, cwd, home)
  const agentsText = await readOptional(agentsPath)
  return { scope, claudePath, agentsPath, claudeText, agentsText, mergedText: mergedAgentsText(claudeText, agentsText) }
}

/**
 * Carries a confirmed move: writes the merged text to `AGENTS.md` and
 * removes `CLAUDE.md`, so nothing is left split between the two files once
 * it returns. Call only after the person has confirmed the change `pendingMove` shows.
 */
export async function applyMove(move: PendingMove): Promise<void> {
  await writeFile(move.agentsPath, move.mergedText, 'utf8')
  await rm(move.claudePath)
}
