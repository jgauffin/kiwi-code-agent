/** One shell word as read: quotes resolved, plus what the grammar needs to know about how it was written. */
export type Word = { text: string; start: number; quoted: boolean; substituted: boolean; equalsAt: number }

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?$/
const FD_PREFIX = /^(\d+|\{[A-Za-z_][A-Za-z0-9_]*\})$/

/** An unquoted word, which alone can be a reserved word; `text` narrows it to that one. */
export function isReserved(word: Word | undefined, text?: string): word is Word {
  return word !== undefined && !word.quoted && (text === undefined || word.text === text)
}

export function isAssignment(word: Word): boolean {
  return word.equalsAt > 0 && ASSIGNMENT.test(word.text.slice(0, word.equalsAt))
}

/** The word being read, built up a piece at a time. */
export class WordBuffer {
  private text = ''
  private start = 0
  private open = false
  private quoted = false
  private substituted = false
  /** Offset in `text` of its first unquoted `=`, or -1. */
  private equalsAt = -1

  get isOpen(): boolean {
    return this.open
  }

  /** Adds `text` read at `at`; the first piece starts the word, even an empty one, as `''` does. */
  add(text: string, at: number, quoted = false): void {
    if (!this.open) {
      this.open = true
      this.start = at
      this.quoted = false
      this.substituted = false
      this.equalsAt = -1
    }
    if (quoted) this.quoted = true
    if (text === '=' && !quoted && this.equalsAt === -1) this.equalsAt = this.text.length
    this.text += text
  }

  /** The word stands for what a substitution prints, not for its own text. */
  markSubstituted(at: number): void {
    this.add('', at, true)
    this.substituted = true
  }

  /** The finished word, or undefined when none was being read. */
  take(): Word | undefined {
    if (!this.open) return undefined
    const word: Word = { text: this.text, start: this.start, quoted: this.quoted, substituted: this.substituted, equalsAt: this.equalsAt }
    this.text = ''
    this.open = false
    return word
  }

  /** `2>`, `{fd}>`: the descriptor before the arrow belongs to the redirect, not to a word. True when the word was one and is dropped. */
  dropFdPrefix(): boolean {
    if (!this.open || this.quoted || !FD_PREFIX.test(this.text)) return false
    this.text = ''
    this.open = false
    return true
  }
}
