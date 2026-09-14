/**
 * Splits a shell command line the way a POSIX shell would, far enough to
 * judge it: which simple commands run, whether any writes a file through a
 * redirect, and whether a substitution hides a command we cannot see.
 * Pure, so the webview can use it too.
 */

export type ShellSegment = {
  /** The command as written, redirects and quotes included, without the operator around it. */
  text: string
  /** The words of one simple command, quotes and escapes resolved. */
  tokens: string[]
  /** A `>` or `>>` redirect to something other than /dev/null or a file descriptor. */
  writesFile: boolean
}

export type ShellCommand = {
  segments: ShellSegment[]
  /** `$(...)`, backticks or `<(...)`: a command runs that the tokens do not show. */
  substitutes: boolean
}

export function splitShellCommand(command: string): ShellCommand {
  const segments: ShellSegment[] = []
  let tokens: string[] = []
  let word = ''
  let inWord = false
  let writesFile = false
  let substitutes = false
  let redirectPending = false
  let segmentStart = 0

  const endWord = () => {
    if (!inWord) return
    if (redirectPending) {
      if (!isHarmlessRedirectTarget(word)) writesFile = true
      redirectPending = false
    } else {
      tokens.push(word)
    }
    word = ''
    inWord = false
  }
  let i = 0
  /** Closes the segment before the operator at `i`; the next one starts after the operator's `length` characters. */
  const endSegment = (length = 0) => {
    endWord()
    if (tokens.length > 0) segments.push({ text: command.slice(segmentStart, i).trim(), tokens, writesFile })
    tokens = []
    writesFile = false
    redirectPending = false
    segmentStart = i + length
  }

  while (i < command.length) {
    const c = command[i]!
    const next = command[i + 1]
    if (c === "'") {
      const end = command.indexOf("'", i + 1)
      const close = end === -1 ? command.length : end
      word += command.slice(i + 1, close)
      inWord = true
      i = close + 1
      continue
    }
    if (c === '"') {
      i++
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < command.length && '"\\$`'.includes(command[i + 1]!)) {
          word += command[i + 1]
          i += 2
          continue
        }
        if (command[i] === '`' || (command[i] === '$' && command[i + 1] === '(')) substitutes = true
        word += command[i]
        i++
      }
      inWord = true
      i++
      continue
    }
    if (c === '\\' && next !== undefined) {
      word += next
      inWord = true
      i += 2
      continue
    }
    if (c === '`' || (c === '$' && next === '(') || ((c === '<' || c === '>') && next === '(')) {
      substitutes = true
      word += c
      inWord = true
      i++
      continue
    }
    if (c === '&' && next === '&') {
      endSegment(2)
      i += 2
      continue
    }
    if (c === '&' && next === '>') {
      // `&> file`: both streams to a file.
      endWord()
      redirectPending = true
      i += 2
      continue
    }
    if (c === '|' && next === '|') {
      endSegment(2)
      i += 2
      continue
    }
    if (c === ';' || c === '|' || c === '&' || c === '\n') {
      endSegment(1)
      i++
      continue
    }
    if (c === '>') {
      // `2>x`, `&>x`: the descriptor or ampersand before the arrow belongs to the redirect, not to a word.
      if (inWord && (/^\d+$/.test(word) || word === '&')) {
        word = ''
        inWord = false
      } else endWord()
      redirectPending = true
      if (next === '>') i++
      if (command[i + 1] === '&') {
        // `>&2`, `>&1`: a descriptor dup, never a file.
        redirectPending = false
        i += 2
        while (i < command.length && /\d/.test(command[i]!)) i++
        continue
      }
      i++
      continue
    }
    if (c === '<') {
      // Input redirects read; skip the arrow and let the target be dropped as a word.
      endWord()
      i++
      while (i < command.length && /\s/.test(command[i]!)) i++
      while (i < command.length && !/[\s;|&<>]/.test(command[i]!)) i++
      continue
    }
    if (/\s/.test(c)) {
      endWord()
      i++
      continue
    }
    word += c
    inWord = true
    i++
  }
  endSegment()
  return { segments, substitutes }
}

function isHarmlessRedirectTarget(target: string): boolean {
  return target === '/dev/null' || target === 'NUL' || target === 'nul' || /^&\d+$/.test(target)
}
