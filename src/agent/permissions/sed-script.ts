/**
 * Whether a sed script only prints what it reads: an address or two, then `p`,
 * `d`, `q`, `Q` or `=`, or one `s///` whose flags only change how it matches.
 *
 * A shape not listed here is refused rather than read, because sed's script is
 * a language of its own: `e` runs a shell command, `w` writes any path, and
 * both appear again as flags on `s`. The same letters sit inside regexes and
 * replacements, so telling a command from text means knowing where a command
 * can stand, and a letter missed there would run anything without a prompt.
 * Refusing an unknown shape costs a permission prompt instead.
 */
export function sedScriptInspects(script: string): boolean {
  let at = 0
  while (at < script.length) {
    at = pastSeparators(script, at)
    if (at >= script.length) break
    if (script[at] === '#') {
      while (at < script.length && script[at] !== '\n') at++
      continue
    }
    const end = commandEnd(script, at)
    if (end === undefined) return false
    const after = script[end]
    if (after !== undefined && !SEPARATORS.includes(after)) return false
    at = end
  }
  return true
}

const SEPARATORS = ' \t\n;'
/** Flags of `s` that only change how it matches or whether it prints. `w` writes a file and `e` runs the result. */
const SUBSTITUTION_FLAGS = 'gpiImM0123456789'

/** The end of one command, or undefined when it is not a shape known to be without effect. */
function commandEnd(script: string, from: number): number | undefined {
  const addressed = addressesEnd(script, from)
  if (addressed === undefined) return undefined
  let at = pastBlanks(script, addressed)
  while (script[at] === '!') at = pastBlanks(script, at + 1)
  const command = script[at]
  if (command === 's') return substitutionEnd(script, at + 1)
  if (command === 'p' || command === 'd' || command === '=') return at + 1
  // `q` and `Q` take the exit code to stop with.
  if (command === 'q' || command === 'Q') {
    at++
    while (isDigit(script[at])) at++
    return at
  }
  return undefined
}

/** The end of the command's addresses, which is `from` itself when it has none. */
function addressesEnd(script: string, from: number): number | undefined {
  const first = oneAddress(script, from)
  if (first === undefined || first === from) return first
  const comma = pastBlanks(script, first)
  if (script[comma] !== ',') return first
  const second = pastBlanks(script, comma + 1)
  // `addr,+N` and `addr,~N` end the range by counting lines from the first.
  if (script[second] === '+' || script[second] === '~') return digitsEnd(script, second + 1)
  const end = oneAddress(script, second)
  return end === second ? undefined : end
}

/** A line number, `$`, `first~step`, `/regex/` or `\cregexc`; `from` back again when the command carries no address. */
function oneAddress(script: string, from: number): number | undefined {
  const start = script[from]
  if (start === '$') return from + 1
  if (isDigit(start)) {
    const end = digitsEnd(script, from)
    if (end === undefined || script[end] !== '~') return end
    return digitsEnd(script, end + 1)
  }
  if (start === '/') return matchFlagsEnd(script, delimitedEnd(script, from + 1, '/'))
  if (start === '\\') {
    const delimiter = script[from + 1]
    return delimiter === undefined ? undefined : matchFlagsEnd(script, delimitedEnd(script, from + 2, delimiter))
  }
  return from
}

function substitutionEnd(script: string, from: number): number | undefined {
  const delimiter = script[from]
  if (delimiter === undefined || delimiter === '\\' || delimiter === '\n') return undefined
  const pattern = delimitedEnd(script, from + 1, delimiter)
  if (pattern === undefined) return undefined
  const replacement = delimitedEnd(script, pattern, delimiter)
  if (replacement === undefined) return undefined
  let at = replacement
  while (at < script.length && SUBSTITUTION_FLAGS.includes(script[at]!)) at++
  return at
}

/** The index just past the delimiter that closes a regex or a replacement; a backslash escapes the next character. */
function delimitedEnd(script: string, from: number, delimiter: string): number | undefined {
  for (let at = from; at < script.length; at++) {
    const character = script[at]!
    if (character === '\\') {
      at++
      continue
    }
    if (character === delimiter) return at + 1
  }
  return undefined
}

/** `I` and `M` after a regex address say how it matches. */
function matchFlagsEnd(script: string, end: number | undefined): number | undefined {
  if (end === undefined) return undefined
  let at = end
  while (script[at] === 'I' || script[at] === 'M') at++
  return at
}

function digitsEnd(script: string, from: number): number | undefined {
  if (!isDigit(script[from])) return undefined
  let at = from
  while (isDigit(script[at])) at++
  return at
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9'
}

function pastBlanks(script: string, from: number): number {
  let at = from
  while (script[at] === ' ' || script[at] === '\t') at++
  return at
}

function pastSeparators(script: string, from: number): number {
  let at = from
  while (at < script.length && SEPARATORS.includes(script[at]!)) at++
  return at
}
