import { isAbsolute, matchesGlob, relative, resolve } from 'node:path'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'

export type Scope = {
  /** Globs, workspace-relative, of what Read and Glob may see. */
  readable: string[]
  /** Globs, workspace-relative, of what Write and Edit may touch. */
  writable: string[]
  /** Globs carved out of `readable`; a match is denied even when readable allows it. */
  ignored?: string[]
}

/**
 * Enforces a phase's file scope at the tool call, where the model cannot
 * talk its way around it. A blind planner reads intent docs and writes one
 * spec; everything else is denied with the reason. A write inside the scope
 * is the phase's deliverable, so it goes through without a permission prompt.
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
        return this.check(input['file_path'], this.scope.writable, 'write') ?? { allow: true }
      case 'NotebookEdit':
        return this.check(input['notebook_path'], this.scope.writable, 'write') ?? { allow: true }
      case 'Bash':
      case 'PowerShell':
        return { deny: `${tool.toolName} is not available in this phase.` }
      default:
        return undefined
    }
  }

  private check(raw: unknown, globs: string[], verb: string, directory = false): PreToolUseOutcome {
    if (typeof raw !== 'string') return { deny: `Cannot ${verb}: no path given.` }
    const absolute = isAbsolute(raw) ? raw : resolve(this.cwd, raw)
    const rel = relative(this.cwd, absolute).split('\\').join('/')
    if (rel.startsWith('..')) return { deny: `Cannot ${verb} outside the workspace: ${raw}` }
    const ignored = (this.scope.ignored ?? []).find((g) => matchesGlob(rel, g) || (directory && matchesGlob(`${rel}/x`, g)))
    if (ignored) return { deny: `Cannot ${verb} ${raw}: excluded from this phase by the ignore setting (${ignored}).` }
    // A search directory must itself lie inside the allowed tree: searching
    // from the workspace root would list names of files the phase must not see.
    const allowed = globs.some((g) => matchesGlob(rel, g) || (directory && matchesGlob(`${rel}/x`, g)))
    if (allowed) return undefined
    return { deny: `Cannot ${verb} ${raw}: this phase is limited to ${globs.join(', ')}.` }
  }
}
