import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { fail, ok, type Tool } from './tool'

const schema = z.object({
  file_path: z.string().describe('Path to the file, absolute or relative to the working directory'),
  content: z.string().describe('Full new content of the file'),
})

export const writeTool: Tool<typeof schema> = {
  name: 'Write',
  description:
    'Creates or overwrites a file with the given content. An existing file must have been read first. Prefer Edit for changes to existing files.',
  schema,
  readOnly: false,
  async execute(input, ctx) {
    const path = isAbsolute(input.file_path) ? input.file_path : resolve(ctx.cwd, input.file_path)
    if (existsSync(path)) {
      const reason = await ctx.files.staleness(path)
      if (reason) return fail(reason)
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, input.content, 'utf8')
    await ctx.files.markRead(path)
    return ok(`Wrote ${path}`)
  },
}
