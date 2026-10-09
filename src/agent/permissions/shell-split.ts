import { SimpleCommandBuilder } from './shell-command'
import { redirectAt } from './shell-redirect'
import { ansiQuoted, blanksEnd, closingBrace, doubleParenAt, heredocBodies, lineEnd, substitutionAt, type Heredoc } from './shell-scan'
import { WordBuffer } from './shell-word'

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
  /** The targets of an output redirect, as written: a word that still holds an expansion names no path a rule can judge. */
  writes: string[]
  /** The targets among `writes` that `>>` adds to rather than replaces. */
  appends: string[]
  /** A heredoc or here-string feeds the command text written in the line itself. */
  fedText: boolean
  /** Files fed in by `< path`: read as surely as a file named as an argument, and named nowhere in `tokens`. */
  reads: string[]
  /** A word of it came out of `$(…)`, backticks or `<(…)`: it holds the substitution as written, not what it will stand for. */
  substituted: boolean
  /**
   * How it is joined to the command before it, where the shell's directory can
   * be followed across: `start` for the line's first command, `&&` or `|` for
   * one joined by that operator alone along an unbroken chain from the start.
   * Absent past anything else: another operator, a reserved word, a subshell,
   * or a command written inside a substitution.
   */
  joined?: 'start' | '&&' | '|'
}

export type ShellCommand = {
  /** Every simple command the line runs, the ones inside a substitution among them, each listed after the command whose word holds it. */
  segments: ShellSegment[]
}

export function splitShellCommand(command: string): ShellCommand {
  return new Splitter(command).run()
}

/** Reads the line a character at a time; the word being read and the command it belongs to keep their own state. */
class Splitter {
  private readonly segments: ShellSegment[] = []
  /** Commands found in the substitutions of the segment being read; they are listed after it. */
  private nested: ShellSegment[] = []
  private readonly word = new WordBuffer()
  private readonly command = new SimpleCommandBuilder()
  /** Heredocs opened on the current line; their bodies start on the next line, in order. */
  private heredocs: Heredoc[] = []
  /** Bodies of the current segment's heredocs, appended to its text when it closes. */
  private heredocText = ''
  /** How the next command is joined to the one before it; see `ShellSegment.joined`. */
  private joinedBy: ShellSegment['joined'] = 'start'
  private i = 0

  constructor(private readonly src: string) {}

  run(): ShellCommand {
    while (this.i < this.src.length) this.step(this.src[this.i]!, this.src[this.i + 1])
    this.endSegment(this.src.length, this.src.length)
    return { segments: this.segments }
  }

  private step(c: string, next: string | undefined): void {
    if (this.quoting(c, next) || this.expansion(c, next, !this.command.inConditional)) return
    if (c === '#' && !this.word.isOpen) this.i = lineEnd(this.src, this.i)
    else if (c === ' ' || c === '\t') {
      this.endWord()
      this.i++
    } else if (c === '\n') this.newline()
    else if (!this.operator(c, next)) {
      this.add(c)
      this.i++
    }
  }

  /** Escapes and quotes. True when one was read. */
  private quoting(c: string, next: string | undefined): boolean {
    if (c === '\\') this.escaped(next)
    else if (c === "'") this.singleQuoted()
    else if (c === '"') this.doubleQuoted()
    else if (c === '$' && next === "'") this.ansiQuoted()
    else if (c === '$' && next === '"') {
      this.i++
      this.doubleQuoted()
    } else return false
    return true
  }

  /** A backslash-newline joins lines; any other escaped character is literal. */
  private escaped(next: string | undefined): void {
    if (next !== undefined && next !== '\n') this.add(next)
    this.i += next === undefined ? 1 : 2
  }

