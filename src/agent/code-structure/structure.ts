import { GENERIC, languageOf, type Language } from './language'
import { stripLiterals } from './strip-literals'

/**
 * The shape of a source file without a parser: blocks and the statements
 * between them, found over the text with its literals blanked. What a header
 * declares is for the reader of the tree to decide; this only says where
 * headers and bodies are.
 */

/** A comment run documenting what follows it, markers removed. `line` is its first line. */
export type Doc = { text: string; line: number }

type Span = {
  /** The header with literals blanked and comments gone; lines joined as written. */
  header: string
  /** The same span as written, column for column. */
  origHeader: string
  line: number
  endLine: number
  doc?: Doc
}

export type CodeBlock = Span & { kind: 'block'; delimiter: 'brace' | 'indent'; children: CodeItem[] }
/** A header that ended without opening a body: `foo(): void;`, `it.todo("x")`, an attribute on a line of its own. */
export type CodeStatement = Span & { kind: 'statement' }
export type CodeItem = CodeBlock | CodeStatement

export type CodeStructure = {
  items: CodeItem[]
  /** The stripped text by line, for readers that count code lines. */
  code: string[]
  family: Language['family']
}

/**
 * Brace languages are read by their braces alone, so `case x:` never opens a
 * block; Python by indentation alone, its braces being literals. A language
 * no profile names (Ruby, Elixir) is read both ways, as its blocks may be
 * either.
 */
export function readStructure(path: string, text: string): CodeStructure {
  const known = languageOf(path)
  const lang = known ?? GENERIC
  const code = stripLiterals(text, lang)
  const reader = new Reader(code, text, { braces: lang.family === 'brace', indent: lang.family === 'python' || !known, objectLiterals: lang.objectLiterals })
  reader.run()
  if (lang.family === 'python') takeDocstrings(reader.roots)
  return { items: reader.roots, code: code.split(/\r?\n/), family: lang.family }
}

/** A header this long is not a header: a bracket the stripper did not see is being chased. */
const MAX_HEADER = 4000

/**
 * Without semicolons a statement ends at the line break, unless the line
 * leaves something open: an operator, a comma, a clause keyword.
 */
