import type { Language } from './language'
import { readStructure, type CodeItem, type Doc } from './structure'

/**
 * The types and functions of a source file, read off its structure: a
 * block's header is classified, and nothing is looked for inside a function,
 * so a closure counts toward the function it sits in. Precise enough to point
 * at the right lines, no more.
 */
export type Declaration = { kind: 'function' | 'type'; name: string; line: number; endLine: number; doc?: Doc; children: Declaration[] }

/** `bodies` holds what each function's block contains, for readers that measure it; kept apart so a declaration stays plain data. */
export type FileDeclarations = { declarations: Declaration[]; code: string[]; family: Language['family']; bodies: Map<Declaration, CodeItem[]> }

export function readDeclarations(path: string, text: string): FileDeclarations {
  const structure = readStructure(path, text)
  const bodies = new Map<Declaration, CodeItem[]>()
  const declarations = structure.family === 'python' ? pythonDeclarations(structure.items, bodies) : braceDeclarations(structure.items, bodies)
  return { declarations, code: structure.code, family: structure.family, bodies }
}

type Bodies = Map<Declaration, CodeItem[]>

function braceDeclarations(items: CodeItem[], bodies: Bodies): Declaration[] {
  const found: Declaration[] = []
  for (const item of items) {
    if (item.kind !== 'block') continue
    const open = classify(item.header)
    if (!open) {
      found.push(...braceDeclarations(item.children, bodies))
      continue
    }
    const children = open.kind === 'type' ? braceDeclarations(item.children, bodies) : []
    found.push(declaration(open.kind, open.name, item.line + open.line, item, children, bodies))
  }
  return found
}

const PYTHON_DECLARATION = /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/

/** A one-line `def f(): return 1` is a statement, and still a function. */
function pythonDeclarations(items: CodeItem[], bodies: Bodies): Declaration[] {
  const found: Declaration[] = []
  for (const item of items) {
    const m = PYTHON_DECLARATION.exec(item.header)
    const children = item.kind === 'block' ? item.children : []
    if (!m) {
      found.push(...pythonDeclarations(children, bodies))
      continue
    }
    const kind = m[1] === 'def' ? 'function' : 'type'
    found.push(declaration(kind, m[2]!, item.line, item, kind === 'type' ? pythonDeclarations(children, bodies) : [], bodies))
  }
  return found
}

function declaration(kind: Declaration['kind'], name: string, line: number, item: CodeItem, children: Declaration[], bodies: Bodies): Declaration {
  const found: Declaration = { kind, name, line, endLine: item.endLine, ...(item.doc ? { doc: item.doc } : {}), children }
  if (kind === 'function') bodies.set(found, item.kind === 'block' ? item.children : [])
  return found
}

type Open = { kind: 'function' | 'type'; name: string; line: number }

/** Words that open a block which is never a declaration, when they start the header. */
const CONTROL = new Set([
  'if', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'match', 'when', 'try', 'catch', 'finally',
  'using', 'lock', 'fixed', 'checked', 'unchecked', 'synchronized', 'guard', 'defer', 'go', 'select', 'loop',
  'unsafe', 'repeat', 'return', 'case', 'namespace', 'module', 'declare', 'mod', 'elseif', 'with', 'extern',
])

/** Words that open a block which is never a declaration, when they are the whole header: `get {`, `static {`, `init {`. */
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
 * annotations precede the declaration itself, for its line number.
 */
function classify(raw: string): Open | undefined {
  const declaration = stripAnnotations(raw)
  const skipped = raw.slice(0, raw.length - declaration.length).split('\n').length - 1
  // A `where` clause (Rust, C#) says nothing about the declaration and may end in a comma.
  const header = declaration.replace(/\s+/g, ' ').trim().replace(/ where .*$/, '')
  if (header.length === 0) return undefined
  const first = new RegExp(`^${IDENT}`).exec(header)?.[0]
  if (first && (CONTROL.has(first) || (CONTROL_ALONE.has(first) && first === header))) return undefined
  const alias = /^(?:export )?(?:declare )?type ([A-Za-z_$][\w$]*)(?:<[^>]*>)? =$/.exec(header)
  if (alias) return { kind: 'type', name: alias[1]!, line: skipped }
  // An initializer, an argument, a property: the brace starts a literal, not a body.
  if (/[=:,([?|&!]$/.test(header)) return undefined
  const found = typeOf(header) ?? functionOf(header)
  return found ? { ...found, line: skipped } : undefined
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
