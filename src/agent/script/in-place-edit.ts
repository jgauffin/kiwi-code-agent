import { readFile } from 'node:fs/promises'
import { sourceFiles } from '../code-outline/code-search'
import { languageOf } from '../code-structure/language'
import { LineSearch, type SearchSubject } from '../openai-session/tools/line-search'
import { commandName, unwrapCommand } from '../permissions/command-wrappers'
import { splitShellCommand, type ShellSegment } from '../permissions/shell-split'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'BackgroundBash'])

/** Past this many matching lines, one `replace` is cheaper than an Edit per line. */
const EDIT_LIMIT = 2

const refused = (what: string): string =>
  `${what} is refused: it writes behind the change tracking, so another session working in the same files never learns of it and the user sees no diff.`
const BOTH = 'Make the change with Edit for a line or two, or with RunScript `replace(path, regex, replacement, flags)` for more, which needs no Read first.'
const ROUND_TRIP = 'Rewriting a file through a temporary file moved back over it'

/**
 * Refuses every shell command that rewrites a file in place: `sed -i`, `awk -i
 * inplace`, or output written to a temporary file then moved or copied back
 * over the file it came from. For a sed substitution it tells the model where
 * the change would land, found by the same line search CodeSearch runs, and
 * which tool to use for that many lines.
 */
export class InPlaceEditGate implements SessionHooks {
  constructor(private readonly cwd: string) {}

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    if (!SHELL_TOOLS.has(tool.toolName)) return undefined
    const command = (tool.input as { command?: unknown } | null)?.command
    if (typeof command !== 'string') return undefined
    const { segments } = splitShellCommand(command)
    const sed = segments.map(({ tokens }) => sedCall(unwrapCommand(tokens))).find((call) => call?.inPlace)
    if (sed) return { deny: await this.reason('`sed -i`', sed) }
    if (segments.some(({ tokens }) => awkInPlace(unwrapCommand(tokens)))) return { deny: `${refused('`awk -i inplace`')}\n${BOTH}` }
    const writer = rewrittenThroughTemporaryFile(segments)
    if (!writer) return undefined
    const writerSed = sedCall(unwrapCommand(writer.tokens))
    return { deny: writerSed ? await this.reason(ROUND_TRIP, writerSed) : `${refused(ROUND_TRIP)}\n${BOTH}` }
  }

  private async reason(what: string, sed: SedCall): Promise<string> {
    const substitution = sed.script === undefined ? undefined : parseSubstitution(sed.script)
    const pattern = substitution && jsPattern(substitution.pattern, sed.extended)
    if (!substitution || pattern === undefined || sed.files.length === 0) return `${refused(what)}\n${BOTH}`
    const found = await Promise.all(sed.files.map((file) => this.search(file, pattern, substitution.caseInsensitive)))
    const lines = found.reduce((sum, { count }) => sum + count, 0)
    if (lines === 0) return `${refused(what)}\nIts pattern, read as \`/${pattern}/\`, matches no line in ${sed.files.join(', ')}.`
    const where = found.filter(({ count }) => count > 0).map(({ text }) => text).join('\n\n')
    const tool = lines <= EDIT_LIMIT ? 'Make it with Edit.' : 'Make it with one RunScript `replace(path, regex, replacement, flags)`, which needs no Read first.'
    return `${refused(what)}\nIt would change ${lines} line${lines === 1 ? '' : 's'}. ${tool}\n\n${where}`
  }

  private async search(file: string, pattern: string, caseInsensitive: boolean): Promise<{ count: number; text: string }> {
    const subject = languageOf(file) ? sourceFiles : TEXT_FILES
    const output = await new LineSearch<object, unknown>(subject).execute(
      { query: pattern, regex: true, case_sensitive: !caseInsensitive, path: drivePath(file), limit: 20 },
      { cwd: this.cwd, signal: new AbortController().signal },
    )
    return { count: output.isError ? 0 : (output.items?.length ?? 0), text: output.text }
  }
}

