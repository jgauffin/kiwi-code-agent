import { matchesGlob } from 'node:path'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { projectPaths, type ProjectPaths } from '../permissions/project-paths'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { CODE_OUTLINE_TOOL } from '../code-outline/code-outline-tool'
import { CODE_SEARCH_TOOL } from '../code-outline/code-search'

export type Scope = {
  /** Globs, workspace-relative, of what Read and Glob may see. */
  readable: string[]
  /** Globs, workspace-relative, of what Write and Edit may touch. */
  writable: string[]
  /** Globs a write may reach only with the user's say-so: neither the phase's deliverable nor off limits, so the ordinary permission prompt decides. */
  askable?: string[]
  /** Globs carved out of `readable`; a match is denied even when readable allows it. */
  ignored?: string[]
}

/**
 * Whether a file, workspace-relative, is one the phase may read: the rule Read
 * is held to, for a tool that reads files it finds on its own under a path
 * the guard already let through.
 */
export function readableIn(scope: Scope): (relPath: string) => boolean {
  return (rel) => !(scope.ignored ?? []).some((g) => matchesGlob(rel, g)) && scope.readable.some((g) => matchesGlob(rel, g))
}

/**
 * Enforces a phase's file scope at the tool call, where the model cannot
 * talk its way around it. A blind planner reads the docs and the specs and
 * writes one spec; everything else is denied with the reason. A write inside
 * the scope is the phase's deliverable, so it goes through without a
 * permission prompt.
 */
export class ScopeGuard implements SessionHooks {
  private readonly paths: ProjectPaths

  constructor(
    cwd: string,
    private readonly scope: Scope,
  ) {
    this.paths = projectPaths(cwd)
  }

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    const input = (typeof tool.input === 'object' && tool.input !== null ? tool.input : {}) as Record<string, unknown>
    switch (tool.toolName) {
      case 'Read':
        return this.check(input['file_path'], this.scope.readable, 'read')
      case 'Glob':
      case 'Grep':
      case MARKDOWN_SEARCH_TOOL:
      case CODE_OUTLINE_TOOL:
      case CODE_SEARCH_TOOL:
        return this.check(input['path'] ?? '.', this.scope.readable, 'search', true)
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
        return this.write(input['file_path'])
      case 'NotebookEdit':
        return this.write(input['notebook_path'])
      case 'Bash':
      case 'PowerShell':
        return { deny: `${tool.toolName} is not available in this phase.` }
      default:
        return undefined
    }
  }

  /** A deliverable is allowed outright; an askable path is left to the permission prompt; anything else is denied. */
  private write(raw: unknown): PreToolUseOutcome {
    const denied = this.check(raw, this.scope.writable, 'write')
    if (denied === undefined) return { allow: true }
    if (this.scope.askable && this.check(raw, this.scope.askable, 'write') === undefined) return undefined
    return denied
  }

  private check(raw: unknown, globs: string[], verb: string, directory = false): PreToolUseOutcome {
    if (typeof raw !== 'string') return { deny: `Cannot ${verb}: no path given.` }
    if (!this.paths.inside(raw)) return { deny: `Cannot ${verb} outside the workspace: ${raw}` }
    const rel = this.paths.relative(raw)
    const ignored = (this.scope.ignored ?? []).find((g) => matchesGlob(rel, g) || (directory && matchesGlob(`${rel}/x`, g)))
    if (ignored) return { deny: `Cannot ${verb} ${raw}: excluded from this phase by the ignore setting (${ignored}).` }
    // A search directory must itself lie inside the allowed tree, or be the
    // folder a readable glob picks files from: searching from the workspace
    // root would list names of files the phase must not see, while listing
    // `plan/` beside the specs gives away nothing but the other plan files' names.
    const allowed = globs.some((g) => matchesGlob(rel, g) || (directory && (matchesGlob(`${rel}/x`, g) || g.startsWith(`${rel}/`))))
    if (allowed) return undefined
    if (globs.length === 0) return { deny: `Cannot ${verb} ${raw}: this phase writes nothing.` }
    return { deny: `Cannot ${verb} ${raw}: this phase is limited to ${globs.join(', ')}.` }
  }
}
