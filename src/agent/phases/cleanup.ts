import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { EDIT_WRITING } from '../openai-session/tools/edit'
import { CODE_READING } from '../code-outline/code-outline-gate'
import { CODE_OUTLINE_TOOL } from '../code-outline/code-outline-tool'
import { CODE_SEARCH_TOOL } from '../code-outline/code-search'
import type { Limits, Thresholds } from '../cleanup/oversized'
import type { Scope } from './scope-guard'

/**
 * The cleanup run splits what a feature's implementation left oversized. It
 * sees everything and may write the flagged files and create new ones
 * anywhere, so a split lands where it belongs; every other file already
 * there stays read-only. No shell: the tests run for it once it
 * stops. AskUser is there so code whose intent is unclear is asked about
 * instead of split on a guess.
 */
export const CLEANUP_TOOLS = ['Read', 'Glob', 'Grep', 'CodeOutline', 'CodeSearch', 'Edit', 'MultiEdit', 'Write', 'Skill', ASK_USER_TOOL]

/**
 * Split-out code that belongs in a file already there, with where it should
 * go. The run cannot edit that file, so the user works through this list
 * later. One file for every feature, committed.
 */
export const MOVES_FILE = 'specs/unfiled-moves.md'

/** `memoryDir` is the project's memory folder, outside the workspace: the run starts with its index and opens a note there. */
export function cleanupScope(files: string[], memoryDir?: string): Scope {
  return { readable: ['**'], writable: [...files, MOVES_FILE], creatable: ['**'], ...(memoryDir ? { readableOutside: [memoryDir] } : {}) }
}

/**
 * The first prompt of a cleanup run: the report is the whole assignment. A run
 * continuing the implementer's conversation has the files, their callers and
 * their tests in context already.
 */
export function cleanupKickoff(report: string, continued: boolean): string {
  const wrote = continued ? ' in files you wrote; what you read of them and their callers holds unless a tool result says a file changed' : ''
  return `These units exceed the limits${wrote}:\n\n${report}\n\nSplit them.`
}

/** One bullet per limit in force, each named with its unit; a limit of 0 is off and says nothing. `test` names a test file's limits. */
const describe = (thresholds: Thresholds, test: boolean): string[] => {
  const label = (name: string): string => (test ? `Test ${name.toLowerCase()}` : name)
  return [
    thresholds.functionComplexity > 0 ? `${label('Function cognitive complexity')}: ${thresholds.functionComplexity}` : '',
    thresholds.functionLines > 0 ? `${label('Function length')}: ${thresholds.functionLines} code lines` : '',
    thresholds.typeLines > 0 ? `${label('Type length')}: ${thresholds.typeLines} lines` : '',
    thresholds.fileLines > 0 ? `${label('File length')}: ${thresholds.fileLines} lines` : '',
  ]
    .filter((l) => l.length > 0)
    .map((l) => `- ${l}`)
}

export function cleanupPrompt(feature: string, cwd: string, limits: Limits): string {
  const stated = [...describe(limits.source, false), ...describe(limits.tests, true)].join('\n')
  return `You are cleaning up after the implementation of the feature "${feature}" under ${cwd}: the units listed in the first message grew past these limits, and you split them.

${stated}

The feature is built and its tests pass. Nothing about what the code does changes here: same behaviour, same public API, same test outcomes. The only change is shape.

Split by responsibility: a function that does two things becomes two, a helper that does not need the enclosing state moves out, a type that has grown two roles becomes two types. Cognitive complexity counts each branch, loop and catch as one plus how deeply it is nested, and each else and each change of boolean operator as one: a function over that limit comes down when a nested branch or a loop body becomes a function of its own, a nested condition becomes an early return, or a compound condition gets a name. A piece that belongs elsewhere goes into a new file named for what it holds, in the folder it belongs in: beside the one it came from when it serves the same thing, in a subfolder named for its concern when several pieces of it move out together, or in the folder that already holds code of its kind. The pieces keep the names and the style of the code around them; a new export exists only because a split forced it. A test file stays one file per tested file: shorten it with shared setup and helpers, and move tests to another test file only when the code they test moved to another file.

Plan the split from ${CODE_OUTLINE_TOOL} before reading any body: the outline of a listed file gives its types and functions with their line ranges, which is where its responsibilities show and where it divides. Find the callers and tests of what you move with its symbol parameter and ${CODE_SEARCH_TOOL}. Then Read the ranges you move and the lines around them. ${CODE_READING}

Work across the files, not one after the other: every tool call in a reply runs before your next turn, and each turn is a round trip. Outline every listed file in one reply, read the ranges of several files in the next, and write the splits of several small files in one reply. A large file with many units may take a pass of its own. ${EDIT_WRITING}

When a piece belongs in a file that already exists, which you cannot edit, it goes into a new file of its own and you record it in \`${MOVES_FILE}\` for the user to move later: an entry is \`### <the new file's path>\`, then \`- holds: <what is in it, one sentence>\` and \`- move to: <the file it belongs in, and why>\`. Add yours with Edit, or create the file with Write, and leave the other entries alone.

When you cannot tell what a piece of code is meant to do, so that splitting it might change what it does (two paths that look alike but differ, a condition whose purpose the code and its tests do not show), put the question with the \`${ASK_USER_TOOL}\` tool and split on the answer rather than on a guess.

Rules:
- Edit only the files listed, the new files you create and \`${MOVES_FILE}\`; every other file already there is read-only.
- Know every caller and test of what you move before moving it, so the split does not break a name they use.
- Keep behaviour: no rewrite, no rename for taste, no "while I am here" change to logic, no reformatting of lines the split does not touch.
- A unit that cannot be split without changing behaviour is left alone; say which and why in one line.
- When every listed unit is within its limits or accounted for, stop. Say nothing more: the sizes are measured again and the tests are run for you.`
}
