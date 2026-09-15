import { dirname } from 'node:path'
import type { Thresholds } from '../cleanup/oversized'
import type { Scope } from './scope-guard'

/**
 * The cleanup run splits what a feature's implementation left oversized. It
 * sees everything and may write the flagged files and new files beside them:
 * a split lands in a sibling, never further away. No shell: the tests run for
 * it once it stops.
 */
export const CLEANUP_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Skill']

export function cleanupScope(files: string[]): Scope {
  const writable = new Set<string>()
  for (const file of files) {
    writable.add(file)
    const dir = dirname(file)
    writable.add(dir === '.' ? '*' : `${dir}/*`)
  }
  return { readable: ['**'], writable: [...writable] }
}

/**
 * The first prompt of a cleanup run: the report is the whole assignment. A run
 * continuing the implementer's conversation has the files, their callers and
 * their tests in context already.
 */
export function cleanupKickoff(report: string, continued: boolean): string {
  const wrote = continued ? ' in files you wrote; what you read of them and their callers holds unless a tool result says a file changed' : ''
  return `These units exceed the size limits${wrote}:\n\n${report}\n\nSplit them.`
}

export function cleanupPrompt(feature: string, cwd: string, thresholds: Thresholds): string {
  const limits = [
    thresholds.functionLines > 0 ? `a function ${thresholds.functionLines} code lines` : '',
    thresholds.typeLines > 0 ? `a type ${thresholds.typeLines}` : '',
    thresholds.fileLines > 0 ? `a file ${thresholds.fileLines}` : '',
  ]
    .filter((l) => l.length > 0)
    .join(', ')
  return `You are cleaning up after the implementation of the feature "${feature}" under ${cwd}: the units listed in the first message grew past the size limits (${limits}), and you split them.

The feature is built and its tests pass. Nothing about what the code does changes here: same behaviour, same public API, same test outcomes. The only change is shape.

Split by responsibility: a function that does two things becomes two, a helper that does not need the enclosing state moves out, a type that has grown two roles becomes two types. A piece that belongs elsewhere goes into a new file beside the one it came from, named for what it holds. The pieces keep the names and the style of the code around them; a new export exists only because a split forced it.

Rules:
- Edit only the files listed and new files in their folders; everything else is read-only.
- Read a file whole before splitting it, and read its callers and its tests so the split does not break a name they use.
- Keep behaviour: no rewrite, no rename for taste, no "while I am here" change to logic, no reformatting of lines the split does not touch.
- A unit that cannot be split without changing behaviour is left alone; say which and why in one line.
- When every listed unit is within its limit or accounted for, stop. Say nothing more: the sizes are measured again and the tests are run for you.`
}
