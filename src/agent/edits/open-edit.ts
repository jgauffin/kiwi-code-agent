import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * What the chat asks the editor for when an edit is opened: where the snapshot
 * lives, which line the file should come up at, and what the diff tab is
 * called. Kept apart from the editor itself so the decisions can be tested.
 */

/** The run directory tree; the only place a snapshot the chat links to may lie. */
export function runsRoot(workspaceRoot: string): string {
  return join(workspaceRoot, '.agent', 'runs')
}

/**
 * A snapshot is opened only when this extension wrote it. The path comes back
 * from a webview, so it is checked against the run directory rather than
 * trusted, and nothing outside it is ever put in front of the user.
 */
export function isRunSnapshot(root: string, snapshot: string): boolean {
  if (!isAbsolute(snapshot)) return false
  const rel = relative(resolve(root), resolve(snapshot))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * The zero-based line to reveal, from the 1-based first changed line. A file
 * that shrank since the edit still opens: the line is clamped to what is there.
 */
export function editLine(line: number | undefined, lineCount: number): number {
  const last = Math.max(0, lineCount - 1)
  return Math.min(Math.max(0, (line ?? 1) - 1), last)
}

/** The diff tab's name: the file, and that it is the edit against the file now. */
export function editDiffTitle(label: string): string {
  return `${label} (before this edit ↔ now)`
}
