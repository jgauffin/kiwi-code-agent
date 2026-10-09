import type { ShellSegment } from './shell-split'
import { isAssignment, isReserved, type Word } from './shell-word'

/** Reserved words that only open or close a construct; the command follows them. `time` may take `-p`. */
const PREFIX_WORDS = new Set(['!', '{', '}', 'if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'while', 'until', 'time', 'coproc'])
/** Reserved words whose whole clause runs nothing: the words after them are names, patterns or lists, not a command. */
const HEADER_WORDS = new Set(['for', 'select', 'case', 'esac', 'in'])

/**
 * The words and redirects of the simple command being read, and the grammar
 * around it that decides which of them are the command: reserved words,
 * `[[ … ]]` and the `case` constructs still open, which outlive the command.
 */
export class SimpleCommandBuilder {
  private words: Word[] = []
  private writes: string[] = []
  private appends: string[] = []
  /** Files fed in by `< path`. */
  private reads: string[] = []
  private fedText = false
  /** The next word is the file an output redirect writes. */
  private redirectPending = false
  private appendPending = false
  /** The next word is the file an input redirect feeds in, not a word of the command. */
  private readPending = false
  private conditional = false
  /** Open `case` constructs: whether the next words are a pattern or a clause body. */
  private cases: ('pattern' | 'body')[] = []

  /** Inside `[[ … ]]`, where `<`, `>`, `&&`, `||`, `(` and `)` are comparisons and grouping, not operators. */
  get inConditional(): boolean {
    return this.conditional
  }

  /** The words being read are a `case` pattern, not a command. */
  get inCasePattern(): boolean {
    return this.cases.at(-1) === 'pattern'
  }

  redirectNextWord(append: boolean): void {
    this.redirectPending = true
    this.appendPending = append
  }

  /** A heredoc or here-string feeds the command text written in the line. */
  feedText(): void {
    this.fedText = true
  }

  readNextWord(): void {
    this.readPending = true
  }

  /** The words so far run nothing: a function's name, or an arithmetic command. */
  dropWords(): void {
    this.words = []
  }

  /** `;;`, `;&` or `;;&` ended a case clause: a pattern comes next. */
  endClause(): void {
    if (this.cases.length) this.cases[this.cases.length - 1] = 'pattern'
  }

  /** `)` closed a case pattern: the words so far were the pattern, and the clause body follows. */
  endPattern(): void {
    this.words = []
    this.cases[this.cases.length - 1] = 'body'
  }

  /** `name()` would define a function: the words so far are one name, `function` aside. */
  namesFunction(): boolean {
    return this.words.filter((w) => !isReserved(w, 'function')).length === 1
  }

  accept(word: Word): void {
    if (this.redirectPending) {
      this.redirectPending = false
      if (!isHarmlessRedirectTarget(word.text)) {
        this.writes.push(word.text)
        if (this.appendPending) this.appends.push(word.text)
      }
      return
    }
    if (this.readPending) {
      this.readPending = false
      if (!isHarmlessRedirectTarget(word.text)) this.reads.push(word.text)
      return
    }
    this.words.push(word)
    if (!word.quoted) this.reservedWord(word.text)
  }

  /**
   * The segment read since the last one closed, if it runs a command; its text ends at `textEnd`. Starts the next one.
   * `joined` holds only for a command no reserved word opens: `if`, `do` or `{` put it in a construct the chain cannot follow.
   */
  close(src: string, textEnd: number, heredocText: string, joined: ShellSegment['joined']): ShellSegment | undefined {
    const command = this.commandWords()
    const segment: ShellSegment | undefined = command && {
      text: src.slice(command.from, textEnd).trim() + heredocText,
      tokens: command.words.map((w) => w.text),
      writesFile: this.writes.length > 0,
      writes: this.writes,
      appends: this.appends,
      reads: this.reads,
      fedText: this.fedText,
      substituted: command.words.some((w) => w.substituted),
      ...(joined !== undefined && !command.opened ? { joined } : {}),
    }
    this.words = []
    this.writes = []
    this.appends = []
    this.reads = []
    this.fedText = false
    this.redirectPending = false
    this.appendPending = false
    this.readPending = false
    this.conditional = false
    return segment
  }

  /** The simple command among the words, once the grammar around it is taken away; nothing when they run no command. */
  private commandWords(): { words: Word[]; from: number; opened: boolean } | undefined {
    const words = afterPrefixWords(this.words)
    const opened = words.length !== this.words.length
    const first = words[0]
    if (!first) return undefined
    if (isReserved(first) && HEADER_WORDS.has(first.text)) {
      if (first.text === 'esac') this.cases.pop()
      return undefined
    }
    if (this.inCasePattern) return undefined
    let start = 0
    while (words[start] && isAssignment(words[start]!)) start++
    return start < words.length ? { words: words.slice(start), from: first.start, opened } : undefined
  }

  private reservedWord(text: string): void {
    if (text === '[[') this.conditional = true
    if (text === ']]') this.conditional = false
    if (text === 'in' && this.opensCase()) {
      this.cases.push('pattern')
      this.words = []
    }
  }

  /** `case WORD in` is closed by `in`, not by an operator: the patterns follow on the same line. */
  private opensCase(): boolean {
    const head = this.words.length - 3
    return head >= 0 && isReserved(this.words[head], 'case') && this.words.slice(0, head).every((w) => isReserved(w) && PREFIX_WORDS.has(w.text))
  }
}

/** The words once the reserved words that only open or close a construct are taken away. */
function afterPrefixWords(words: Word[]): Word[] {
  let rest = words
  for (;;) {
    const first = rest[0]
    if (isReserved(first) && PREFIX_WORDS.has(first.text)) rest = rest.slice(first.text === 'time' && rest[1]?.text === '-p' ? 2 : 1)
    // `function NAME`: the name is not a command; the body follows.
    else if (isReserved(first, 'function')) rest = rest.slice(2)
    else return rest
  }
}

function isHarmlessRedirectTarget(target: string): boolean {
  return target === '/dev/null' || target === 'NUL' || target === 'nul' || /^&\d+$/.test(target)
}
