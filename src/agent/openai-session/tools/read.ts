import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { fail, ok, truncate, type Tool } from './tool'

const schema = z.object({
  file_path: z.string().describe('Path to the file, absolute or relative to the working directory'),
  offset: z.number().int().min(1).optional().describe('First line to read, 1-based'),
  limit: z.number().int().min(1).optional().describe('Number of lines to read'),
})

export const readTool: Tool<typeof schema> = {
  name: 'Read',
  description:
    'Reads a text file and returns it with line numbers. Use offset and limit for large files. A file must be read before it can be edited.',
  schema,
  readOnly: true,
  async execute(input, ctx) {
    const path = isAbsolute(input.file_path) ? input.file_path : resolve(ctx.cwd, input.file_path)
    let content: string
    try {
      content = await readFile(path, 'utf8')
    } catch (error) {
      return fail(`Cannot read ${path}: ${(error as Error).message}`)
    }
    await ctx.files.markRead(path)
    const lines = content.split('\n')
    const start = (input.offset ?? 1) - 1
    const end = input.limit ? start + input.limit : lines.length
    const width = String(end).length
    const numbered = lines
      .slice(start, end)
      .map((line, i) => `${String(start + i + 1).padStart(width)}\t${line}`)
      .join('\n')
    return ok(truncate(numbered))
  },
}
