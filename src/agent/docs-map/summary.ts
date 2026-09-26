import type { DocsMapEntry } from './entry'

/**
 * The map as a session start reads it: every doc, what it is for, and one line
 * per section. It exists so a planner opens the one doc that answers its
 * question instead of reading the tree, and cites the section by the heading
 * the map spells out.
 */

/** A doc the map covers but has no entry for yet; named so the planner knows the map is partial, not that the doc is absent. */
export type Undescribed = string

export function renderDocsSummary(entries: DocsMapEntry[], undescribed: Undescribed[]): string {
  const lines: string[] = []
  for (const entry of entries) {
    lines.push(`### ${entry.doc}`, entry.summary)
    for (const { heading, line } of entry.headings) lines.push(`- \`#${heading}\`: ${line}`)
    lines.push('')
  }
  if (undescribed.length > 0) {
    lines.push(`Not described yet, so read them if the map does not answer: ${undescribed.join(', ')}.`, '')
  }
  return lines.join('\n').trimEnd()
}
