import { z } from 'zod'
import { languageOf } from '../code-structure/language'
import { LineSearch, type LineMatch, type SearchSubject } from '../openai-session/tools/line-search'
import { type Tool } from '../openai-session/tools/tool'
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

/** One match as a script gets it; `declaration` is null outside any. */
type CodeMatch = { file: string; line: number; text: string; declaration: string | null; inDoc: boolean; start: number | null; end: number | null }

/** Source files, each match filed under the declaration around it. */
const sourceFiles: SearchSubject<CodeNode[], CodeMatch> = {
  fileNoun: 'source file',
  placeNoun: 'place',
  includes: (path) => languageOf(path) !== undefined,
  read: readSource,
  lines: (text) => text.split(/\r?\n/),
  parse: outlineCode,
  place: (match) => {
    const item = matchAt(match)
    return { title: titleOf(item), item }
  },
}

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
  const search = new LineSearch(sourceFiles, canRead)
  return {
    name: CODE_SEARCH_TOOL,
    description:
      'Searches source files and returns each matching line under the declaration it sits in (`path: Type.method (start-end)`); a match in a doc comment is filed under the declaration it documents. Read just that range with offset and limit instead of the whole file. Literal and case-insensitive unless regex or case_sensitive is set.',
    schema,
    readOnly: true,
    execute: (input, ctx) => search.execute(input, ctx),
  }
}

function matchAt({ file, line, text, parsed }: LineMatch<CodeNode[]>): CodeMatch {
  const at = declarationAt(parsed, line)
  if (!at) return { file, line, text, declaration: null, inDoc: false, start: null, end: null }
  const node = at.chain[at.chain.length - 1]!
  return { file, line, text, declaration: qualifiedName(at.chain), inDoc: at.inDoc, start: rangeStart(node), end: node.endLine }
}

function titleOf(match: CodeMatch): string {
  if (match.declaration === null) return `${match.file}: (outside any declaration)`
  return `${match.file}: ${match.inDoc ? 'doc of ' : ''}${match.declaration} (${match.start}-${match.end})`
}
