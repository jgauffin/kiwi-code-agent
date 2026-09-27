import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { walk } from './grep'
import { isMarkdown, markdownLines, parseSections, sectionAt, type Section } from './markdown/outline'
import { clip, searchPattern } from './search-text'
import { fail, ok, truncate, type Tool } from './tool'

export const MARKDOWN_SEARCH_TOOL = 'MarkdownSearch'

const schema = z.object({
  query: z.string().min(1).describe('Text to find. Taken literally unless regex is true.'),
  path: z.string().optional().describe('Markdown file or directory to search; defaults to the working directory'),
  regex: z.boolean().optional().describe('Treat query as a regular expression'),
  case_sensitive: z.boolean().optional().describe('Match case; the default ignores it'),
  limit: z.number().int().min(1).max(500).optional().describe('Maximum matching lines to return (default 50)'),
})

type Hit = { file: string; section: Section | undefined; firstHeading: number | undefined; line: number; text: string }

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
  return {
    name: MARKDOWN_SEARCH_TOOL,
    description:
      "Searches markdown docs and returns each matching line with its file, line number and the section it sits in (`path#Heading` plus the section's line range). Read just that section with offset and limit instead of the whole doc. Literal and case-insensitive unless regex or case_sensitive is set.",
    schema,
    readOnly: true,
    async execute(input, ctx) {
      let pattern: RegExp
      try {
        pattern = searchPattern(input)
      } catch (error) {
        return fail(`Invalid regular expression: ${(error as Error).message}`)
      }
      const root = input.path ? (isAbsolute(input.path) ? input.path : resolve(ctx.cwd, input.path)) : ctx.cwd
      const limit = input.limit ?? 50
      const hits: Hit[] = []
      const sectionsHit = new Set<string>()
      let matched = 0
      let searched = 0

      for await (const file of walk(root, undefined)) {
        if (ctx.signal.aborted) return fail('Search interrupted')
        const shown = relative(ctx.cwd, file).split('\\').join('/') || file
        if (!isMarkdown(file) || !canRead(shown)) continue
        const text = await readFile(file, 'utf8').catch(() => undefined)
        if (text === undefined) continue
        searched++
        const lines = markdownLines(text)
        let sections: Section[] | undefined
        for (let i = 0; i < lines.length; i++) {
          const found = pattern.exec(lines[i]!)
          if (!found) continue
          sections ??= parseSections(text)
          const section = sectionAt(sections, i + 1)
          matched++
          sectionsHit.add(`${shown}#${section?.line ?? 0}`)
          if (hits.length < limit) {
            hits.push({ file: shown, section, firstHeading: sections[0]?.line, line: i + 1, text: clip(lines[i]!, found.index) })
          }
        }
      }

      if (matched === 0) return ok(`No matches in ${searched} markdown file${searched === 1 ? '' : 's'}.`)
      return ok(truncate(render(hits, matched, sectionsHit.size)))
    },
  }
}

function render(hits: Hit[], matched: number, sections: number): string {
  const out: string[] = []
  let current = ''
  for (const hit of hits) {
    const title = hit.section
      ? `${hit.file}#${hit.section.heading}  (${hit.section.line}-${hit.section.endLine})`
      : `${hit.file} (before first heading)${hit.firstHeading !== undefined && hit.firstHeading > 1 ? `  (1-${hit.firstHeading - 1})` : ''}`
    if (title !== current) {
      out.push(title)
      current = title
    }
    out.push(`  ${hit.line}: ${hit.text}`)
  }
  out.push('', `${matched} match${matched === 1 ? '' : 'es'} in ${sections} section${sections === 1 ? '' : 's'}, ${hits.length} shown.`)
  return out.join('\n')
}
