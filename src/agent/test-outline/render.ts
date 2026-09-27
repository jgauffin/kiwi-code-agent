import type { TestNode } from './scan'

/** One line per node, `name (line N) [tag]`, indented by depth; `maxDepth` 1 keeps the top level only. */
export function renderNodes(nodes: TestNode[], maxDepth = Infinity, depth = 0): string[] {
  if (depth >= maxDepth) return []
  const lines: string[] = []
  for (const node of nodes) {
    lines.push(`${'  '.repeat(depth)}${node.name} (line ${node.line})${node.tags.map((t) => ` [${t}]`).join('')}`)
    lines.push(...renderNodes(node.children, maxDepth, depth + 1))
  }
  return lines
}
