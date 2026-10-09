import { blanksEnd, descriptorEnd, skipWord } from './shell-scan'

/**
 * What a redirect does with the word after it, and the index just past the
 * operator, or past the word when the redirect consumes it itself. A
 * descriptor dup or close and a here-string name no file.
 */
export type Redirect =
  | { kind: 'reads' | 'descriptor' | 'here-string'; end: number }
  /** `append` for `>>`, which adds to a file rather than replacing what it held. */
  | { kind: 'writes'; append: boolean; end: number }
  | { kind: 'heredoc'; delimiter: string; stripTabs: boolean; end: number }

/** The redirect whose `<` or `>` is at `at`; a descriptor before it is the caller's to drop. */
export function redirectAt(src: string, at: number): Redirect {
  return src[at] === '>' ? outputRedirectAt(src, at) : inputRedirectAt(src, at)
}

/** `>`, `>>`, `>|`, `>&m`, `>&-`. */
function outputRedirectAt(src: string, at: number): Redirect {
  let i = at + 1
  const append = src[i] === '>'
  if (src[i] === '>' || src[i] === '|') i++
  // `>&2`, `>&-`: a descriptor dup or close, never a file.
  return src[i] === '&' ? { kind: 'descriptor', end: descriptorEnd(src, i + 1) } : { kind: 'writes', append, end: i }
}

/** `<`, `<>`, `<&m`, `<<[-]WORD`, `<<<WORD`. */
function inputRedirectAt(src: string, at: number): Redirect {
  const next = src[at + 1]
  // A here-string feeds a word, not lines.
  if (next === '<' && src[at + 2] === '<') return { kind: 'here-string', end: skipWord(src, blanksEnd(src, at + 3)) }
  if (next === '<') return heredocAt(src, at)
  if (next === '&') return { kind: 'descriptor', end: descriptorEnd(src, at + 2) }
  // `<>` opens for reading and writing.
  if (next === '>') return { kind: 'writes', append: true, end: at + 2 }
  // The file it feeds in is read, so the word is taken like any other, quotes and expansions resolved.
  return { kind: 'reads', end: at + 1 }
}

function heredocAt(src: string, at: number): Redirect {
  const stripTabs = src[at + 2] === '-'
  const start = blanksEnd(src, at + (stripTabs ? 3 : 2))
  const end = skipWord(src, start)
  return { kind: 'heredoc', delimiter: src.slice(start, end).replace(/["'\\]/g, ''), stripTabs, end }
}
