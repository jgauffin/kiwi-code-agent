/**
 * A markdown file as its sections: where each heading starts and where its
 * section ends, so a reader can take one section by line range instead of the
 * whole file.
 */

export type Section = {
  level: number
  /** The heading text as a citation names it: no leading or closing `#`s. */
  heading: string
  /** 1-based line of the heading. */
  line: number
  /** Last line of the section: before the next heading of the same or a higher level, else the file's last line. */
  endLine: number
}

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx']

export const isMarkdown = (path: string): boolean => MARKDOWN_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext))

const HEADING = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/
const FENCE = /^\s*(`{3,}|~{3,})/

/** Lines as the Read tool numbers them, without the empty line a final newline leaves. */
export function markdownLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * The sections in file order. Lines inside a fenced block are examples, not
 * structure: docs here quote markdown in fences, and every `##` in it would
 * otherwise become a section that does not exist. Front matter is metadata,
 * where `#` starts a YAML comment.
 */
export function parseSections(text: string): Section[] {
  const lines = markdownLines(text)
  const sections: Section[] = []
  for (const { index, text: raw } of structuralLines(lines)) {
    const match = HEADING.exec(raw)
    if (match) sections.push({ level: match[1]!.length, heading: match[2]!.trim(), line: index + 1, endLine: lines.length })
  }
  for (let i = 0; i < sections.length; i++) {
    const next = sections.slice(i + 1).find((s) => s.level <= sections[i]!.level)
    if (next) sections[i]!.endLine = next.line - 1
  }
  return sections
}

/** A line of the doc's own structure, with its 0-based index into the file's lines. */
export type StructuralLine = { index: number; text: string }

/** The lines outside front matter and fenced blocks, fence markers included in what is skipped. */
export function* structuralLines(lines: string[]): Generator<StructuralLine> {
  let fence: string | undefined
  let start = 0
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, i) => i > 0 && (line.trim() === '---' || line.trim() === '...'))
    if (close > 0) start = close + 1
  }
  for (let i = start; i < lines.length; i++) {
    const text = lines[i]!
    const marker = FENCE.exec(text)?.[1]
    if (marker) {
      if (fence === undefined) fence = marker[0]
      else if (marker[0] === fence) fence = undefined
      continue
    }
    if (fence === undefined) yield { index: i, text }
  }
}

export const isHeading = (line: string): boolean => HEADING.test(line)

/** The section a line falls under: the closest heading above it, or undefined before the first. */
export function sectionAt(sections: Section[], line: number): Section | undefined {
  let found: Section | undefined
  for (const section of sections) {
    if (section.line > line) break
    found = section
  }
  return found
}

/**
 * ```
 * docs/intent/agent.md  412 lines
 *   1-11     # Agent
 *   12-80    ## Modes
 *   30-55      ### Blind plan
 * ```
 */
export function formatOutline(path: string, text: string): string {
  const sections = parseSections(text)
  const rows = sections.map((s) => ({ span: `${s.line}-${s.endLine}`, title: `${'  '.repeat(s.level - 1)}${'#'.repeat(s.level)} ${s.heading}` }))
  const width = Math.max(0, ...rows.map((r) => r.span.length))
  const header = `${path}  ${markdownLines(text).length} lines`
  if (rows.length === 0) return `${header}\n  (no headings)`
  return [header, ...rows.map((r) => `  ${r.span.padEnd(width)}  ${r.title}`)].join('\n')
}
