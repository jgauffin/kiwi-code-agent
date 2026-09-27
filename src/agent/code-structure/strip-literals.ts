import type { Language } from './language'

/**
 * The text with comments blanked and string literals emptied, holes included,
 * so that every brace left is code. Every character keeps its place (a
 * literal's quotes stay, its content becomes spaces), so line numbers and
 * columns still point into the original; a comment-only line comes out blank,
 * a line holding only a string keeps its quotes and counts as code.
 */
export function stripLiterals(text: string, lang: Language): string {
  return new Stripper(text, lang).run()
}

type Hole = { open: string; close: string }

const BRACE_HOLE: Hole = { open: '{', close: '}' }
const PAREN_HOLE: Hole = { open: '(', close: ')' }

const isIdentChar = (ch: string | undefined): boolean => ch !== undefined && /[\w$]/.test(ch)

class Stripper {
  private i = 0
  private readonly out: string[] = []

  constructor(
    private readonly text: string,
    private readonly lang: Language,
  ) {}

  run(): string {
    this.code(true)
    return this.out.join('')
  }

  /** Code until the end, or, inside a hole, until the bracket that closes it. */
  private code(visible: boolean, hole?: Hole): void {
    let depth = 0
    while (this.i < this.text.length) {
      const c = this.text[this.i]!
      if (this.lang.preprocessor && c === '#' && this.atLineStart()) {
        this.blankLine(true)
        continue
      }
      if (this.lineCommentAt()) {
        this.blankLine(false)
        continue
      }
      if (this.blockCommentAt()) {
        this.blockComment()
        continue
      }
      if (this.stringAt(visible)) continue
      if (hole) {
        if (c === hole.open) depth++
        else if (c === hole.close) {
          if (depth === 0) {
            this.blank()
            return
          }
          depth--
        }
      }
      this.take(visible)
    }
  }

  private emit(ch: string, visible: boolean): void {
    this.out.push(ch === '\n' || ch === '\r' ? ch : visible ? ch : ' ')
  }

  private take(visible: boolean, n = 1): void {
    for (let k = 0; k < n && this.i < this.text.length; k++) {
      this.emit(this.text[this.i]!, visible)
      this.i++
    }
  }

  private blank(n = 1): void {
    this.take(false, n)
  }

  private at(s: string): boolean {
    return this.text.startsWith(s, this.i)
  }

  private atLineStart(): boolean {
    for (let k = this.i - 1; k >= 0; k--) {
      const ch = this.text[k]
      if (ch === '\n') return true
      if (ch !== ' ' && ch !== '\t') return false
    }
    return true
  }

  /** Blanks to the end of the line; a directive continues past a trailing backslash. */
  private blankLine(continued: boolean): void {
    while (this.i < this.text.length && this.text[this.i] !== '\n') {
      const backslash = continued && this.text[this.i] === '\\' && /^\\\r?\n/.test(this.text.slice(this.i, this.i + 3))
      this.blank()
      if (backslash) {
        this.blank(this.text[this.i] === '\r' ? 2 : 1)
      }
    }
  }

  private lineCommentAt(): boolean {
    return this.lang.lineComments.some((marker) => this.at(marker))
  }

  private blockCommentAt(): boolean {
    return this.lang.blockComments !== 'none' && this.at('/*')
  }

  private blockComment(): void {
    this.blank(2)
    let depth = 1
    while (this.i < this.text.length) {
      if (this.lang.blockComments === 'nested' && this.at('/*')) {
        depth++
        this.blank(2)
      } else if (this.at('*/')) {
        this.blank(2)
        if (--depth === 0) return
      } else {
        this.blank()
      }
    }
  }

