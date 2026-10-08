/**
 * Reads of shell source that only find where something ends: a quoted string,
 * a group, a word, a heredoc body. What the text means is `shell-split`'s to
 * decide. Pure, so the webview can use it too.
 */

/** A heredoc opened on a line; its body starts on the next one. `owner` is the index of the segment that opened it. */
export type Heredoc = { delimiter: string; stripTabs: boolean; owner: number }

/** A substitution as written: the source it holds, and the index just past it. `$((…))` and `((…))` are arithmetic. */
export type Substitution = { arithmetic: boolean; inner: string; end: number }

/** A `$((…))`, `$(…)` or backtick group starting at `at`, and `<(…)` or `>(…)` where `processes` allows them. */
export function substitutionAt(src: string, at: number, processes: boolean): Substitution | undefined {
  const c = src[at]
  if (c === '`') return backticksAt(src, at)
  if (src[at + 1] !== '(') return undefined
  if (c === '$' && src[at + 2] === '(') return doubleParenAt(src, at + 1)
  if (c === '$' || (processes && (c === '<' || c === '>'))) return groupAt(src, at)
  return undefined
}

/** `((…))` whose first `(` is at `open`. */
export function doubleParenAt(src: string, open: number): Substitution {
  const close = matchingParen(src, open + 2)
  return { arithmetic: true, inner: src.slice(open + 2, Math.max(open + 2, close - 1)), end: src[close] === ')' ? close + 1 : close }
}

function groupAt(src: string, at: number): Substitution {
  const end = matchingParen(src, at + 2)
  return { arithmetic: false, inner: src.slice(at + 2, src[end - 1] === ')' ? end - 1 : end), end }
}

function backticksAt(src: string, at: number): Substitution {
  let j = at + 1
  while (j < src.length && src[j] !== '`') j += src[j] === '\\' ? 2 : 1
  return { arithmetic: false, inner: src.slice(at + 1, Math.min(j, src.length)), end: Math.min(j + 1, src.length) }
}

/** The index just past the `}` that closes the `${…}` whose `$` is at `from`; braces nest. */
export function closingBrace(src: string, from: number): number {
  let depth = 0
  for (let j = from + 1; j < src.length; j++) {
    const c = src[j]
    if (c === '\\') j++
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return j + 1
  }
  return src.length
}

const ANSI_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', E: '\x1b' }

/** The text of the `$'…'` whose `$` is at `from`, escapes resolved, and the index just past its closing quote. */
export function ansiQuoted(src: string, from: number): { text: string; end: number } {
  let text = ''
  let i = from + 2
  while (i < src.length && src[i] !== "'") {
    if (src[i] === '\\' && i + 1 < src.length) {
      const escaped = src[i + 1]!
      text += ANSI_ESCAPES[escaped] ?? `\\${escaped}`
      i += 2
    } else text += src[i++]
  }
  return { text, end: i + 1 }
}

/**
 * The bodies of the heredocs opened on a line, in order, each with the newline
 * that leads it; `from` is the start of the next line. `end` is where commands
 * resume after the last body.
 */
export function heredocBodies(src: string, from: number, heredocs: Heredoc[]): { bodies: string[]; end: number } {
  const bodies: string[] = []
  let j = from
  for (const { delimiter, stripTabs } of heredocs) {
    const bodyStart = j
    j = pastDelimiterLine(src, j, delimiter, stripTabs)
    bodies.push('\n' + src.slice(bodyStart, j).replace(/\n$/, ''))
  }
  return { bodies, end: j }
}

function pastDelimiterLine(src: string, from: number, delimiter: string, stripTabs: boolean): number {
  let j = from
  while (j < src.length) {
    const eol = src.indexOf('\n', j)
    const line = src.slice(j, eol === -1 ? src.length : eol)
    j = eol === -1 ? src.length : eol + 1
    if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) break
  }
  return j
}

/** The index just past the `)` that closes a group opened before `from`, or the end; quotes are skipped, nesting counted. */
export function matchingParen(src: string, from: number): number {
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
export function skipWord(src: string, from: number): number {
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

/** The end of a descriptor after `>&` or `<&`: digits, or `-` to close it. */
export function descriptorEnd(src: string, from: number): number {
  let i = from
  while (i < src.length && (/\d/.test(src[i]!) || src[i] === '-')) i++
  return i
}

export function blanksEnd(src: string, from: number): number {
  let i = from
  while (src[i] === ' ' || src[i] === '\t') i++
  return i
}

/** The `\n` that ends the line `from` is on, or the end of the source. */
export function lineEnd(src: string, from: number): number {
  const eol = src.indexOf('\n', from)
  return eol === -1 ? src.length : eol
}
