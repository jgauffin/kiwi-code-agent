import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { applyEdit, filePath, textEdit } from './edit'
import { fail, ok, type Tool } from './tool'

const schema = z.object({
  file_path: filePath,
  edits: z.array(textEdit).min(1).describe('Applied in order, each to the result of the one before'),
})

/**
 * Several edits to one file in one call. A model whose provider takes one
 * tool call per reply would otherwise pay a round trip per edit. All or
 * nothing: an edit that cannot apply leaves the file as it was, so the model
 * never has to work out which of its edits landed.
 */
export const multiEditTool: Tool<typeof schema> = {
  name: 'MultiEdit',
  description:
    'Makes several exact-text replacements in one file that has been read in this session, in order, each applied to the result of the one before. Each old_string follows the Edit rules. If any edit fails, none is written.',
  schema,
  readOnly: false,
  async execute(input, ctx) {
    const path = isAbsolute(input.file_path) ? input.file_path : resolve(ctx.cwd, input.file_path)
    const reason = await ctx.files.staleness(path)
    if (reason) return fail(reason)
    let content = await readFile(path, 'utf8')
    const ranges = []
    for (const [index, edit] of input.edits.entries()) {
      const result = applyEdit(content, edit, path)
      if ('error' in result) return fail(`Edit ${index + 1}: ${result.error}. Nothing was written.`)
      content = result.updated
      ranges.push(result.lines)
    }
    await writeFile(path, content, 'utf8')
    await ctx.files.markRead(path)
    for (const range of ranges) ctx.ledger?.edited(path, range)
    return ok(`Edited ${path} (${input.edits.length} edit${input.edits.length === 1 ? '' : 's'})`)
  },
}
