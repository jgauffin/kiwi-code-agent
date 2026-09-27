import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isHeading, markdownLines, parseSections, structuralLines } from '../openai-session/tools/markdown/outline'
import { docPaths } from './doc-index'

/**
 * The docs map with no model in it: every doc with its opening paragraph and
 * its `##`/`###` sections with their line ranges, read from the docs as they
 * stand at session start. It costs nothing to build and is never behind; it
 * says less than the described map where a heading says little.
 */

/** Characters of a doc's opening the map carries; beyond it the planner reads the doc. */
export const OPENING_LIMIT = 300

export async function renderOutlineMap(cwd: string, ignored: string[] = []): Promise<string | undefined> {
  const entries: string[] = []
  for (const path of await docPaths(cwd, ignored)) {
    const text = await readFile(join(cwd, ...path.split('/')), 'utf8').catch(() => undefined)
    if (text !== undefined) entries.push(outlineEntry(path, text))
  }
  return entries.length > 0 ? entries.join('\n\n') : undefined
}

export function outlineEntry(path: string, text: string): string {
  const lines = [`### ${path}`]
  const opening = openingParagraph(text)
  if (opening) lines.push(opening)
  for (const section of parseSections(text)) {
    if (section.level === 2 || section.level === 3) lines.push(`- \`#${section.heading}\` (${section.line}-${section.endLine})`)
  }
  return lines.join('\n')
}

/** The first run of prose lines: a blank line, a heading or a fenced block ends it. */
function openingParagraph(text: string): string | undefined {
  const paragraph: string[] = []
  let last = -1
  for (const { index, text: raw } of structuralLines(markdownLines(text))) {
    const line = raw.trim()
    const ends = line === '' || isHeading(raw) || (paragraph.length > 0 && index !== last + 1)
    if (ends) {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(line)
    last = index
  }
  if (paragraph.length === 0) return undefined
  const joined = paragraph.join(' ')
  return joined.length > OPENING_LIMIT ? `${joined.slice(0, OPENING_LIMIT - 1)}…` : joined
}
