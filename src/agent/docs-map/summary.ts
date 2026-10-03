import { parseSections } from '../openai-session/tools/markdown/outline'
import type { DocsMapEntry } from './entry'

/**
 * The map as a session start reads it: every doc with its length, what it is
 * for, and one line per section with the section's line range. It exists so a
 * planner opens the one section that answers its question instead of reading
 * the tree, and cites it by the heading the map spells out. The lengths and
 * ranges are read from the docs when the map is composed; a doc that changes
 * since makes the map stale, and it is composed again.
 */

/** A doc the map covers but has no entry for yet; named so the planner knows the map is partial, not that the doc is absent. */
export type Undescribed = string

/** An entry with the doc it describes, as composing the map reads both. */
export type DescribedDoc = { entry: DocsMapEntry; source: string }

export function renderDocsSummary(docs: DescribedDoc[], undescribed: Undescribed[]): string {
  const lines: string[] = []
  for (const { entry, source } of docs) {
    lines.push(docHeading(entry.doc, source), entry.summary)
    const ranges = headingRanges(source)
    for (const { heading, line } of entry.headings) {
      const range = ranges.get(heading)?.shift()
      lines.push(`- \`#${heading}\`${range ? ` (${range})` : ''}: ${line}`)
    }
    lines.push('')
  }
  if (undescribed.length > 0) {
    lines.push(`Not described yet, so read them if the map does not answer: ${undescribed.join(', ')}.`, '')
  }
  return lines.join('\n').trimEnd()
}

/** A doc's line in the map: its path and its length, as both styles write it. */
export function docHeading(path: string, text: string): string {
  const count = lineCount(text)
  return `### ${path} (${count} line${count === 1 ? '' : 's'})`
}

/** A doc's length as an editor numbers it: a final newline ends the last line rather than starting another. */
function lineCount(text: string): number {
  const lines = text.split(/\r?\n/)
  return text.endsWith('\n') ? lines.length - 1 : lines.length
}

/** The `##` and `###` sections' line ranges by heading, in doc order, so a heading used twice takes its ranges in turn. */
function headingRanges(source: string): Map<string, string[]> {
  const ranges = new Map<string, string[]>()
  for (const section of parseSections(source)) {
    if (section.level !== 2 && section.level !== 3) continue
    ranges.set(section.heading, [...(ranges.get(section.heading) ?? []), `${section.line}-${section.endLine}`])
  }
  return ranges
}
