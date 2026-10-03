import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { LineSearch, type SearchSubject } from './line-search'
import { isMarkdown, markdownLines, parseSections, sectionAt, type Section } from './markdown/outline'
import { type Tool } from './tool'

export const MARKDOWN_SEARCH_TOOL = 'MarkdownSearch'

const schema = z.object({
  query: z.string().min(1).describe('Text to find. Taken literally unless regex is true.'),
  path: z.string().optional().describe('Markdown file or directory to search; defaults to the working directory'),
  regex: z.boolean().optional().describe('Treat query as a regular expression'),
  case_sensitive: z.boolean().optional().describe('Match case; the default ignores it'),
  limit: z.number().int().min(1).max(500).optional().describe('Maximum matching lines to return (default 50)'),
})

/** One match as a script gets it; `heading` is null before the first heading. */
type DocMatch = { file: string; line: number; text: string; heading: string | null; start: number | null; end: number | null }

/** Markdown docs, each match filed under the heading above it. */
const markdownDocs: SearchSubject<Section[], DocMatch> = {
  fileNoun: 'markdown file',
  placeNoun: 'section',
  includes: isMarkdown,
  read: (path) => readFile(path, 'utf8'),
  lines: markdownLines,
  parse: (_path, text) => parseSections(text),
  place: ({ file, line, text, parsed }) => {
    const section = sectionAt(parsed, line)
    return {
      title: titleOf(file, section, parsed[0]?.line),
      // Two sections can read alike, so where one starts is what tells them apart.
      place: `${file}#${section?.line ?? 0}`,
      item: { file, line, text, heading: section?.heading ?? null, start: section?.line ?? null, end: section?.endLine ?? null },
    }
  },
}

/**
 * Search that answers with where a match sits, not just that it exists: the
 * closest heading above it, in the `path#Heading` form a citation uses, and
 * that section's line range, so the next Read takes the section instead of
 * the doc.
 *
 * `canRead` is the session's read scope. A scope guard checks only the path
 * the search starts from, so a search over `docs` would otherwise hand back
 * the content of docs the session is kept from.
 */
export function markdownSearchTool(canRead: (relPath: string) => boolean = () => true): Tool<typeof schema> {
  const search = new LineSearch(markdownDocs, canRead)
  return {
    name: MARKDOWN_SEARCH_TOOL,
    description:
      "Searches markdown docs and returns each matching line with its file, line number and the section it sits in (`path#Heading` plus the section's line range). Read just that section with offset and limit instead of the whole doc. Literal and case-insensitive unless regex or case_sensitive is set.",
    schema,
    readOnly: true,
    execute: (input, ctx) => search.execute(input, ctx),
  }
}

function titleOf(file: string, section: Section | undefined, firstHeading: number | undefined): string {
  if (section) return `${file}#${section.heading}  (${section.line}-${section.endLine})`
  return `${file} (before first heading)${firstHeading !== undefined && firstHeading > 1 ? `  (1-${firstHeading - 1})` : ''}`
}
