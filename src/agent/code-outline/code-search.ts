import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { languageOf } from '../code-structure/language'
import { walk } from '../openai-session/tools/grep'
import { clip, searchPattern } from '../openai-session/tools/search-text'
import { fail, ok, truncate, type Tool } from '../openai-session/tools/tool'
import { readSource } from '../code-structure/source-files'
import { declarationAt, outlineCode, qualifiedName, rangeStart, type CodeNode } from './outline'

export const CODE_SEARCH_TOOL = 'CodeSearch'

const schema = z.object({
  query: z.string().min(1).describe('Text to find. Taken literally unless regex is true.'),
  path: z.string().optional().describe('Source file or directory to search; defaults to the working directory'),
  regex: z.boolean().optional().describe('Treat query as a regular expression'),
  case_sensitive: z.boolean().optional().describe('Match case; the default ignores it'),
  limit: z.number().int().min(1).max(500).optional().describe('Maximum matching lines to return (default 50)'),
})

type Hit = { title: string; line: number; text: string }

/**
 * Search that answers with where a match sits: the declaration around it and
 * that declaration's line range, so the next Read takes the function instead
 * of the file. A match in a doc comment is filed under what the doc
 * documents, so searching for what code does finds the code that does it.
 *
 * `canRead` is the session's read scope; a scope guard checks only the path
 * the search starts from.
 */
export function codeSearchTool(canRead: (relPath: string) => boolean = () => true): Tool<typeof schema> {
  return {
    name: CODE_SEARCH_TOOL,
    description:
      'Searches source files and returns each matching line under the declaration it sits in (`path: Type.method (start-end)`); a match in a doc comment is filed under the declaration it documents. Read just that range with offset and limit instead of the whole file. Literal and case-insensitive unless regex or case_sensitive is set.',
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
      const places = new Set<string>()
      let matched = 0
      let searched = 0

      for await (const file of walk(root, undefined)) {
        if (ctx.signal.aborted) return fail('Search interrupted')
        const shown = relative(ctx.cwd, file).split('\\').join('/') || file
        if (!languageOf(file) || !canRead(shown)) continue
        const text = await readSource(file).catch(() => undefined)
        if (text === undefined) continue
        searched++
        const lines = text.split(/\r?\n/)
        let nodes: CodeNode[] | undefined
        for (let i = 0; i < lines.length; i++) {
          const found = pattern.exec(lines[i]!)
          if (!found) continue
          nodes ??= outlineCode(file, text)
          const title = titleOf(shown, nodes, i + 1)
          matched++
          places.add(title)
          if (hits.length < limit) hits.push({ title, line: i + 1, text: clip(lines[i]!, found.index) })
        }
      }

      if (matched === 0) return ok(`No matches in ${searched} source file${searched === 1 ? '' : 's'}.`)
      return ok(truncate(render(hits, matched, places.size)))
    },
  }
}

function titleOf(file: string, nodes: CodeNode[], line: number): string {
  const at = declarationAt(nodes, line)
  if (!at) return `${file}: (outside any declaration)`
  const node = at.chain[at.chain.length - 1]!
  return `${file}: ${at.inDoc ? 'doc of ' : ''}${qualifiedName(at.chain)} (${rangeStart(node)}-${node.endLine})`
}

function render(hits: Hit[], matched: number, places: number): string {
  const out: string[] = []
  let current = ''
  for (const hit of hits) {
    if (hit.title !== current) {
      out.push(hit.title)
      current = hit.title
    }
    out.push(`  ${hit.line}: ${hit.text}`)
  }
  out.push('', `${matched} match${matched === 1 ? '' : 'es'} in ${places} place${places === 1 ? '' : 's'}, ${hits.length} shown.`)
  return out.join('\n')
}