  /** Consumes the string literal starting here, if one does; the caller moves on when it did. */
  private stringAt(visible: boolean): boolean {
    const l = this.lang
    const c = this.text[this.i]!
    const prevIsIdent = isIdentChar(this.text[this.i - 1])
    if (l.csharpStrings && (c === '$' || c === '@' || c === '"')) return this.csharpString(visible)
    if (l.rustStrings && !prevIsIdent && (c === 'r' || c === 'b')) {
      const m = /^(?:br|r|b)(#*)"/.exec(this.text.slice(this.i, this.i + 40))
      if (m) {
        const raw = m[0].includes('r')
        this.blank(m[0].length - 1)
        return raw ? this.rawString(visible, `"${m[1]}`) : this.plainString(visible, '"', true, false)
      }
    }
    if (l.cRawStrings && !prevIsIdent) {
      const m = /^(?:u8|L|u|U)?R"([^\s()\\"]{0,16})\(/.exec(this.text.slice(this.i, this.i + 40))
      if (m) {
        this.blank(m[0].length - 1)
        return this.rawString(visible, `)${m[1]}"`)
      }
    }
    if (l.swiftStrings && c === '#') {
      const m = /^(#+)"/.exec(this.text.slice(this.i, this.i + 40))
      if (m) {
        this.blank(m[1]!.length)
        return this.rawString(visible, `"${m[1]}`)
      }
    }
    if (l.tripleQuotes && (this.at('"""') || (l.singleQuoteStrings && this.at("'''")))) {
      return this.rawString(visible, this.text.slice(this.i, this.i + 3), 3, l.dollarHoles ? BRACE_HOLE : undefined, '$')
    }
    if (c === '`' && l.backtick !== 'none') {
      const template = l.backtick === 'template'
      return this.plainString(visible, '`', template, true, template ? BRACE_HOLE : undefined, '$')
    }
    if (c === '"') {
      const hole = l.dollarHoles ? { hole: BRACE_HOLE, prefix: '$' } : l.swiftStrings ? { hole: PAREN_HOLE, prefix: '\\' } : undefined
      return this.plainString(visible, '"', true, false, hole?.hole, hole?.prefix)
    }
    if (c === "'") {
      if (l.singleQuoteStrings) return this.plainString(visible, "'", true, false)
      return this.charLiteral()
    }
    return false
  }

  /** `@"…"`, `$"…"`, `$@"…"`, `"""…"""` and the plain `"…"`; `$` opens `{…}` holes, `@` and raw quotes turn escapes off. */
  private csharpString(visible: boolean): boolean {
    const m = /^(\$@|@\$|\$|@)?("+)/.exec(this.text.slice(this.i, this.i + 12))
    if (!m) return false
    const prefix = m[1] ?? ''
    const interpolated = prefix.includes('$')
    const verbatim = prefix.includes('@')
    const quotes = m[2]!.length
    this.blank(prefix.length)
    if (quotes >= 3) return this.rawString(visible, '"'.repeat(quotes), quotes, interpolated ? BRACE_HOLE : undefined, '')
    if (quotes === 2 && !verbatim) {
      // An empty string, or the start of one that only looks empty (`""` inside verbatim is handled below).
      this.emitQuote(visible)
      this.emitQuote(visible)
      return true
    }
    if (verbatim) return this.verbatimString(visible, interpolated)
    return this.plainString(visible, '"', true, false, interpolated ? BRACE_HOLE : undefined, '')
  }

  private verbatimString(visible: boolean, interpolated: boolean): boolean {
    this.emitQuote(visible)
    while (this.i < this.text.length) {
      if (this.at('""')) {
        this.blank(2)
        continue
      }
      if (this.text[this.i] === '"') {
        this.emitQuote(visible)
        return true
      }
      if (interpolated && this.at('{{')) {
        this.blank(2)
        continue
      }
      if (interpolated && this.text[this.i] === '{') {
        this.blank()
        this.code(false, BRACE_HOLE)
        continue
      }
      this.blank()
    }
    return true
  }

  /**
   * A one-line string: it ends at the closing quote or, unterminated, at the
   * newline, so a regex literal or a stray quote costs at most one line.
   */
  private plainString(visible: boolean, quote: string, escapes: boolean, multiline: boolean, hole?: Hole, holePrefix?: string): boolean {
    this.emitQuote(visible)
    while (this.i < this.text.length) {
      const c = this.text[this.i]!
      if (c === quote) {
        this.emitQuote(visible)
        return true
      }
      if (c === '\n' && !multiline) return true
      // Before escapes: Swift opens a hole with `\(`.
      if (hole && this.at(`${holePrefix ?? ''}${hole.open}`)) {
        if (holePrefix === '' && this.at(`${hole.open}${hole.open}`)) {
          this.blank(2)
          continue
        }
        this.blank((holePrefix ?? '').length + 1)
        this.code(false, hole)
        continue
      }
      if (escapes && c === '\\') {
        this.blank(2)
        continue
      }
      this.blank()
    }
    return true
  }

  /**
   * Runs to `closer`, escapes off; `${…}` or `{…}` holes when the language has
   * them. `opener` is how many characters of the opening delimiter still stand
   * at the cursor; any prefix before them is already blanked.
   */
  private rawString(visible: boolean, closer: string, opener = 1, hole?: Hole, holePrefix?: string): boolean {
    this.blank(opener - 1)
    this.emitQuote(visible)
    while (this.i < this.text.length) {
      if (this.at(closer)) {
        this.blank(closer.length - 1)
        this.emitQuote(visible)
        return true
      }
      if (hole && this.at(`${holePrefix ?? ''}${hole.open}`)) {
        if (holePrefix === '' && this.at(`${hole.open}${hole.open}`)) {
          this.blank(2)
          continue
        }
        this.blank((holePrefix ?? '').length + 1)
        this.code(false, hole)
        continue
      }
      this.blank()
    }
    return true
  }

  /** `'x'` or `'\n'` is a character and is blanked; a lone `'` (a Rust lifetime) stays code. */
  private charLiteral(): boolean {
    const rest = this.text.slice(this.i, this.i + 12)
    const m = /^'(?:\\.[^'\n]{0,8}|[\uD800-\uDBFF][\uDC00-\uDFFF]|[^'\\\n])'/.exec(rest)
    if (!m) {
      this.take(true)
      return true
    }
    this.blank(m[0].length)
    return true
  }

  private emitQuote(visible: boolean): void {
    this.emit('"', visible)
    this.i++
  }
}
