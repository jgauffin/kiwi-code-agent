/**
 * Splits a shell command line the way a POSIX shell would (Shell Command
 * Language: 2.2 quoting, 2.3 token recognition, 2.6 expansions, 2.7
 * redirection, 2.9 simple commands, 2.10 the grammar) plus bash's additions
 * (`[[ ]]`, `(( ))`, `$'…'`, `|&`, `&>`, `<<<`, `;&`, `;;&`, `{fd}>`,
 * `function`), far enough to judge it: which simple commands run, whether any
 * writes a file through a redirect, and whether an expansion hides a command
 * we cannot see. Pure, so the webview can use it too.
 */

export type ShellSegment = {
  /** The command as written, from its first word to the operator after it; heredoc bodies included. Reserved words are left out. */
  text: string
  /** The words of one simple command, quotes and escapes resolved. Leading assignments and reserved words are not among them. */
  tokens: string[]
  /** A redirect to something other than /dev/null or a file descriptor. */
  writesFile: boolean
}

export type ShellCommand = {
  segments: ShellSegment[]
  /** `$(...)`, backticks or `<(...)`: a command runs that the tokens do not show. */
  substitutes: boolean
}

export function splitShellCommand(command: string): ShellCommand {
  return new Splitter(command).run()
}

/** Reserved words that only open or close a construct; the command follows them. `time` may take `-p`. */
const PREFIX_WORDS = new Set(['!', '{', '}', 'if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'while', 'until', 'time', 'coproc'])
/** Reserved words whose whole clause runs nothing: the words after them are names, patterns or lists, not a command. */
const HEADER_WORDS = new Set(['for', 'select', 'case', 'esac', 'in'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?$/
const FD_PREFIX = /^(\d+|\{[A-Za-z_][A-Za-z0-9_]*\})$/

type Word = { text: string; start: number; quoted: boolean; equalsAt: number }
type Heredoc = { delimiter: string; stripTabs: boolean; owner: number }

class Splitter {
  private readonly segments: ShellSegment[] = []
  private substitutes = false
  private i = 0

  private words: Word[] = []
  private word = ''
  private wordStart = 0
  private inWord = false
  private wordQuoted = false
  /** Offset in `word` of its first unquoted `=`, or -1. */
  private equalsAt = -1
  private redirectPending = false
  private writesFile = false
  /** Heredocs opened on the current line; their bodies start on the next line, in order. */
  private heredocs: Heredoc[] = []
  /** Bodies of the current segment's heredocs, appended to its text when it closes. */
  private heredocText = ''
  /** Inside `[[ … ]]`, where `<`, `>`, `&&`, `||`, `(` and `)` are comparisons and grouping, not operators. */
  private inConditional = false
  /** Open `case` constructs: whether the next words are a pattern or a clause body. */
  private cases: ('pattern' | 'body')[] = []

  constructor(private readonly src: string) {}

  run(): ShellCommand {
    const src = this.src
    while (this.i < src.length) {
      const c = src[this.i]!
      const next = src[this.i + 1]
      if (c === '\\') {
        // A backslash-newline joins lines; any other escaped character is literal.
        if (next === '\n') this.i += 2
        else if (next === undefined) this.i++
        else {
          this.add(next)
          this.i += 2
        }
        continue
      }
      if (c === "'") {
        this.singleQuoted()
        continue
      }
      if (c === '"') {
        this.doubleQuoted()
        continue
      }
      if (c === '$' && next === "'") {
        this.ansiQuoted()
        continue
      }
      if (c === '$' && next === '"') {
        this.i++
        this.doubleQuoted()
        continue
      }
      if (c === '$' && next === '(' && src[this.i + 2] === '(') {
        this.arithmeticExpansion()
        continue
      }
      if (c === '$' && next === '(') {
        this.substitution()
        continue
      }
      if (c === '$' && next === '{') {
        this.parameterExpansion()
        continue
      }
      if (c === '`') {
        this.backticks()
        continue
      }
      if ((c === '<' || c === '>') && next === '(' && !this.inConditional) {
        this.substitution()
        continue
      }
      if (c === '#' && !this.inWord) {
        while (this.i < src.length && src[this.i] !== '\n') this.i++
        continue
      }
      if (c === ' ' || c === '\t') {
        this.endWord()
        this.i++
        continue
      }
      if (c === '\n') {
        this.newline()
        continue
      }
      if (this.inConditional && (c === '<' || c === '>' || c === '(' || c === ')' || (c === '&' && next === '&') || (c === '|' && next === '|'))) {
        // Comparisons and grouping inside `[[ … ]]`, not operators.
        const two = (c === '&' || c === '|') && next === c
        this.add(two ? c + c : c)
        this.i += two ? 2 : 1
        continue
      }
      if (c === ';') {
        // `;;`, `;&` and `;;&` end a case clause: a pattern comes next.
        const clause = next === ';' || next === '&'
        this.endSegment(this.i, this.i + (clause ? (src[this.i + 2] === '&' ? 3 : 2) : 1))
        if (clause && this.cases.length) this.cases[this.cases.length - 1] = 'pattern'
        continue
      }
      if (c === '&' && next === '&') {
        this.endSegment(this.i, this.i + 2)
        continue
      }
      if (c === '|' && (next === '|' || next === '&')) {
        this.endSegment(this.i, this.i + 2)
        continue
      }
      if (c === '|') {
        this.endSegment(this.i, this.i + 1)
        continue
      }
      if (c === '&' && next === '>') {
        // `&> file`, `&>> file`: both streams to a file.
        this.endWord()
        this.i += src[this.i + 2] === '>' ? 3 : 2
        this.redirectPending = true
        continue
      }
      if (c === '&') {
        this.endSegment(this.i, this.i + 1)
        continue
      }
      if (c === '>') {
        this.outputRedirect()
        continue
      }
      if (c === '<') {
        this.inputRedirect()
        continue
      }
      if (c === '(') {
        this.openParen()
        continue
      }
      if (c === ')') {
        this.closeParen()
        continue
      }
      this.add(c)
      this.i++
    }
    this.endSegment(src.length, src.length)
    return { segments: this.segments, substitutes: this.substitutes }
  }

  private add(c: string, quoted = false): void {
    if (!this.inWord) {
      this.inWord = true
      this.wordStart = this.i
      this.wordQuoted = false
      this.equalsAt = -1
    }
    if (quoted) this.wordQuoted = true
    if (c === '=' && !quoted && this.equalsAt === -1) this.equalsAt = this.word.length
    this.word += c
  }

  private addRaw(text: string): void {
    for (const c of text) this.add(c, true)
  }

  private singleQuoted(): void {
    const end = this.src.indexOf("'", this.i + 1)
    const close = end === -1 ? this.src.length : end
    this.add('', true)
    this.addRaw(this.src.slice(this.i + 1, close))
    this.i = close + 1
  }

  /** `$'…'`: backslash escapes are resolved, so `\'` does not close it. */
  private ansiQuoted(): void {
    const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', E: '\x1b' }
    this.add('', true)
    this.i += 2
    while (this.i < this.src.length && this.src[this.i] !== "'") {
      const c = this.src[this.i]!
      if (c === '\\' && this.i + 1 < this.src.length) {
        const escaped = this.src[this.i + 1]!
        this.add(escapes[escaped] ?? `\\${escaped}`, true)
        this.i += 2
        continue
      }
      this.add(c, true)
      this.i++
    }
    this.i++
  }

  /** Inside double quotes only `\`, `$` and backticks keep meaning; a substitution is skipped whole so its quotes do not end ours. */
  private doubleQuoted(): void {
    const src = this.src
    this.add('', true)
    this.i++
    while (this.i < src.length && src[this.i] !== '"') {
      const c = src[this.i]!
      const next = src[this.i + 1]
      if (c === '\\' && next === '\n') {
        this.i += 2
        continue
      }
      if (c === '\\' && next !== undefined && '"\\$`'.includes(next)) {
        this.add(next, true)
        this.i += 2
        continue
      }
      if (c === '$' && next === '(' && src[this.i + 2] === '(') {
        this.arithmeticExpansion()
        continue
      }
      if (c === '$' && next === '(') {
        this.substitution()
        continue
      }
      if (c === '$' && next === '{') {
        this.parameterExpansion()
        continue
      }
      if (c === '`') {
        this.backticks()
        continue
      }
      this.add(c, true)
      this.i++
    }
    this.i++
  }

  /** `$(…)`, `<(…)` or `>(…)`: hides a command. Its text stays in the word; what it contains is not ours to split. */
  private substitution(): void {
    this.substitutes = true
    const end = matchingParen(this.src, this.i + 2)
    this.addRaw(this.src.slice(this.i, end))
    this.i = end
  }

  /** `$((…))` runs nothing itself, but a `$(…)` inside it still does. */
  private arithmeticExpansion(): void {
    const inner = matchingParen(this.src, this.i + 3)
    const end = this.src[inner] === ')' ? inner + 1 : inner
    if (/\$\(|`|<\(|>\(/.test(this.src.slice(this.i + 3, inner - 1))) this.substitutes = true
    this.addRaw(this.src.slice(this.i, end))
    this.i = end
  }

  private parameterExpansion(): void {
    const src = this.src
    let depth = 0
    let j = this.i + 1
    for (; j < src.length; j++) {
      const c = src[j]
      if (c === '\\') {
        j++
        continue
      }
      if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        j++
        break
      }
    }
    const inner = src.slice(this.i, j)
    if (/\$\(|`/.test(inner)) this.substitutes = true
    this.addRaw(inner)
    this.i = j
  }

  private backticks(): void {
    this.substitutes = true
    let j = this.i + 1
    while (j < this.src.length && this.src[j] !== '`') j += this.src[j] === '\\' ? 2 : 1
    const end = Math.min(j + 1, this.src.length)
    this.addRaw(this.src.slice(this.i, end))
    this.i = end
  }

  /** `[n]>`, `>>`, `>|`, `>&m`, `>&-`, `{var}>`. */
  private outputRedirect(): void {
    const src = this.src
    this.dropFdPrefix()
    this.i++
    if (src[this.i] === '>' || src[this.i] === '|') this.i++
    if (src[this.i] === '&') {
      // `>&2`, `>&-`: a descriptor dup or close, never a file.
      this.i++
      while (this.i < src.length && (/\d/.test(src[this.i]!) || src[this.i] === '-')) this.i++
      return
    }
    this.redirectPending = true
  }

  /** `[n]<`, `<>`, `<&m`, `<<[-]WORD`, `<<<WORD`. */
  private inputRedirect(): void {
    const src = this.src
    this.dropFdPrefix()
    if (src[this.i + 1] === '<' && src[this.i + 2] === '<') {
      // A here-string feeds a word, not lines.
      this.i += 3
      this.skipSpaces()
      this.i = skipWord(src, this.i)
      return
    }
    if (src[this.i + 1] === '<') {
      this.i += 2
      const stripTabs = src[this.i] === '-'
      if (stripTabs) this.i++
      this.skipSpaces()
      const end = skipWord(src, this.i)
      this.heredocs.push({ delimiter: src.slice(this.i, end).replace(/["'\\]/g, ''), stripTabs, owner: this.segments.length })
      this.i = end
      return
    }
    if (src[this.i + 1] === '&') {
      this.i += 2
      while (this.i < src.length && (/\d/.test(src[this.i]!) || src[this.i] === '-')) this.i++
      return
    }
    if (src[this.i + 1] === '>') {
      // `<>` opens for reading and writing.
      this.i += 2
      this.redirectPending = true
      return
    }
    this.i++
    this.skipSpaces()
    this.i = skipWord(src, this.i)
  }

  /** `2>`, `{fd}>`: the descriptor before the arrow belongs to the redirect, not to a word. */
  private dropFdPrefix(): void {
    if (this.inWord && !this.wordQuoted && FD_PREFIX.test(this.word)) {
      this.word = ''
      this.inWord = false
    } else this.endWord()
  }

  private skipSpaces(): void {
    while (this.i < this.src.length && (this.src[this.i] === ' ' || this.src[this.i] === '\t')) this.i++
  }

  private openParen(): void {
    const src = this.src
    if (src[this.i + 1] === '(') {
      // `(( … ))`: an arithmetic command, which runs nothing.
      this.endWord()
      const end = matchingParen(src, this.i + 2)
      this.i = src[end] === ')' ? end + 1 : end
      this.words = []
      return
    }
    this.endWord()
    if (this.cases[this.cases.length - 1] === 'pattern') {
      // `(pattern)`: the optional opening of a pattern list.
      this.i++
      return
    }
    const named = this.words.filter((w) => !(w.text === 'function' && !w.quoted))
    let j = this.i + 1
    while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++
    if (named.length === 1 && src[j] === ')') {
      // `name()`: a function definition; its body is listed when it comes.
      this.words = []
      this.i = j + 1
      return
    }
    // A subshell: its commands are commands.
    this.endSegment(this.i, this.i + 1)
  }

  private closeParen(): void {
    this.endWord()
    if (this.cases[this.cases.length - 1] === 'pattern') {
      // The words so far were the pattern; the clause body follows.
      this.words = []
      this.cases[this.cases.length - 1] = 'body'
      this.i++
      return
    }
    this.endSegment(this.i, this.i + 1)
  }

  private newline(): void {
    if (this.heredocs.length === 0) {
      this.endSegment(this.i, this.i + 1)
      return
    }
    // The bodies are data, not commands: they go to the command that opened them and are not scanned.
    const textEnd = this.i
    let j = this.i + 1
    for (const { delimiter, stripTabs, owner } of this.heredocs) {
      const bodyStart = j
      while (j < this.src.length) {
        const eol = this.src.indexOf('\n', j)
        const end = eol === -1 ? this.src.length : eol
        const line = stripTabs ? this.src.slice(j, end).replace(/^\t+/, '') : this.src.slice(j, end)
        j = eol === -1 ? this.src.length : eol + 1
        if (line === delimiter) break
      }
      const body = '\n' + this.src.slice(bodyStart, j).replace(/\n$/, '')
      if (owner < this.segments.length) this.segments[owner]!.text += body
      else this.heredocText += body
    }
    this.heredocs = []
    this.endSegment(textEnd, j)
  }

  private endWord(): void {
    if (!this.inWord) return
    const word: Word = { text: this.word, start: this.wordStart, quoted: this.wordQuoted, equalsAt: this.equalsAt }
    this.word = ''
    this.inWord = false
    if (this.redirectPending) {
      if (!isHarmlessRedirectTarget(word.text)) this.writesFile = true
      this.redirectPending = false
      return
    }
    this.words.push(word)
    if (word.quoted) return
    if (word.text === '[[') this.inConditional = true
    if (word.text === ']]') this.inConditional = false
    // `case WORD in` is closed by `in`, not by an operator: the patterns follow on the same line.
    const head = this.words.length - 3
    if (word.text === 'in' && head >= 0 && isReserved(this.words[head], 'case') && this.words.slice(0, head).every((w) => isReserved(w) && PREFIX_WORDS.has(w.text))) {
      this.cases.push('pattern')
      this.words = []
    }
  }

  /** Closes the segment whose text ends at `textEnd`; the next one starts at `nextStart`. */
  private endSegment(textEnd: number, nextStart: number): void {
    this.endWord()
    const command = this.commandWords()
    if (command) {
      const text = this.src.slice(command.from, textEnd).trim() + this.heredocText
      this.segments.push({ text, tokens: command.words.map((w) => w.text), writesFile: this.writesFile })
    }
    this.words = []
    this.writesFile = false
    this.redirectPending = false
    this.heredocText = ''
    this.inConditional = false
    this.i = nextStart
  }

  /** The simple command in this segment, once the grammar around it is taken away; nothing when the segment runs no command. */
  private commandWords(): { words: Word[]; from: number } | undefined {
    let words = this.words
    for (;;) {
      const first = words[0]
      if (isReserved(first) && PREFIX_WORDS.has(first.text)) {
        words = words.slice(1)
        if (first.text === 'time' && words[0]?.text === '-p') words = words.slice(1)
      } else if (isReserved(first, 'function')) {
        // `function NAME`: the name is not a command; the body follows.
        words = words.slice(2)
      } else break
    }
    const first = words[0]
    if (!first) return undefined
    if (isReserved(first) && HEADER_WORDS.has(first.text)) {
      if (first.text === 'esac') this.cases.pop()
      return undefined
    }
    if (this.cases[this.cases.length - 1] === 'pattern') return undefined
    const from = first.start
    while (words[0] && isAssignment(words[0])) words = words.slice(1)
    return words.length ? { words, from } : undefined
  }
}

function isReserved(word: Word | undefined, text?: string): word is Word {
  return word !== undefined && !word.quoted && (text === undefined || word.text === text)
}

function isAssignment(word: Word): boolean {
  return word.equalsAt > 0 && ASSIGNMENT.test(word.text.slice(0, word.equalsAt))
}

/** The index just past the `)` that closes a group opened before `from`, or the end; quotes are skipped, nesting counted. */
function matchingParen(src: string, from: number): number {
  let depth = 1
  let i = from
  while (i < src.length) {
    const c = src[i]!
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === "'") {
      const close = src.indexOf("'", i + 1)
      i = close === -1 ? src.length : close + 1
      continue
    }
    if (c === '"') {
      i = closingDoubleQuote(src, i + 1)
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i + 1
    i++
  }
  return src.length
}

/** The index just past the `"` that closes a string opened before `from`; a `$(…)` inside may hold quotes of its own. */
function closingDoubleQuote(src: string, from: number): number {
  let i = from
  while (i < src.length) {
    const c = src[i]!
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '"') return i + 1
    if (c === '$' && src[i + 1] === '(') {
      i = matchingParen(src, i + 2)
      continue
    }
    i++
  }
  return src.length
}

/** The end of the word starting at `from`: quotes inside it are skipped as text, not resolved. */
function skipWord(src: string, from: number): number {
  let i = from
  while (i < src.length && !/[\s;|&<>()]/.test(src[i]!)) {
    const c = src[i]!
    if (c === "'" || c === '"') {
      const close = src.indexOf(c, i + 1)
      i = close === -1 ? src.length : close + 1
      continue
    }
    i += c === '\\' ? 2 : 1
  }
  return Math.min(i, src.length)
}

function isHarmlessRedirectTarget(target: string): boolean {
  return target === '/dev/null' || target === 'NUL' || target === 'nul' || /^&\d+$/.test(target)
}