/** Any file the command names that CodeSearch does not read as source: its matches are listed under the file. */
const TEXT_FILES: SearchSubject<object, string> = {
  fileNoun: 'file',
  placeNoun: 'file',
  includes: () => true,
  read: async (path) => {
    const text = await readFile(path, 'utf8')
    return text.includes('\u0000') ? undefined : text
  },
  lines: (text) => text.split(/\r?\n/),
  parse: () => ({}),
  place: ({ file }) => ({ title: file, item: file }),
}

/** Commands that move or copy their first operand over their second. */
const MOVES = new Set(['mv', 'move', 'cp', 'copy', 'move-item', 'copy-item'])

/**
 * The command that writes a temporary file a later move or copy puts back
 * over a file the line read before it; undefined when nothing round-trips.
 * Writing output somewhere and moving it on is left alone: the file it lands
 * on has to be one the line read.
 */
function rewrittenThroughTemporaryFile(segments: ShellSegment[]): ShellSegment | undefined {
  for (const [i, segment] of segments.entries()) {
    const [raw, ...args] = unwrapCommand(segment.tokens)
    if (!raw || !MOVES.has(commandName(raw).toLowerCase())) continue
    const operands = args.filter((arg) => arg !== '--' && !arg.startsWith('-'))
    if (operands.length !== 2) continue
    const [from, to] = operands as [string, string]
    const before = segments.slice(0, i)
    const writer = before.find(({ writes }) => writes.some((path) => samePath(path, from)))
    if (writer && before.some(({ tokens, reads }) => [...tokens.slice(1), ...reads].some((word) => samePath(word, to)))) return writer
  }
  return undefined
}

const samePath = (a: string, b: string): boolean => normalPath(a) === normalPath(b)
const normalPath = (path: string): string => path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')

/** gawk loads its in-place extension with `-i inplace` or `--include=inplace`; plain awk cannot edit in place. */
function awkInPlace(tokens: string[]): boolean {
  const [raw, ...args] = tokens
  if (!raw || !['awk', 'gawk'].includes(commandName(raw).toLowerCase())) return false
  return args.some((arg, i) => {
    const value = arg === '-i' || arg === '--include' ? args[i + 1] : /^(?:-i|--include=)(.*)$/.exec(arg)?.[1]
    return value?.startsWith('inplace') ?? false
  })
}

type SedCall = { inPlace: boolean; script: string | undefined; files: string[]; extended: boolean }

/** The script and files of a sed call; undefined for any other command. A script read from a file stays unknown. */
function sedCall(tokens: string[]): SedCall | undefined {
  const [raw, ...args] = tokens
  if (!raw || commandName(raw).toLowerCase() !== 'sed') return undefined
  const flags: SedFlags = { inPlace: false, extended: false, fromFile: false, scripts: [], operands: [] }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      flags.operands.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) i = longOption(arg, args, i, flags)
    else if (arg.length < 2 || !arg.startsWith('-')) flags.operands.push(arg)
    else i = shortFlags(arg, args, i, flags)
  }
  const { inPlace, extended, fromFile, scripts, operands } = flags
  if (scripts.length === 0 && !fromFile) scripts.push(operands.shift() ?? '')
  return { inPlace, script: fromFile ? undefined : scripts.join('\n'), files: operands, extended }
}

type SedFlags = { inPlace: boolean; extended: boolean; fromFile: boolean; scripts: string[]; operands: string[] }

/** One `--option` of a sed call; the index of the last word it used. */
function longOption(arg: string, args: string[], index: number, flags: SedFlags): number {
  let i = index
  if (arg.startsWith('--in-place')) flags.inPlace = true
  else if (arg === '--regexp-extended') flags.extended = true
  else if (arg === '--expression') flags.scripts.push(args[++i] ?? '')
  else if (arg.startsWith('--expression=')) flags.scripts.push(arg.slice('--expression='.length))
  else if (arg === '--file' || arg.startsWith('--file=')) flags.fromFile = true
  return i
}

