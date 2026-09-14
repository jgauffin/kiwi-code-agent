import { basename } from 'node:path'
import { languageOf } from './language'
import { stripLiterals } from './strip-literals'

export type UnitKind = 'function' | 'type' | 'file'

/** One measurable thing in a file: the file itself, a function, or a type. `lines` counts code lines only. */
export type Unit = { kind: UnitKind; name: string; line: number; lines: number }

/**
 * The units of a source file and their sizes, found without a parser: braces
 * after literals are stripped, or indentation for Python. Precise enough to
 * decide whether a file deserves a cleanup pass, no more. Nested functions
 * count toward the function they sit in. A language not known here yields
 * the file unit alone.
 */
export function measureUnits(path: string, text: string): Unit[] {
  const lang = languageOf(path)
  const file = { kind: 'file' as const, name: basename(path), line: 1 }
  if (!lang) return [{ ...file, lines: countCode(text.split(/\r?\n/)) }]
  const lines = stripLiterals(text, lang).split(/\r?\n/)
  const units = lang.family === 'python' ? pythonUnits(lines) : braceUnits(lines)
  units.sort((a, b) => a.line - b.line)
  return [{ ...file, lines: countCode(lines) }, ...units]
}

const isBlank = (line: string): boolean => line.trim().length === 0

function countCode(lines: string[]): number {
  return lines.filter((l) => !isBlank(l)).length
}

/** Code lines between two 1-based line numbers, inclusive, from prefix sums. */
class CodeLines {
  private readonly sums: number[]
  constructor(lines: string[]) {
    this.sums = [0]
    for (const line of lines) this.sums.push(this.sums[this.sums.length - 1]! + (isBlank(line) ? 0 : 1))
  }
  between(from: number, to: number): number {
    return this.sums[Math.min(to, this.sums.length - 1)]! - this.sums[Math.max(from - 1, 0)]!
  }
}

type Open = { kind: 'function' | 'type'; name: string; line: number }

/** A block's place on the stack: a unit, a nameless block, or a brace that belongs to the header being read. */
type Block = { unit?: Open; inHeader?: boolean }

/** A header this long is not a header: a bracket the stripper did not see is being chased. */
const MAX_HEADER = 4000

/**
 * Without semicolons a statement ends at the line break, unless the line
 * leaves something open: an operator, a comma, a clause keyword.
 */
