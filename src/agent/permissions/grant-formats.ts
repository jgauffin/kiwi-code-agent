import { classifyCommand } from './classifiers'
import { siteAt } from './shell-effects'
import { unknownPlace } from './effects'
import type { Grant } from './grants'
import { normalizePlace, resolvePlace } from './places'

/**
 * Answers written in another form, read as grants: those this extension kept
 * before grants existed, and the Claude engine's own permission rules. A rule
 * that would allow more as a grant than it said is left out rather than read
 * wider.
 */

/** Where a rule's relative paths are read from, and what `~` stands for. */
export type RuleOrigin = { workspace: string; home: string; exists(path: string): 'file' | 'directory' | undefined }

/**
 * An answer kept in the old form. One granting reading or writing a directory
 * becomes that grant; one kept for a command prefix or for changing directory
 * is dropped, and the command is asked once more.
 */
export function grantFromOldRule(rule: string, verdict: Grant['verdict'], origin: RuleOrigin): Grant | undefined {
  const match = /^([A-Za-z_][\w-]*|mcp__[\w-]+__\*)(?:\((.*)\))?$/s.exec(rule.trim())
  if (!match) return undefined
  const [, tool, pattern] = match
  if (pattern === undefined) return { verdict, command: [tool!], place: normalizePlace(origin.workspace), reach: 'tree' }
  const place = /^(read|write) (.+)$/s.exec(pattern)
  if (!place) return undefined
  const path = resolvePlace(origin.workspace, place[2]!.trim(), origin.home)
  return { verdict, action: place[1] as 'read' | 'write', place: path, reach: origin.exists(path) === 'file' ? 'file' : 'tree' }
}

/** Claude's tools that read or edit the path their rule names. */
const CLAUDE_READS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'])
const CLAUDE_EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * A rule from the Claude engine's own settings. `Bash(npm run:*)` and `Bash(git
 * status)` name a command and perhaps its subcommand; `Read(...)` and
 * `Edit(...)` name a path; a bare tool name names the tool. `root` is where
 * the settings file's relative paths are read from: the workspace for the
 * project's own settings. A rule naming more words than a command and its
 * subcommand, or an allow naming a flag, would allow more than it says.
 */
export function grantFromClaudeRule(rule: string, verdict: Grant['verdict'], origin: RuleOrigin): Grant | undefined {
  const match = /^([A-Za-z_][\w-]*)(?:\((.*)\))?$/s.exec(rule.trim())
  if (!match) return undefined
  const [, tool, pattern] = match
  const workspace = normalizePlace(origin.workspace)
  if (pattern === undefined) {
    // `mcp__server` stands for every tool of that server.
    const name = /^mcp__[^_]+(?:_[^_]+)*$/.test(tool!) && tool!.split('__').length === 2 ? `${tool}__*` : tool!
    return { verdict, command: [name], place: workspace, reach: 'tree' }
  }
  if (tool === 'Bash' || tool === 'PowerShell') return commandGrant(pattern, verdict, workspace, origin)
  if (CLAUDE_READS.has(tool!) || CLAUDE_EDITS.has(tool!)) return pathGrant(pattern, CLAUDE_READS.has(tool!) ? 'read' : 'write', verdict, origin)
  return undefined
}

function commandGrant(pattern: string, verdict: Grant['verdict'], workspace: string, origin: RuleOrigin): Grant | undefined {
  const words = pattern.replace(/:\*$|\s\*$/, '').trim().split(/\s+/).filter(Boolean)
  const [name, ...args] = words
  if (name === undefined) return undefined
  const { invocation } = classifyCommand(name, args, siteAt(unknownPlace('rule'), { home: origin.home, exists: () => undefined }))
  const flags = [...invocation.flags]
  if (invocation.operands.length > 0) return undefined
  if (flags.length > 0 && verdict === 'allow') return undefined
  return { verdict, command: invocation.command, ...(flags.length ? { flags } : {}), place: workspace, reach: 'tree' }
}

/** Claude's path patterns: `//abs`, `~/home`, `/` from the settings' project, anything else from the workspace; `/**` is the tree, `/*` the directory. */
function pathGrant(pattern: string, action: 'read' | 'write', verdict: Grant['verdict'], origin: RuleOrigin): Grant | undefined {
  let path = pattern.trim()
  let reach: Grant['reach'] = 'file'
  if (/[\\/]\*\*$/.test(path)) {
    reach = 'tree'
    path = path.replace(/[\\/]\*\*$/, '')
  } else if (/[\\/]\*$/.test(path)) {
    reach = 'directory'
    path = path.replace(/[\\/]\*$/, '')
  }
  if (/[*?[]/.test(path)) return undefined
  const absolute = path.startsWith('//') ? path.slice(1) : path.startsWith('/') ? `${origin.workspace}${path}` : path
  return { verdict, action, place: resolvePlace(origin.workspace, absolute, origin.home), reach }
}
