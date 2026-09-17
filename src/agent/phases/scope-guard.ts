import { isAbsolute, matchesGlob, relative, resolve } from 'node:path'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'

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
 * Enforces a phase's file scope at the tool call, where the model cannot
 * talk its way around it. A blind planner reads the docs and the specs and
 * writes one spec; everything else is denied with the reason. A write inside
 * the scope is the phase's deliverable, so it goes through without a
 * permission prompt.
 */
export class ScopeGuard implements SessionHooks {
  constructor(
    private readonly cwd: string,
    private readonly scope: Scope,
  ) {}

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    const input = (typeof tool.input === 'object' && tool.input !== null ? tool.input : {}) as Record<string, unknown>
    switch (tool.toolName) {
      case 'Read':
        return this.check(input['file_path'], this.scope.readable, 'read')
      case 'Glob':
      case 'Grep':
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
    const absolute = isAbsolute(raw) ? raw : resolve(this.cwd, raw)
    const rel = relative(this.cwd, absolute).split('\\').join('/')
    if (rel.startsWith('..')) return { deny: `Cannot ${verb} outside the workspace: ${raw}` }
    const ignored = (this.scope.ignored ?? []).find((g) => matchesGlob(rel, g) || (directory && matchesGlob(`${rel}/x`, g)))
    if (ignored) return { deny: `Cannot ${verb} ${raw}: excluded from this phase by the ignore setting (${ignored}).` }
    // A search directory must itself lie inside the allowed tree, or be the
    // folder a readable glob picks files from: searching from the workspace
    // root would list names of files the phase must not see, while listing
    // `plan/` beside the specs gives away nothing but the other plan files' names.
    const allowed = globs.some((g) => matchesGlob(rel, g) || (directory && (matchesGlob(`${rel}/x`, g) || g.startsWith(`${rel}/`))))
    if (allowed) return undefined
    return { deny: `Cannot ${verb} ${raw}: this phase is limited to ${globs.join(', ')}.` }
  }
}