/** A cluster of short flags, where `i` takes the rest of the word as a backup suffix; the index of the last word it used. */
function shortFlags(arg: string, args: string[], index: number, flags: SedFlags): number {
  for (let at = 1; at < arg.length; at++) {
    const letter = arg[at]!
    if (letter === 'i') {
      flags.inPlace = true
      break
    }
    if (letter === 'E' || letter === 'r') flags.extended = true
    if (letter === 'e' || letter === 'f') return scriptFlag(letter, arg, at, args, index, flags)
  }
  return index
}

/** `e` and `f` take the rest of the word or the next word. */
function scriptFlag(letter: 'e' | 'f', arg: string, at: number, args: string[], index: number, flags: SedFlags): number {
  let i = index
  const value = at + 1 < arg.length ? arg.slice(at + 1) : args[++i]
  if (letter === 'e') flags.scripts.push(value ?? '')
  else flags.fromFile = true
  return i
}

type Substitution = { pattern: string; caseInsensitive: boolean }

/** The pattern of a script that is one `s` command without an address; undefined for any other script. */
function parseSubstitution(script: string): Substitution | undefined {
  const text = script.trim()
  const delimiter = text[1]
  if (text[0] !== 's' || delimiter === undefined || delimiter === '\\' || delimiter === '\n') return undefined
  const parts: string[] = []
  let current = ''
  let at = 2
  for (; at < text.length && parts.length < 2; at++) {
    const character = text[at]!
    if (character === '\\' && text[at + 1] === delimiter) {
      current += delimiter === '/' ? '\\/' : delimiter
      at++
    } else if (character === '\\') {
      current += character + (text[at + 1] ?? '')
      at++
    } else if (character === delimiter) {
      parts.push(current)
      current = ''
    } else current += character
  }
  if (parts.length < 2) return undefined
  const flags = text.slice(at)
  if (!/^[gpiI0-9]*;?$/.test(flags)) return undefined
  return { pattern: parts[0]!, caseInsensitive: /[iI]/.test(flags) }
}

const BRE_OPERATORS = '(){}+?|'

const POSIX_CLASSES: Record<string, string> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t', xdigit: '0-9a-fA-F', punct: '!-\\/:-@\\[-`{-~',
}

/**
 * A sed regex as JavaScript reads it: a basic one escapes `( ) { } + ? |` to
 * make them operators and leaves them bare as text, the reverse of JavaScript.
 * Undefined when the result is not a regex JavaScript accepts.
 */
function jsPattern(pattern: string, extended: boolean): string | undefined {
  let out = ''
  for (let at = 0; at < pattern.length; at++) {
    const character = pattern[at]!
    if (character === '[') {
      const end = bracketEnd(pattern, at)
      if (end === undefined) return undefined
      out += pattern.slice(at, end).replace(/\[:(\w+):\]/g, (whole, name: string) => POSIX_CLASSES[name] ?? whole)
      at = end - 1
    } else if (character === '\\') out += escapedToJs(pattern[++at] ?? '', extended)
    else if (!extended && BRE_OPERATORS.includes(character)) out += `\\${character}`
    else out += character
  }
  try {
    new RegExp(out)
    return out
  } catch {
    return undefined
  }
}

/** The JavaScript for a backslash and the character after it. */
function escapedToJs(next: string, extended: boolean): string {
  if (next === '<' || next === '>') return '\\b'
  if (!extended && BRE_OPERATORS.includes(next)) return next
  return `\\${next}`
}

/** The index past a bracket expression's closing `]`, which may stand first in it as text. */
function bracketEnd(pattern: string, from: number): number | undefined {
  let at = from + 1
  if (pattern[at] === '^') at++
  if (pattern[at] === ']') at++
  for (; at < pattern.length; at++) {
    if (pattern[at] === '[' && pattern[at + 1] === ':') {
      const close = pattern.indexOf(':]', at + 2)
      if (close === -1) return undefined
      at = close + 1
    } else if (pattern[at] === ']') return at + 1
  }
  return undefined
}

/** Git Bash names `D:\src` as `/d/src`, which Node on Windows reads as a folder on the current drive. */
function drivePath(path: string): string {
  if (process.platform !== 'win32') return path
  const drive = /^\/([a-zA-Z])(?:\/|$)/.exec(path)
  return drive ? `${drive[1]}:/${path.slice(3)}` : path
}
