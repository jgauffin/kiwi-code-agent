import { cp, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { fail, ok, type Tool, type ToolContext, type ToolOutput } from './tool'

const schema = z.object({
  source: z.string().describe('File or folder to take, absolute or relative to the working directory'),
  destination: z.string().describe('Full new path of the file or folder, not the folder to put it in; must not exist yet'),
})

export const moveTool: Tool<typeof schema> = {
  name: 'Move',
  description: 'Moves or renames a file or folder. Missing parent folders are created; an existing destination is never overwritten.',
  schema,
  readOnly: false,
  execute: (input, ctx) => transfer(input, ctx, 'move'),
}

export const copyTool: Tool<typeof schema> = {
  name: 'Copy',
  description: 'Copies a file or folder, folders with everything in them. Missing parent folders are created; an existing destination is never overwritten.',
  schema,
  readOnly: false,
  execute: (input, ctx) => transfer(input, ctx, 'copy'),
}

async function transfer(input: z.infer<typeof schema>, ctx: ToolContext, kind: 'move' | 'copy'): Promise<ToolOutput> {
  const source = isAbsolute(input.source) ? input.source : resolve(ctx.cwd, input.source)
  const destination = isAbsolute(input.destination) ? input.destination : resolve(ctx.cwd, input.destination)
  if (!existsSync(source)) return fail(`Not found: ${source}`)
  if (existsSync(destination)) return fail(`Destination already exists: ${destination}. Name a path that does not exist.`)
  await mkdir(dirname(destination), { recursive: true })
  if (kind === 'copy') {
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false })
    return ok(`Copied ${source} to ${destination}`)
  }
  await rename(source, destination)
  // What was read at the old path says nothing about the new one: an edit there reads it first.
  ctx.files.forget(source)
  return ok(`Moved ${source} to ${destination}`)
}