  /** `$((…))`, `$(…)`, `${…}`, backticks, and `<(…)` or `>(…)` where `processes` allows. True when one was read. */
  private expansion(c: string, next: string | undefined, processes: boolean): boolean {
    if (c === '$' && next === '{') {
      this.parameterExpansion()
      return true
    }
    const found = substitutionAt(this.src, this.i, processes)
    if (!found) return false
    // `$((…))` runs nothing itself, but a `$(…)` inside it still does.
    if (found.arithmetic) this.hideIn(found.inner)
    else {
      this.nested.push(...splitShellCommand(found.inner).segments)
      this.markSubstituted()
    }
    this.add(this.src.slice(this.i, found.end), true)
    this.i = found.end
    return true
  }

  /** Control and redirection operators, and what stands in for them inside `[[ … ]]`. True when one was read. */
  private operator(c: string, next: string | undefined): boolean {
    if (this.command.inConditional && this.conditionalWord(c, next)) return true
    if (c === ';') this.semicolon(next)
    else if (c === '&' || c === '|') this.controlOperator(c, next)
    else if (c === '>' || c === '<') this.redirect()
    else if (c === '(') this.openParen()
    else if (c === ')') this.closeParen()
    else return false
    return true
  }

  /** Inside `[[ … ]]` `<`, `>`, `(`, `)`, `&&` and `||` compare and group. True when one was read. */
  private conditionalWord(c: string, next: string | undefined): boolean {
    const two = (c === '&' || c === '|') && next === c
    if (!two && !'<>()'.includes(c)) return false
    this.add(two ? c + c : c)
    this.i += two ? 2 : 1
    return true
  }

  /** `;`, and `;;`, `;&` or `;;&`, which end a case clause. */
  private semicolon(next: string | undefined): void {
    const clause = next === ';' || next === '&'
    this.endSegment(this.i, this.i + (!clause ? 1 : this.src[this.i + 2] === '&' ? 3 : 2))
    if (clause) this.command.endClause()
  }

  /** `&&`, `||`, `|&`, `|` and `&` end a command; `&>` and `&>>` send both streams to a file. */
  private controlOperator(c: string, next: string | undefined): void {
    if (c === '&' && next === '>') {
      this.endWord()
      const append = this.src[this.i + 2] === '>'
      this.i += append ? 3 : 2
      this.command.redirectNextWord(append)
      return
    }
    this.endSegment(this.i, this.i + (next === c || (c === '|' && next === '&') ? 2 : 1))
  }

  private add(text: string, quoted = false): void {
    this.word.add(text, this.i, quoted)
  }

  private singleQuoted(): void {
    const end = this.src.indexOf("'", this.i + 1)
    const close = end === -1 ? this.src.length : end
    this.add('', true)
    this.add(this.src.slice(this.i + 1, close), true)
    this.i = close + 1
  }

  /** `$'…'`: backslash escapes are resolved, so `\'` does not close it. */
  private ansiQuoted(): void {
    const { text, end } = ansiQuoted(this.src, this.i)
    this.add(text, true)
    this.i = end
  }

  /** Inside double quotes only `\`, `$` and backticks keep meaning; a substitution is skipped whole so its quotes do not end ours. */
  private doubleQuoted(): void {
    const src = this.src
    this.add('', true)
    this.i++
    while (this.i < src.length && src[this.i] !== '"') {
      const c = src[this.i]!
      const next = src[this.i + 1]
      if (c === '\\' && next !== undefined && '\n"\\$`'.includes(next)) {
        if (next !== '\n') this.add(next, true)
        this.i += 2
      } else if (!this.expansion(c, next, false)) {
        this.add(c, true)
        this.i++
      }
    }
    this.i++
  }

  private parameterExpansion(): void {
    const end = closingBrace(this.src, this.i)
    const raw = this.src.slice(this.i, end)
    this.hideIn(raw)
    this.add(raw, true)
    this.i = end
  }

  /** An expansion is a word, but a `$(…)` or a backtick written inside one still runs. */
  private hideIn(raw: string): void {
    const hidden = hiddenCommands(raw)
    if (hidden.length === 0) return
    this.nested.push(...hidden)
    this.markSubstituted()
  }

  /** The word being read stands for what a substitution prints, not for its own text. */
  private markSubstituted(): void {
    this.word.markSubstituted(this.i)
  }

