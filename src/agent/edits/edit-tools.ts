/**
 * Which steps write a file, and what a step would do to the content it finds.
 * Used to show a proposed change before it runs and to split a step that
 * carries several edits into one diff per edit.
 */

/** A file edit is any step that writes a file; a notebook edit writes a cell inside JSON, so it counts too. */
const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** A notebook cell is not readable as a text diff; such a step is reported in summary form. */
const UNDIFFABLE_TOOLS = new Set(['NotebookEdit'])

export function isFileEdit(toolName: string): boolean {
  return FILE_EDIT_TOOLS.has(toolName)
}

export function isDiffable(toolName: string): boolean {
  return !UNDIFFABLE_TOOLS.has(toolName)
}

/** The file a step writes, as the step names it; relative paths are the caller's to resolve. */
export function editedPath(input: unknown): string | undefined {
  const record = asRecord(input)
  const value = record['file_path'] ?? record['notebook_path']
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * The content after each edit the step carries, starting with what is on disk
 * now: `[before, after]` for one edit, one more entry per further edit.
 * `undefined` when the step's effect cannot be worked out, so the caller falls
 * back to what the file actually says once the step has run.
 */
export function applyEdits(before: string, toolName: string, input: unknown): string[] | undefined {
  const record = asRecord(input)
  switch (toolName) {
    case 'Write':
      return typeof record['content'] === 'string' ? [before, before.includes('\r\n') ? crlf(record['content']) : record['content']] : undefined
    case 'Edit': {
      const after = replace(before, record)
      return after === undefined ? undefined : [before, after]
    }
    case 'MultiEdit': {
      const edits = record['edits']
      if (!Array.isArray(edits) || edits.length === 0) return undefined
      const states = [before]
      for (const edit of edits) {
        const after = replace(states[states.length - 1]!, asRecord(edit))
        if (after === undefined) return undefined
        states.push(after)
      }
      return states
    }
    default:
      return undefined
  }
}

function replace(text: string, edit: Record<string, unknown>): string | undefined {
  const oldString = edit['old_string']
  const newString = edit['new_string']
  if (typeof oldString !== 'string' || typeof newString !== 'string') return undefined
  // An empty match is how a new file is written through Edit: there is nothing to find.
  if (oldString === '') return text === '' ? newString : undefined
  // A model writes its lines with \n, which a file kept in CRLF does not contain;
  // the edit is matched and written in the endings the file already uses.
  const [needle, replacement] = text.includes(oldString) ? [oldString, newString] : [crlf(oldString), crlf(newString)]
  if (!text.includes(needle)) return undefined
  if (edit['replace_all'] === true) return text.split(needle).join(replacement)
  return text.replace(needle, () => replacement)
}

const crlf = (text: string): string => text.replace(/\r?\n/g, '\r\n')

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}