const LINE_CONTINUES = /(?:[,(\[=:&|+\-*/<>?.!~^%]|\bwhere|\bextends|\bimplements|\bthrows)$/

/** Or the next line picks the statement up: a clause, an operator, the brace itself on its own line. */
const LINE_RESUMES = /^(?:\{|where\b|extends\b|implements\b|throws\b|[:.?,)]|&&|\|\||=>|->)/

function braceUnits(lines: string[]): Unit[] {
  const code = new CodeLines(lines)
  const units: Unit[] = []
  const stack: Block[] = []
  let header = ''
  let headerLine = 0
  let parens = 0
  let lineBreak = false
  const reset = (): void => {
    header = ''
    headerLine = 0
    parens = 0
    lineBreak = false
  }
  const close = (block: Block, line: number): void => {
    if (block.unit) units.push({ ...block.unit, lines: code.between(block.unit.line, line) })
  }
  const functionOpen = (): boolean => stack.some((b) => b.unit?.kind === 'function')

  for (let n = 1; n <= lines.length; n++) {
    const line = lines[n - 1]!
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (lineBreak && ch.trim().length > 0) {
        if (!LINE_RESUMES.test(line.slice(i))) reset()
        lineBreak = false
      }
      if (ch === '{') {
        // A brace inside unclosed parentheses that follows an opener is a pattern or a literal, part of the header:
        // `({ a }: Props) =>`, `foo(x, {`. One that follows `=>` or `)` opens the body.
        if (parens > 0 && /[(,=:|&<?![]\s*$/.test(header)) {
          stack.push({ inHeader: true })
          header += ch
          continue
        }
        const classified = classify(header)
        const opens = classified && !functionOpen() ? classified : undefined
        stack.push(opens ? { unit: { ...opens, line: (headerLine || n) + opens.line } } : {})
        reset()
        continue
      }
      if (ch === '}') {
        const block = stack.pop()
        if (block?.inHeader) {
          header += ch
          continue
        }
        if (block) close(block, n)
        reset()
        continue
      }
      if (ch === '(') parens++
      if (ch === ')') parens = Math.max(0, parens - 1)
      if (ch === ';') {
        // A `for` header carries its own semicolons; anywhere else one ends the statement.
        if (parens === 0 || !/^\s*for\b/.test(header)) {
          reset()
          continue
        }
      }
      if (header.length === 0 && ch.trim().length === 0) continue
      if (header.length === 0) headerLine = n
      header += ch
      if (header.length > MAX_HEADER) reset()
    }
    if (header.length > 0) {
      lineBreak = parens === 0 && !LINE_CONTINUES.test(header.trimEnd())
      header += '\n'
    }
  }
  while (stack.length > 0) close(stack.pop()!, lines.length)
  return units
}

/** Words that open a block which is never a unit, when they start the header. */
const CONTROL = new Set([
  'if', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'match', 'when', 'try', 'catch', 'finally',
  'using', 'lock', 'fixed', 'checked', 'unchecked', 'synchronized', 'guard', 'defer', 'go', 'select', 'loop',
  'unsafe', 'repeat', 'return', 'case', 'namespace', 'module', 'declare', 'mod', 'elseif', 'with', 'extern',
])

/** Words that open a block which is never a unit, when they are the whole header: `get {`, `static {`, `init {`. */
const CONTROL_ALONE = new Set(['get', 'set', 'add', 'remove', 'init', 'deinit', 'static', 'willSet', 'didSet', 'async', 'move', 'default'])

const TYPE_KEYWORDS = new Set(['class', 'struct', 'interface', 'record', 'enum', 'impl', 'trait', 'object', 'union', 'protocol', 'extension'])

/** Type keywords that never take a parameter list: with parentheses around, `struct foo *bar(void)` is a function. */
const PARAMETERLESS_TYPES = new Set(['struct', 'enum', 'union', 'impl', 'trait', 'extension', 'protocol'])

/** Not a name when followed by `(`: keywords that introduce a function, or take an argument. */
const NOT_A_NAME = new Set([
  'function', 'func', 'fn', 'fun', 'def', 'sub', 'pub', 'return', 'typeof', 'nameof', 'sizeof', 'decltype', 'await',
  'yield', 'throw', 'delete', 'if', 'while', 'for', 'switch', 'catch', 'foreach', 'using', 'lock', 'synchronized',
  'when', 'match', 'elseif', 'operator', 'default',
])

/** Keywords that introduce a function without naming it: the name, if any, is the variable it is assigned to. */
const ANONYMOUS = new Set(['function', 'func', 'fn', 'fun'])

const IDENT = '[A-Za-z_$][\\w$]*'

/** A type's name may be qualified: `impl fmt::Display for X`. */
const TYPE_NAME = `${IDENT}(?:(?:::|\\.)${IDENT})*`

/**
 * What the brace after this header opens. `line` is how many lines of
 * annotations precede the declaration itself, for the unit's line number.
 */
function classify(raw: string): Open | undefined {
  const declaration = stripAnnotations(raw)
  const skipped = raw.slice(0, raw.length - declaration.length).split('\n').length - 1
  // A `where` clause (Rust, C#) says nothing about the unit and may end in a comma.
  const header = declaration.replace(/\s+/g, ' ').trim().replace(/ where .*$/, '')
  if (header.length === 0) return undefined
  const first = new RegExp(`^${IDENT}`).exec(header)?.[0]
  if (first && (CONTROL.has(first) || (CONTROL_ALONE.has(first) && first === header))) return undefined
  const alias = /^(?:export )?(?:declare )?type ([A-Za-z_$][\w$]*)(?:<[^>]*>)? =$/.exec(header)
  if (alias) return { kind: 'type', name: alias[1]!, line: skipped }
  // An initializer, an argument, a property: the brace starts a literal, not a body.
  if (/[=:,([?|&!]$/.test(header)) return undefined
  const unit = typeOf(header) ?? functionOf(header)
  return unit ? { ...unit, line: skipped } : undefined
}

/** Attributes and decorators say nothing about what follows: `[Fact]`, `#[test]`, `@Override`, `@Route("/x")`. */
function stripAnnotations(header: string): string {
  let text = header
  for (;;) {
    const next = text.replace(/^(?:\[[^\]]*\]|#\[[^\]]*\]|@(?!interface\b)[\w.]+(?:\([^()]*\))?)\s*/, '')
    if (next === text) return text
    text = next
  }
}

function typeOf(header: string): Open | undefined {
  const tokens = removeAngles(header.replace(/ where .*$/, '')).split(' ')
  const hasParens = tokens.some((t) => t.includes('('))
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (!TYPE_KEYWORDS.has(token) || tokens[i - 1] === 'new') continue
    if (hasParens && PARAMETERLESS_TYPES.has(token)) return undefined
    if (hasParens && tokens.slice(0, i).some((t) => t.includes('('))) continue
    const next = tokens[i + 1]
    if (next && TYPE_KEYWORDS.has(next)) continue
    const name = next ? new RegExp(`^${TYPE_NAME}`).exec(next)?.[0] : undefined
    if (name && !['extends', 'implements', 'for', 'where'].includes(name)) return { kind: 'type', name, line: 0 }
    // Go names the type before the keyword: `type Foo struct {`.
    const before = tokens[i - 1]
    if (before && tokens[i - 2] === 'type' && new RegExp(`^${IDENT}$`).test(before)) return { kind: 'type', name: before, line: 0 }
    return { kind: 'type', name: '(anonymous)', line: 0 }
  }
  return undefined
}

function functionOf(header: string): Open | undefined {
  const text = removeAngles(header.replace(/ where .*$/, ''))
  if (!balanced(text)) return undefined
  const arrow = /\s*(?:=>|->)$/.exec(text)
  if (arrow) return { kind: 'function', name: assignedName(text.slice(0, arrow.index)) ?? '(anonymous)', line: 0 }
  const calls = new RegExp(`(${IDENT})\\s*\\(`, 'g')
  let anonymous = false
  for (let m = calls.exec(text); m; m = calls.exec(text)) {
    if (depthAt(text, m.index) !== 0) continue
    const name = m[1]!
    if (ANONYMOUS.has(name)) {
      anonymous = true
      continue
    }
    if (NOT_A_NAME.has(name)) continue
    if (/\bnew\s*$/.test(text.slice(0, m.index))) return undefined
    return { kind: 'function', name, line: 0 }
  }
  if (anonymous) return { kind: 'function', name: assignedName(text) ?? '(anonymous)', line: 0 }
  return undefined
}

/** `const foo = …`, `foo: …`, `x := …`: the first name the value is bound to. */
function assignedName(text: string): string | undefined {
  const m = new RegExp(`(${IDENT})\\s*(?::=|=(?!=)|:(?!:))`).exec(text)
  return m?.[1]
}

function balanced(text: string): boolean {
  let depth = 0
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')' && --depth < 0) return false
  }
  return depth === 0
}

function depthAt(text: string, index: number): number {
  let depth = 0
  for (let i = 0; i < index; i++) {
    if (text[i] === '(') depth++
    if (text[i] === ')') depth--
  }
  return depth
}

/** Generic arguments, innermost first, so `Map<string, () => void>` does not pass for a call or an arrow. */
function removeAngles(text: string): string {
  let current = text
  for (let i = 0; i < 20; i++) {
    const next = current.replace(/<[^<>]*>/g, '')
    if (next === current) return current
    current = next
  }
  return current
}

type PythonOpen = Open & { indent: number }

function pythonUnits(lines: string[]): Unit[] {
  const code = new CodeLines(lines)
  const units: Unit[] = []
  const open: PythonOpen[] = []
  let depth = 0
  let lastCode = 0
  const close = (unit: PythonOpen): void => {
    units.push({ kind: unit.kind, name: unit.name, line: unit.line, lines: code.between(unit.line, lastCode) })
  }
  for (let n = 1; n <= lines.length; n++) {
    const text = lines[n - 1]!
    const blank = isBlank(text)
    // A line inside brackets continues the statement above; it can neither end nor start a unit.
    if (!blank && depth === 0) {
      const indent = text.length - text.trimStart().length
      while (open.length > 0 && indent <= open[open.length - 1]!.indent) close(open.pop()!)
      const m = /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(text)
      if (m && !open.some((u) => u.kind === 'function')) {
        open.push({ kind: m[1] === 'def' ? 'function' : 'type', name: m[2]!, line: n, indent })
      }
    }
    if (!blank) lastCode = n
    for (const ch of text) {
      if ('([{'.includes(ch)) depth++
      if (')]}'.includes(ch)) depth = Math.max(0, depth - 1)
    }
  }
  while (open.length > 0) close(open.pop()!)
  return units
}
