/** What the search tools share: turning the model's query into a pattern, and showing a long matching line. */

export type SearchQuery = { query: string; regex?: boolean | undefined; case_sensitive?: boolean | undefined }

/** The query as a pattern: literal unless `regex`, case-insensitive unless `case_sensitive`. Throws on an invalid regex. */
export function searchPattern(input: SearchQuery): RegExp {
  return new RegExp(input.regex ? input.query : escapeRegExp(input.query), input.case_sensitive ? '' : 'i')
}

/** Past this a line is shown as a window around the match. */
const MAX_LINE_CHARS = 240
const CONTEXT_BEFORE = 80

/** The line trimmed, or a window of it around the match at `at` when it is long. */
export function clip(line: string, at: number): string {
  const trimmed = line.trim()
  if (trimmed.length <= MAX_LINE_CHARS) return trimmed
  const offset = line.length - line.trimStart().length
  const start = Math.max(0, at - offset - CONTEXT_BEFORE)
  const window = trimmed.slice(start, start + MAX_LINE_CHARS)
  return `${start > 0 ? '…' : ''}${window}${start + MAX_LINE_CHARS < trimmed.length ? '…' : ''}`
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
