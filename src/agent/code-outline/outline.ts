import { readDeclarations, type Declaration } from '../code-structure/declarations'
import { languageOf } from '../code-structure/language'
import { countTests, outlineTests, type TestNode } from '../test-outline/scan'

export type CodeNode = Declaration

/** The types and functions of a source file, nested; empty for a language the scanner does not read. */
export function outlineCode(path: string, text: string): CodeNode[] {
  return languageOf(path) ? readDeclarations(path, text).declarations : []
}

/** What a file is outlined by: its tests when it holds any, otherwise its declarations; undefined when it has neither. */
export type Outline = { nodes: CodeNode[] } | { tests: TestNode[] }

export function outlineFile(path: string, text: string): Outline | undefined {
  const tests = outlineTests(path, text)
  if (countTests(tests) > 0) return { tests }
  const nodes = outlineCode(path, text)
  return nodes.length > 0 ? { nodes } : undefined
}

/** Where a Read of the node starts: at its doc when the doc sits above it, so the range takes the doc along. */
export const rangeStart = (node: CodeNode): number => Math.min(node.line, node.doc?.line ?? node.line)

/** The declarations a line sits in, outermost first; `inDoc` when the line is the innermost one's doc above it. */
export type Location = { chain: CodeNode[]; inDoc: boolean }

export function declarationAt(nodes: CodeNode[], line: number): Location | undefined {
  for (const node of nodes) {
    if (line < rangeStart(node) || line > node.endLine) continue
    const inner = declarationAt(node.children, line)
    if (inner) return { chain: [node, ...inner.chain], inDoc: inner.inDoc }
    return { chain: [node], inDoc: line < node.line }
  }
  return undefined
}

export const qualifiedName = (chain: CodeNode[]): string => chain.map((n) => n.name).join('.')

export type SymbolMatch = { qualified: string; node: CodeNode }

/** Declarations whose name contains `query`, case-insensitive; a query with a dot is matched against the qualified name. */
export function findSymbols(nodes: CodeNode[], query: string): SymbolMatch[] {
  const wanted = query.toLowerCase()
  const qualifiedQuery = wanted.includes('.')
  const found: SymbolMatch[] = []
  const visit = (list: CodeNode[], chain: CodeNode[]): void => {
    for (const node of list) {
      const path = [...chain, node]
      const qualified = qualifiedName(path)
      if ((qualifiedQuery ? qualified : node.name).toLowerCase().includes(wanted)) found.push({ qualified, node })
      visit(node.children, path)
    }
  }
  visit(nodes, [])
  return found
}
