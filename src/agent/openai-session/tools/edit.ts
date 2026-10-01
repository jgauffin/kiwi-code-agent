import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import type { LineRange } from '../file-ledger'
import { fail, ok, type Tool } from './tool'

/**
 * How an edit is written so it costs little and lands where meant. Shared by
 * every prompt whose session edits files, on either engine: the Claude engine
 * has no MultiEdit, so several Edit calls in one reply are its way to batch.
 */
export const EDIT_WRITING =
  'When you edit, old_string is the shortest text that occurs once in the file and contains what changes: the sentence, not its paragraph. To add text after a line, anchor on that line alone. Send the edits you have planned together rather than one per turn: several Edit calls in one reply, or one MultiEdit per file where you have that tool.'

export const filePath = z.string().describe('Path to the file, absolute or relative to the working directory')

export const textEdit = z.object({
  old_string: z.string().describe('Exact text to replace; must occur once unless replace_all is set'),
  new_string: z.string().describe('Replacement text'),
  replace_all: z.boolean().optional().describe('Replace every occurrence'),
})

export type TextEdit = z.infer<typeof textEdit>

const schema = z.object({ file_path: filePath, ...textEdit.shape })

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
    const result = applyEdit(await readFile(path, 'utf8'), input, path)
    if ('error' in result) return fail(result.error)
    await writeFile(path, result.updated, 'utf8')
    await ctx.files.markRead(path)
    ctx.ledger?.edited(path, result.lines)
    return ok(`Edited ${path} (${result.occurrences} replacement${result.occurrences === 1 ? '' : 's'})`)
  },
}

export type AppliedEdit = { updated: string; occurrences: number; lines: LineRange }

/** One edit applied to the content in memory, or why it cannot be. Nothing is written here. */
export function applyEdit(content: string, edit: TextEdit, path: string): AppliedEdit | { error: string } {
  if (edit.old_string === edit.new_string) return { error: 'old_string and new_string are identical' }
  const occurrences = count(content, edit.old_string)
  if (occurrences === 0) return { error: `old_string not found in ${path}` }
  if (occurrences > 1 && !edit.replace_all) {
    return { error: `old_string occurs ${occurrences} times in ${path}; add more context or set replace_all` }
  }
  const updated = edit.replace_all
    ? content.split(edit.old_string).join(edit.new_string)
    : content.replace(edit.old_string, () => edit.new_string)
  return { updated, occurrences, lines: changedLines(content, edit.old_string, edit.new_string, occurrences) }
}

/**
 * Where the replacement landed in the new text, 1-based and inclusive: the
 * first match's line to the last match's end, moved by the lines each
 * replacement adds or removes. The arguments carry no line numbers, so this is
 * what tells the ledger where the work was.
 */
function changedLines(before: string, oldString: string, newString: string, occurrences: number): LineRange {
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