  /** `[n]>`, `{var}>` and every other redirect: the descriptor before the arrow belongs to it, not to a word. */
  private redirect(): void {
    if (!this.word.dropFdPrefix()) this.endWord()
    const found = redirectAt(this.src, this.i)
    if (found.kind === 'writes') this.command.redirectNextWord(found.append)
    else if (found.kind === 'reads') this.command.readNextWord()
    else if (found.kind === 'here-string') this.command.feedText()
    else if (found.kind === 'heredoc') {
      this.command.feedText()
      this.heredocs.push({ delimiter: found.delimiter, stripTabs: found.stripTabs, owner: this.segments.length })
    }
    this.i = found.end
  }

  private openParen(): void {
    this.endWord()
    if (this.src[this.i + 1] === '(') return this.arithmeticCommand()
    if (this.command.inCasePattern) {
      // `(pattern)`: the optional opening of a pattern list.
      this.i++
      return
    }
    const close = blanksEnd(this.src, this.i + 1)
    if (this.src[close] === ')' && this.command.namesFunction()) {
      // `name()`: a function definition; its body is listed when it comes.
      this.command.dropWords()
      this.i = close + 1
      return
    }
    // A subshell: its commands are commands.
    this.endSegment(this.i, this.i + 1)
  }

  /** `(( … ))` runs nothing of its own; a `$(…)` written inside it still runs. */
  private arithmeticCommand(): void {
    const found = doubleParenAt(this.src, this.i)
    this.nested.push(...hiddenCommands(found.inner))
    this.i = found.end
    this.command.dropWords()
  }

  private closeParen(): void {
    this.endWord()
    if (!this.command.inCasePattern) return this.endSegment(this.i, this.i + 1)
    this.command.endPattern()
    this.i++
  }

  private newline(): void {
    if (this.heredocs.length === 0) return this.endSegment(this.i, this.i + 1)
    // The bodies are data, not commands: they go to the command that opened them and are not scanned.
    const { bodies, end } = heredocBodies(this.src, this.i + 1, this.heredocs)
    this.heredocs.forEach(({ owner }, n) => {
      if (owner < this.segments.length) this.segments[owner]!.text += bodies[n]
      else this.heredocText += bodies[n]
    })
    this.heredocs = []
    this.endSegment(this.i, end)
  }

  private endWord(): void {
    const word = this.word.take()
    if (word) this.command.accept(word)
  }

  /** Closes the segment whose text ends at `textEnd`; the next one starts at `nextStart`. */
  private endSegment(textEnd: number, nextStart: number): void {
    this.endWord()
    const segment = this.command.close(this.src, textEnd, this.heredocText, this.joinedBy)
    if (segment) this.segments.push(segment)
    const operator = this.src.slice(textEnd, nextStart).trim()
    this.joinedBy = segment?.joined !== undefined && (operator === '&&' || operator === '|') ? operator : undefined
    // What a substitution hides runs too, whether or not the command holding it turned out to be one. It runs wherever its holder stands, which is no link in the chain.
    this.segments.push(...this.nested.map(({ joined: _joined, ...nested }) => nested))
    this.nested = []
    this.heredocText = ''
    this.i = nextStart
  }
}

/**
 * The commands written in the substitutions of a stretch of source that is a
 * word rather than a command of its own: `${x:-$(ls)}`, `$(( $(ls | wc -l) ))`
 * and `(( … ))`. The text around them decides nothing, so only what a
 * substitution holds is read, and that as a command line in its own right.
 */
function hiddenCommands(raw: string): ShellSegment[] {
  const found: ShellSegment[] = []
  let i = 0
  while (i < raw.length) {
    const substitution = substitutionAt(raw, i, true)
    if (!substitution) {
      i += raw[i] === '\\' ? 2 : 1
      continue
    }
    found.push(...(substitution.arithmetic ? hiddenCommands(substitution.inner) : splitShellCommand(substitution.inner).segments))
    i = substitution.end
  }
  return found
}
