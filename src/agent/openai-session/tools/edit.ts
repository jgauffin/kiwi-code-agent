import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { fail, ok, type Tool } from './tool'

const schema = z.object({
  file_path: z.string().describe('Path to the file, absolute or relative to the working directory'),
  old_string: z.string().describe('Exact text to replace; must occur once unless replace_all is set'),
  new_string: z.string().describe('Replacement text'),
  replace_all: z.boolean().optional().describe('Replace every occurrence'),
})

export const editTool: Tool<typeof schema> = {
  name: 'Edit',
  description:
    'Replaces exact text in a file that has been read in this session. old_string must match exactly, including indentation, and must be unique unless replace_all is true.',
  schema,
  readOnly: false,
  async execute(input, ctx) {
    const path = isAbsolute(input.file_path) ? input.file_path : resolve(ctx.cwd, input.file_path)
    const reason = await ctx.files.staleness(path)
    if (reason) return fail(reason)
    if (input.old_string === input.new_string) return fail('old_string and new_string are identical')
    const content = await readFile(path, 'utf8')
    const occurrences = count(content, input.old_string)
    if (occurrences === 0) return fail(`old_string not found in ${path}`)
    if (occurrences > 1 && !input.replace_all) {
      return fail(`old_string occurs ${occurrences} times in ${path}; add more context or set replace_all`)
    }
    const updated = input.replace_all
      ? content.split(input.old_string).join(input.new_string)
      : content.replace(input.old_string, () => input.new_string)
    await writeFile(path, updated, 'utf8')
    await ctx.files.markRead(path)
    ctx.ledger?.edited(path, changedLines(content, input.old_string, input.new_string, occurrences))
    return ok(`Edited ${path} (${occurrences} replacement${occurrences === 1 ? '' : 's'})`)
  },
}

/**
 * Where the replacement landed in the new text, 1-based and inclusive: the
 * first match's line to the last match's end, moved by the lines each
 * replacement adds or removes. The arguments carry no line numbers, so this is
 * what tells the ledger where the work was.
 */
function changedLines(before: string, oldString: string, newString: string, occurrences: number): { from: number; to: number } {
  const from = lineAt(before, before.indexOf(oldString))
  const end = lineAt(before, before.lastIndexOf(oldString) + oldString.length)
  return { from, to: end + (countNewlines(newString) - countNewlines(oldString)) * occurrences }
}

const lineAt = (text: string, index: number): number => countNewlines(text.slice(0, Math.max(0, index))) + 1

function countNewlines(text: string): number {
  let n = 0
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++
  return n
}

function count(haystack: string, needle: string): number {
  if (needle === '') return 0
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    n++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return n
}
