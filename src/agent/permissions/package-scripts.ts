import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The script names of the workspace root's `package.json`, read on every call
 * so a script the user has just added applies to the next command. A missing
 * or malformed file is no scripts rather than an error: the permission check
 * that asks for them must still answer.
 */
export function packageScripts(cwd: string): ReadonlySet<string> {
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { scripts?: unknown }
    const scripts = parsed.scripts
    if (typeof scripts !== 'object' || scripts === null) return new Set()
    return new Set(Object.keys(scripts as Record<string, unknown>))
  } catch {
    return new Set()
  }
}
