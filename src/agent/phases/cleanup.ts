import { dirname } from 'node:path'
import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { CODE_READING } from '../code-outline/code-outline-gate'
import { CODE_OUTLINE_TOOL } from '../code-outline/code-outline-tool'
import { CODE_SEARCH_TOOL } from '../code-outline/code-search'
import type { Limits, Thresholds } from '../cleanup/oversized'
import type { Scope } from './scope-guard'

/**
 * The cleanup run splits what a feature's implementation left oversized. It
 * sees everything and may write the flagged files and new files beside them:
 * a split lands in a sibling, never further away. No shell: the tests run for
 * it once it stops. AskUser is there so code whose intent is unclear is
 * asked about instead of split on a guess.
 */
export const CLEANUP_TOOLS = ['Read', 'Glob', 'Grep', 'CodeOutline', 'CodeSearch', 'Edit', 'Write', 'Skill', ASK_USER_TOOL]

/**
 * Split-out code that belongs in another folder, with where it should go. The
 * run never moves code that far itself, so the user works through this list
 * later. One file for every feature, committed.
 */
export const MOVES_FILE = 'plan/unfiled-moves.md'

export function cleanupScope(files: string[]): Scope {
  const writable = new Set<string>()
  for (const file of files) {
    writable.add(file)
    const dir = dirname(file)
    writable.add(dir === '.' ? '*' : `${dir}/*`)
  }
  return { readable: ['**'], writable: [...writable, MOVES_FILE] }
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

const describe = (thresholds: Thresholds): string =>
  [
    thresholds.functionLines > 0 ? `a function ${thresholds.functionLines} code lines` : '',
    thresholds.typeLines > 0 ? `a type ${thresholds.typeLines}` : '',
    thresholds.fileLines > 0 ? `a file ${thresholds.fileLines}` : '',
  ]
    .filter((l) => l.length > 0)
    .join(', ')

export function cleanupPrompt(feature: string, cwd: string, limits: Limits): string {
  const source = describe(limits.source)
  const tests = describe(limits.tests)
  const stated = [source, tests ? `in tests ${tests}` : ''].filter((l) => l.length > 0).join('; ')
  return `You are cleaning up after the implementation of the feature "${feature}" under ${cwd}: the units listed in the first message grew past the size limits (${stated}), and you split them.

The feature is built and its tests pass. Nothing about what the code does changes here: same behaviour, same public API, same test outcomes. The only change is shape.

Split by responsibility: a function that does two things becomes two, a helper that does not need the enclosing state moves out, a type that has grown two roles becomes two types. A piece that belongs elsewhere goes into a new file beside the one it came from, named for what it holds. The pieces keep the names and the style of the code around them; a new export exists only because a split forced it. A test file stays one file per tested file: shorten it with shared setup and helpers, and move tests to another test file only when the code they test moved to another file.

Plan the split from ${CODE_OUTLINE_TOOL} before reading any body: the outline of a listed file gives its types and functions with their line ranges, which is where its responsibilities show and where it divides. Find the callers and tests of what you move with its symbol parameter and ${CODE_SEARCH_TOOL}. Then Read the ranges you move and the lines around them. ${CODE_READING}

When a new file belongs in another folder (it serves another feature, or a shared place for it already exists), it still lands beside its source, and you record it in \`${MOVES_FILE}\` for the user to move later: an entry is \`### <the new file's path>\`, then \`- holds: <what is in it, one sentence>\` and \`- move to: <the folder or file it belongs in, and why>\`. Add yours with Edit, or create the file with Write, and leave the other entries alone.

When you cannot tell what a piece of code is meant to do, so that splitting it might change what it does (two paths that look alike but differ, a condition whose purpose the code and its tests do not show), put the question with the \`${ASK_USER_TOOL}\` tool and split on the answer rather than on a guess.

Rules:
- Edit only the files listed, new files in their folders and \`${MOVES_FILE}\`; everything else is read-only.
- Know every caller and test of what you move before moving it, so the split does not break a name they use.
- Keep behaviour: no rewrite, no rename for taste, no "while I am here" change to logic, no reformatting of lines the split does not touch.
- A unit that cannot be split without changing behaviour is left alone; say which and why in one line.
- When every listed unit is within its limit or accounted for, stop. Say nothing more: the sizes are measured again and the tests are run for you.`
}
