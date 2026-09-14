import { glob, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { fail, ok, truncate, type Tool } from './tool'

/** Directories no search should descend into. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'out', '.vs', '.idea'])

const schema = z.object({
  pattern: z.string().describe('Glob pattern, e.g. "src/**/*.ts"'),
  path: z.string().optional().describe('Directory to search in; defaults to the working directory'),
})

export const globTool: Tool<typeof schema> = {
  name: 'Glob',
  description: 'Finds files by glob pattern. Results are sorted by modification time, newest first.',
  schema,
  readOnly: true,
  async execute(input, ctx) {
    const root = input.path ? (isAbsolute(input.path) ? input.path : resolve(ctx.cwd, input.path)) : ctx.cwd
    const found: { path: string; mtime: number }[] = []
    try {
      for await (const entry of glob(input.pattern, {
        cwd: root,
        exclude: (name: string) => IGNORED_DIRS.has(name),
      })) {
        const full = resolve(root, entry)
        const info = await stat(full).catch(() => undefined)
        if (info?.isFile()) found.push({ path: full, mtime: info.mtimeMs })
        if (found.length >= 1000) break
      }
    } catch (error) {
      return fail(`Glob failed: ${(error as Error).message}`)
    }
    if (found.length === 0) return ok('No files matched.')
    found.sort((a, b) => b.mtime - a.mtime)
    return ok(truncate(found.map((f) => f.path).join('\n')))
  },
}
