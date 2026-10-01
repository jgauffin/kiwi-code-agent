import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Said to a session in a project with a `package.json`: its scripts run without
 * a permission prompt, where npx, tsc or a binary under node_modules asks every
 * time, and a script the user can read is safer than an ad-hoc command. Empty
 * when the workspace has no `package.json`.
 */
export function projectScriptsInstruction(cwd: string): string {
  if (!existsSync(join(cwd, 'package.json'))) return ''
  const runner = existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb')) ? 'bun run' : 'npm run'
  return `Run builds, tests and tools through the package.json scripts with \`${runner} <script>\`, passing arguments after \`--\`, rather than npx, tsc or other binaries directly: a script runs without a permission prompt. When no script fits a command you will run more than once, add one.`
}

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
