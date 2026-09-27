import { MAX_OUTPUT_CHARS, mostDetailFitting, truncate } from '../openai-session/tools/tool'
import { renderNodes as renderTests } from '../test-outline/render'
import { countTests, type TestNode } from '../test-outline/scan'
import { rangeStart, type CodeNode } from './outline'

/** A test file is outlined by its tests, any other source file by its declarations. */
export type FileOutline = { path: string; nodes: CodeNode[] } | { path: string; tests: TestNode[] }

/** Room left for the notes around the outline. */
const DEFAULT_BUDGET = MAX_OUTPUT_CHARS - 1000

const SUMMARY_CHARS = 100

/** A doc's first sentence, clipped: what the declaration is for, without its parameters and caveats. */
export function summaryOf(doc: string): string {
  const first = doc.split(/\n\s*\n|(?<=[.!?])\s/)[0]!.replace(/\s+/g, ' ').trim()
  return first.length <= SUMMARY_CHARS ? first : `${first.slice(0, SUMMARY_CHARS - 1)}…`
}

const range = (node: CodeNode): string => `(${rangeStart(node)}-${node.endLine})`

/** One line per declaration, `name (start-end)  summary`, indented by depth; `maxDepth` 1 keeps the top level only. */
export function renderNodes(nodes: CodeNode[], options: { maxDepth?: number; docs?: boolean } = {}, depth = 0): string[] {
  const { maxDepth = Infinity, docs = true } = options
  if (depth >= maxDepth) return []
  return nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.name} ${range(node)}${docs && node.doc ? `  ${summaryOf(node.doc.text)}` : ''}`,
    ...renderNodes(node.children, options, depth + 1),
  ])
}

function renderFile(file: FileOutline, maxDepth: number, docs: boolean): string[] {
  if ('nodes' in file) return [`## ${file.path}`, ...renderNodes(file.nodes, { maxDepth, docs })]
  const count = countTests(file.tests)
  return [`## ${file.path}: ${count} ${count === 1 ? 'test' : 'tests'}`, ...renderTests(file.tests, maxDepth)]
}

/**
 * Files in full with doc summaries while they fit the budget; then without
 * summaries, then their top level, then their names alone, saying which.
 * Repositories of their own that the walk left out are named.
 */
export function renderFiles(files: FileOutline[], nestedRepositories: string[], budget = DEFAULT_BUDGET): string {
  const at = (maxDepth: number, docs: boolean): string => files.flatMap((f) => renderFile(f, maxDepth, docs)).join('\n')
  const { body, note } = mostDetailFitting(
    [
      { body: () => at(Infinity, true), note: '' },
      { body: () => at(Infinity, false), note: 'Too long with doc summaries: names and line ranges only.' },
      { body: () => at(1, false), note: 'Too much to list in full: top level only. Call CodeOutline on one file for all of it.' },
      { body: () => at(0, false), note: 'Too many files to outline: file names only. Call CodeOutline on a folder or one file.' },
    ],
    budget,
  )
  const parts = [note, body].filter((p) => p.length > 0)
  if (nestedRepositories.length > 0) {
    parts.push(['Not searched, repositories of their own (submodules or vendored clones):', ...nestedRepositories].join('\n'))
  }
  return truncate(parts.join('\n\n'))
}

export type SymbolHit = { path: string; qualified: string; node: CodeNode }

/** One line per declaration found by name: qualified name, where it is, what it is for. */
export function renderSymbols(hits: SymbolHit[]): string {
  const lines = hits.map(
    (hit) => `${hit.qualified}  ${hit.path}:${rangeStart(hit.node)}-${hit.node.endLine}${hit.node.doc ? `  ${summaryOf(hit.node.doc.text)}` : ''}`,
  )
  return truncate(lines.join('\n'))
}