const LINE_CONTINUES = /(?:[,(\[=:&|+\-*/<>?.!~^%]|\bwhere|\bextends|\bimplements|\bthrows)$/

/** Or the next line picks the statement up: a clause, an operator, the brace itself on its own line. */
const LINE_RESUMES = /^(?:\{|where\b|extends\b|implements\b|throws\b|[:.?,)]|&&|\|\||=>|->)/

/** A brace inside open parentheses after one of these is a pattern or a literal in the header: `({ a }: Props) =>`, `foo(x, {`. */
const OPENER_BEFORE = /[(,=:|&<?![]\s*$/

/** What ends a header whose body is the indented lines below it. */
const HEADER_END = /(?::|\bdo\s*(?:\|[^|]*\|)?)\s*$/

/** `for (…;…)`, labelled or not: `OUT: for`, `'outer: for`. */
const PAREN_LOOP = /^\s*(?:'?[A-Za-z_]\w*\s*:\s*)?for\b/

/** A condition without parentheses: `for i := 0; i < n; i++ {`, `if v, ok := m[k]; ok {`. */
const BARE_CONDITION = /^\s*(?:for|if|switch)\s+(?!await\b)[^\s(]/

const carriesSemicolons = (text: string, parens: number): boolean => (parens > 0 && PAREN_LOOP.test(text)) || BARE_CONDITION.test(text)

type Modes = { braces: boolean; indent: boolean; objectLiterals: boolean }

type Frame = { block?: CodeBlock; brace: boolean; indent: number; inHeader?: boolean }

type Header = {
  start: number
  /** Just past the last character read into it. */
  end: number
  line: number
  parens: number
  /** Set when the header ended its line the way an indented body is announced, at this indent. */
  candidate?: number
  /** The line ended the header unless the next line resumes it. */
  lineBreak?: boolean
}

class Reader {
  readonly roots: CodeItem[] = []
  private readonly frames: Frame[] = []
  private header: Header | undefined
  private lastCode = 0
  private readonly codeLines: string[]
  private readonly origLines: string[]

  constructor(
    private readonly code: string,
    private readonly orig: string,
    private readonly modes: Modes,
  ) {
    this.codeLines = code.split(/\r?\n/)
    this.origLines = orig.split(/\r?\n/)
  }

  run(): void {
    let start = 0
    for (let n = 1; n <= this.codeLines.length; n++) {
      const line = this.codeLines[n - 1]!
      if (line.trim().length > 0) {
        this.startLine(line, n)
        for (let i = 0; i < line.length; i++) this.character(line[i]!, start + i, n)
        this.endLine(n)
        this.lastCode = n
      }
      start = this.code.indexOf('\n', start)
      if (start < 0) break
      start++
    }
    this.finishHeader(this.lastCode)
    while (this.frames.length > 0) {
      const frame = this.frames.pop()!
      this.close(frame, frame.brace ? this.codeLines.length : this.lastCode)
    }
  }

  /** What a new code line does to a header left open and to indented blocks, before anything on it is read. */
  private startLine(line: string, n: number): void {
    const indent = indentOf(line)
    const header = this.header
    if (header?.candidate !== undefined) {
      const at = header.candidate
      delete header.candidate
      if (indent > at) {
        this.openBlock('indent', header, n, at)
        return
      }
      if (!this.modes.braces) this.finishHeader(this.lastCode)
      else header.lineBreak = !LINE_CONTINUES.test(this.text(header).trimEnd())
    }
    if (this.header?.lineBreak) {
      this.header.lineBreak = false
      if (!LINE_RESUMES.test(line.trimStart())) this.finishHeader(this.lastCode)
    }
    if (this.header) return
    for (let top = this.frames.at(-1); top && !top.brace && !top.inHeader && indent <= top.indent; top = this.frames.at(-1)) {
      this.close(this.frames.pop()!, this.lastCode)
    }
  }

  private character(ch: string, at: number, n: number): void {
    const header = this.header
    if (this.modes.braces && ch === '{') {
      if (this.modes.objectLiterals && header && header.parens > 0 && OPENER_BEFORE.test(this.text(header))) {
        this.frames.push({ brace: true, indent: 0, inHeader: true })
        header.end = at + 1
        return
      }
      this.openBlock('brace', header, n, indentOf(this.codeLines[n - 1]!))
      return
    }
    if (this.modes.braces && ch === '}') {
      const top = this.frames.at(-1)
      if (top?.inHeader) {
        this.frames.pop()
        if (header) header.end = at + 1
        return
      }
      this.finishHeader(n)
      while (this.frames.length > 0) {
        const frame = this.frames.pop()!
        this.close(frame, frame.brace ? n : this.lastCode)
        if (frame.brace) break
      }
      return
    }
    if (ch === ';' && this.modes.braces) {
      // A `for` header carries its own semicolons, and so does Go's condition with an init statement; anywhere else one ends the statement.
      if (!header || !carriesSemicolons(this.text(header), header.parens)) {
        this.finishHeader(n)
        return
      }
    }
    if (ch.trim().length === 0) return
    const open = this.header ?? this.startHeader(at, n)
    if (this.modes.braces ? ch === '(' : '([{'.includes(ch)) open.parens++
    if (this.modes.braces ? ch === ')' : ')]}'.includes(ch)) open.parens = Math.max(0, open.parens - 1)
    open.end = at + 1
    if (open.end - open.start > MAX_HEADER) this.header = undefined
  }

  /** At the end of a code line: whether the header ends here, announces an indented body, or runs on. */
  private endLine(n: number): void {
    const header = this.header
    if (!header || header.parens > 0) return
    const text = this.text(header)
    if (this.modes.indent && HEADER_END.test(text)) {
      header.candidate = indentOf(this.codeLines[header.line - 1]!)
      return
    }
    if (!this.modes.braces) {
      if (!text.trimEnd().endsWith('\\')) this.finishHeader(n)
      return
    }
    header.lineBreak = !LINE_CONTINUES.test(text.trimEnd())
  }

  private startHeader(at: number, n: number): Header {
    this.header = { start: at, end: at, line: n, parens: 0 }
    return this.header
  }

  private text(header: Header): string {
    return this.code.slice(header.start, header.end)
  }

  private span(header: Header | undefined, n: number, endLine: number): Span {
    const span: Span = header
      ? { header: this.text(header), origHeader: this.orig.slice(header.start, header.end), line: header.line, endLine }
      : { header: '', origHeader: '', line: n, endLine }
    const doc = header && this.startsItsLine(header) ? docAbove(this.codeLines, this.origLines, header.line) : undefined
    if (doc) span.doc = doc
    return span
  }

  /** A doc above a header belongs to it only when the header is the first thing on its line. */
  private startsItsLine(header: Header): boolean {
    const line = this.codeLines[header.line - 1]!
    return line.length - line.trimStart().length === header.start - this.code.lastIndexOf('\n', header.start - 1) - 1
  }

  /** Ends the open header as a statement, if there is one. */
  private finishHeader(endLine: number): void {
    const header = this.header
    this.header = undefined
    if (!header || header.end <= header.start) return
    this.add({ kind: 'statement', ...this.span(header, header.line, Math.max(endLine, header.line)) })
  }

  private openBlock(delimiter: 'brace' | 'indent', header: Header | undefined, n: number, indent: number): void {
    this.header = undefined
    const block: CodeBlock = { kind: 'block', delimiter, ...this.span(header, n, n), children: [] }
    this.add(block)
    this.frames.push({ block, brace: delimiter === 'brace', indent })
  }

  private close(frame: Frame, endLine: number): void {
    if (frame.block) frame.block.endLine = Math.max(endLine, frame.block.line)
  }

  private add(item: CodeItem): void {
    let parent: CodeBlock | undefined
    for (let i = this.frames.length - 1; i >= 0 && !parent; i--) parent = this.frames[i]!.block
    ;(parent ? parent.children : this.roots).push(item)
  }
}

function indentOf(line: string): number {
  return (/^[ \t]*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length
}

/** Attributes and decorators may stand between a doc and what it documents: `[Fact]`, `#[test]`, `@Override`. */
const ANNOTATION = /^(?:\[|#\[|@[A-Za-z_])/

const COMMENT_START = /^(?:\/\/|\/\*|\*|#|--)/

/**
 * The run of comments directly above `line`, with no blank line between.
 * A comment is a line the stripper blanked that is not blank as written; a
 * block comment is followed up to its opening, so its unmarked middle lines
 * count too.
 */
function docAbove(code: string[], orig: string[], line: number): Doc | undefined {
  const taken: string[] = []
  let first = 0
  for (let n = line - 1; n >= 1; n--) {
    const text = (orig[n - 1] ?? '').trim()
    const stripped = (code[n - 1] ?? '').trim()
    if (taken.length === 0 && stripped.length > 0 && ANNOTATION.test(stripped)) continue
    if (taken.length === 0 && text.startsWith('#[')) continue
    if (text.length === 0 || stripped.length > 0) break
    if (text.endsWith('*/') && !text.startsWith('/*')) {
      let m = n
      while (m > 1 && !(orig[m - 1] ?? '').includes('/*') && (code[m - 2] ?? '').trim().length === 0) m--
      for (let k = n; k >= m; k--) taken.unshift(orig[k - 1] ?? '')
      first = m
      n = m
      continue
    }
    if (!COMMENT_START.test(text)) break
    taken.unshift(text)
    first = n
  }
  const text = cleanDoc(taken)
  return text ? { text, line: first } : undefined
}

/** The tags of an XML doc comment: the text between them is the doc. */
const XML_DOC_TAG = /<\/?(?:summary|remarks|returns|param|typeparam|paramref|typeparamref|see|seealso|para|c|code|example|exception|value|inheritdoc|list|item|description|term)\b[^>]*>/g

function cleanDoc(lines: string[]): string {
  return lines
    .map((line) =>
      line
        .trim()
        .replace(/^\/\*+!?/, '')
        .replace(/\*+\/$/, '')
        .replace(/^(?:\/\/[/!]?|#+|--|\*+)/, '')
        .replace(XML_DOC_TAG, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join('\n')
}

/** A Python body opening with a string literal: stripped, nothing but its quotes remains. */
const DOCSTRING = /^[rRuUbB]*(?:""""""|''''''|""|'')$/

function takeDocstrings(items: CodeItem[]): void {
  for (const item of items) {
    if (item.kind !== 'block') continue
    const first = item.children[0]
    if (!item.doc && first?.kind === 'statement' && DOCSTRING.test(first.header.replace(/\s+/g, ''))) {
      const text = cleanDoc(first.origHeader.replace(/^[rRuUbB]*("""|'''|"|')/, '').replace(/("""|'''|"|')$/, '').split(/\r?\n/))
      if (text) item.doc = { text, line: first.line }
    }
    takeDocstrings(item.children)
  }
}
