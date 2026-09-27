/**
 * What marks a test, for every framework at once. No marker is chosen by
 * language: `[Fact]`, `#[test]`, `it(` and `TEST_CASE(` never mean anything
 * else in each other's languages, so one list read over every file is enough.
 *
 * Each matcher reads two views of the same header: `code`, where comments are
 * blank and string literals are `"` plus spaces, and `orig`, the header as
 * written. A marker is found in `code`, so text inside a string or a comment
 * never matches; a name is read from `orig` at the same columns.
 */

export type TestTag = 'param' | 'skip' | 'only' | 'todo'

/** A test or a group found in a header; `column` is where its call or name starts. */
export type Found = { kind: 'group' | 'test'; name: string; tags: TestTag[]; column: number }

const GROUP_CALLS = new Set(['describe', 'context', 'suite', 'group'])

/** Calls whose name may be an expression rather than a literal: `describe(Foo.name, …)`, `t.Run(tc.name, …)`. */
const DYNAMIC_CALLS = new Set(['describe', 'context', 'suite', 'it', 'test'])

const MODIFIER_TAGS: Record<string, TestTag> = { skip: 'skip', only: 'only', todo: 'todo', each: 'param', for: 'param' }

const CALL = /(?<![\w$.])(?:RSpec\.)?([xf]?)(describe|context|suite|it|test|specify|group|testWidgets|should)\b((?:\.[A-Za-z]+)*)/g
const CATCH = /(?<![\w$])(TEST_CASE|TEST_CASE_METHOD|TEMPLATE_TEST_CASE|SCENARIO|SECTION|SUBCASE|GIVEN|WHEN|THEN|AND_GIVEN|AND_WHEN|AND_THEN)\s*\(/g
const GTEST = /(?<![\w$])(TEST|TEST_F|TEST_P|TYPED_TEST|TYPED_TEST_P)\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)/g
const SUBTEST = /(?<![\w$])[A-Za-z_]\w*\.Run\s*\(/g
const STRING_HEADER = /^\s*(?:(?:-|in|should|when|must|can|which)\s*)?\{/
const DO_BLOCK = /\bdo\s*(?:\|[^|]*\|)?\s*$/

/** Named calls, macros and string headers on the line from `from` on, in column order. */
export function callsIn(code: string, orig: string, from: number): Found[] {
  const found = [...namedCalls(code, orig, from), ...catchMacros(code, orig, from), ...googleTests(code, from), ...subtests(code, orig, from)]
  const header = stringHeader(code, orig, from)
  if (header) found.push(header)
  return found.sort((a, b) => a.column - b.column)
}

function namedCalls(code: string, orig: string, from: number): Found[] {
  const found: Found[] = []
  for (const m of matchesFrom(CALL, code, from)) {
    const [whole, prefix, call, chain] = m as unknown as [string, string, string, string]
    const modifiers = chain.split('.').filter((s) => s.length > 0)
    const tags: TestTag[] = []
    if (prefix === 'x') tags.push('skip')
    if (prefix === 'f') tags.push('only')
    for (const modifier of modifiers) {
      const tag = MODIFIER_TAGS[modifier]
      if (tag && !tags.includes(tag)) tags.push(tag)
    }
    const kind = GROUP_CALLS.has(call) ? 'group' : 'test'
    let at = m.index + whole.length
    // `.each(table)` and `.each\`table\`` come before the call that names the test.
    if (modifiers.includes('each') || modifiers.includes('for')) {
      at = skipSpaces(code, at)
      if (code[at] === '(') at = closing(code, at) + 1
      else if (code[at] === '"') at = code.indexOf('"', at + 1) + 1
      if (at <= 0) continue
    }
    at = skipSpaces(code, at)
    if (code[at] === '(') {
      const name = argumentName(code, orig, at, DYNAMIC_CALLS.has(call))
      if (!name) continue
      // One argument is a call, not a test, unless a trailing block follows or the test is only announced.
      if (!name.more && !tags.includes('todo') && code[skipSpaces(code, closing(code, at) + 1)] !== '{') continue
      found.push({ kind, name: name.text, tags, column: at })
      continue
    }
    // `describe "total" do` and `describe Cart do`: Ruby and Elixir, the block opened by `do`.
    if (at === m.index + whole.length || !DO_BLOCK.test(code)) continue
    const literal = code[at] === '"' ? literalAt(code, orig, at) : /^[A-Z][\w:]*/.exec(code.slice(at))?.[0]
    if (literal) found.push({ kind, name: literal, tags, column: m.index })
  }
  return found
}

function catchMacros(code: string, orig: string, from: number): Found[] {
  const found: Found[] = []
  for (const m of matchesFrom(CATCH, code, from)) {
    const paren = m.index + m[0].length - 1
    const quote = code.indexOf('"', paren)
    const end = closing(code, paren)
    if (quote < 0 || (end >= 0 && quote > end)) continue
    const name = literalAt(code, orig, quote)
    if (name === undefined) continue
    found.push({ kind: 'test', name, tags: m[1] === 'TEMPLATE_TEST_CASE' ? ['param'] : [], column: paren })
  }
  return found
}

function googleTests(code: string, from: number): Found[] {
  return matchesFrom(GTEST, code, from).map((m) => ({
    kind: 'test' as const,
    name: `${m[2]}.${m[3]}`,
    tags: m[1]!.endsWith('_P') || m[1]!.startsWith('TYPED') ? ['param' as const] : [],
    column: m.index + m[0].indexOf('('),
  }))
}

function subtests(code: string, orig: string, from: number): Found[] {
  const found: Found[] = []
  for (const m of matchesFrom(SUBTEST, code, from)) {
    const paren = m.index + m[0].length - 1
    const name = argumentName(code, orig, paren, true)
    if (name?.more) found.push({ kind: 'test', name: name.text, tags: [], column: paren })
  }
  return found
}

/** Kotest and friends: a line that starts with a string and opens a block, `"adds lines" {`. */
function stringHeader(code: string, orig: string, from: number): Found | undefined {
  if (code.slice(0, from).trim().length > 0) return undefined
  const open = code.search(/\S/)
  if (open < 0 || code[open] !== '"') return undefined
  const close = code.indexOf('"', open + 1)
  if (close < 0 || !STRING_HEADER.test(code.slice(close + 1))) return undefined
  return { kind: 'test', name: orig.slice(open + 1, close), tags: [], column: close + 1 }
}

type Argument = { text: string; more: boolean }

/** The first argument of the call whose `(` is at `paren`: a literal's text, or, where allowed, the expression it is. */
function argumentName(code: string, orig: string, paren: number, dynamic: boolean): Argument | undefined {
  const start = skipSpaces(code, paren + 1)
  const end = argumentEnd(code, start)
  const more = code[end] === ','
  if (code[start] === '"') {
    const text = literalAt(code, orig, start)
    return text === undefined ? undefined : { text, more }
  }
  if (!dynamic || !more) return undefined
  const expression = code.slice(start, end).trim()
  return expression ? { text: `(dynamic: ${expression})`, more } : undefined
}

/** The literal opening at `quote` in `code`, read from `orig`; to the end of the line when it does not close on it. */
function literalAt(code: string, orig: string, quote: number): string | undefined {
  const close = code.indexOf('"', quote + 1)
  const text = orig.slice(quote + 1, close < 0 ? undefined : close).trim()
  return text.length > 0 ? text : undefined
}

/** The `,` or `)` that ends the argument starting at `start`, or the line's end. */
function argumentEnd(code: string, start: number): number {
  let depth = 0
  for (let i = start; i < code.length; i++) {
    const ch = code[i]!
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) {
      if (depth === 0) return i
      depth--
    } else if (ch === ',' && depth === 0) return i
  }
  return code.length
}

/** The bracket closing the one at `open`, or -1 when it does not close on the line. */
function closing(code: string, open: number): number {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if ('([{'.includes(code[i]!)) depth++
    else if (')]}'.includes(code[i]!) && --depth === 0) return i
  }
  return -1
}

const skipSpaces = (code: string, at: number): number => {
  while (at < code.length && /\s/.test(code[at]!)) at++
  return at
}

function matchesFrom(pattern: RegExp, code: string, from: number): RegExpExecArray[] {
  pattern.lastIndex = from
  const found: RegExpExecArray[] = []
  for (let m = pattern.exec(code); m; m = pattern.exec(code)) found.push(m)
  return found
}

/** What the attributes and decorators ahead of a declaration say about it. */
export type Marks = { test: boolean; tags: TestTag[]; name?: string }

const TEST_MARKS = new Set([
  'Fact', 'Theory', 'Test', 'TestCase', 'TestCaseSource', 'TestMethod', 'DataTestMethod', 'SkippableFact', 'SkippableTheory',
  'ParameterizedTest', 'RepeatedTest', 'TestFactory', 'TestTemplate', 'test', 'rstest',
])
const PARAM_MARKS = new Set([
  'Theory', 'SkippableTheory', 'TestCase', 'TestCaseSource', 'DataTestMethod', 'DataRow', 'InlineData', 'MemberData', 'ClassData',
  'ParameterizedTest', 'RepeatedTest', 'TestFactory', 'TestTemplate', 'parametrize', 'DataProvider', 'TestWith', 'case',
])
const SKIP_MARKS = new Set(['Ignore', 'Disabled', 'ignore', 'skip', 'skipif', 'Explicit'])
/** Marks whose string argument is the name a reader sees: `@DisplayName("…")`, Swift's `@Test("…")` and `@Suite("…")`. */
const NAME_MARKS = new Set(['DisplayName', 'Test', 'Suite'])

/** Where an attribute or decorator starts at `at`: `[…]`, `#[…]` or `@name(…)`. */
export function markStartsAt(code: string, orig: string, at: number): boolean {
  if (orig.startsWith('#[', at)) return true
  if (code[at] === '[') return true
  return code[at] === '@' && /[A-Za-z_]/.test(code[at + 1] ?? '')
}

/**
 * The end of the attribute or decorator starting at `at`, just past it, or
 * -1 when its brackets do not close. `#[…]` is measured on `orig`: a
 * language with `#` comments has blanked it in `code`.
 */
export function markEnd(code: string, orig: string, at: number): number {
  const text = orig.startsWith('#[', at) ? orig : code
  let depth = 0
  let i = at
  if (text[i] === '@') {
    i++
    while (i < text.length && /[\w.]/.test(text[i]!)) i++
    if (text[skipSpaces(text, i)] !== '(') return i
    i = skipSpaces(text, i)
  }
  for (; i < text.length; i++) {
    if ('([{'.includes(text[i]!)) depth++
    else if (')]}'.includes(text[i]!) && --depth === 0) return i + 1
  }
  return -1
}

/** What one attribute or decorator, as written (`orig`) and stripped (`code`), marks. */
export function marksOf(code: string, orig: string, into: Marks): void {
  const text = orig.trimStart().startsWith('#[') ? orig : code
  const inner = text.trim().replace(/^#?\[/, '').replace(/\]$/, '')
  for (const item of topLevelItems(inner)) {
    const path = /^\s*@?([A-Za-z_][\w.:]*)/.exec(item)?.[1]
    if (!path) continue
    const head = path.split(/\.|::/).pop()!.replace(/Attribute$/, '')
    if (TEST_MARKS.has(head)) into.test = true
    if (PARAM_MARKS.has(head) && !into.tags.includes('param')) into.tags.push('param')
    if ((SKIP_MARKS.has(head) || /\bSkip\s*=/.test(item)) && !into.tags.includes('skip')) into.tags.push('skip')
    if (NAME_MARKS.has(head)) {
      const quote = /["'](.*?)["']/.exec(orig.slice(orig.indexOf(head)))
      if (quote?.[1]) into.name = quote[1]
    }
  }
}

function topLevelItems(text: string): string[] {
  const items: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (ch === ',' && depth === 0) {
      items.push(text.slice(start, i))
      start = i + 1
    }
  }
  items.push(text.slice(start))
  return items
}

/** A declaration the marks attach to: a class-like container, or a function. */
export type Declaration = { kind: 'container' | 'function'; name: string; column: number; convention: boolean }

const CONTAINER = /(?<![\w$.])(?:class|struct|record|object|mod)\s+([A-Za-z_$][\w$]*)/
const KEYWORD_FUNCTION = /(?<![\w$.])(?:def|func|fn|fun|function|sub)\s+(?:\([^)]*\)\s*)?(`[^`]+`|[A-Za-z_$][\w$]*)\s*(?:<[^<>]*>\s*)?\(/
const TYPED_FUNCTION = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:<[^<>]*>\s*)?\(/g
const NOT_A_NAME = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'return', 'new', 'await', 'typeof', 'sizeof', 'nameof', 'using', 'lock', 'throw', 'yield'])

/** `test_x`, `testX`, `TestX`: the naming conventions of pytest, PHPUnit, XCTest, JUnit 3 and Go. */
const TEST_NAME = /^(?:test_|test[A-Z0-9]|Test[A-Z0-9_])/

/** The declaration on the line from `from` on, if any. A typed function (`public void X()`) counts only when something marked it. */
export function declarationIn(code: string, from: number, marked: boolean): Declaration | undefined {
  const rest = code.slice(from)
  const container = CONTAINER.exec(rest)
  if (container) return { kind: 'container', name: container[1]!, column: from + container.index, convention: false }
  const keyword = KEYWORD_FUNCTION.exec(rest)
  if (keyword) {
    const name = keyword[1]!.replace(/^`|`$/g, '')
    return { kind: 'function', name, column: from + keyword.index, convention: TEST_NAME.test(name) }
  }
  TYPED_FUNCTION.lastIndex = 0
  for (let m = TYPED_FUNCTION.exec(rest); m; m = TYPED_FUNCTION.exec(rest)) {
    const name = m[1]!
    if (NOT_A_NAME.has(name)) continue
    // A declaration has a type or a modifier ahead of its name; a call at the start of a statement does not.
    const before = rest.slice(0, m.index).trim()
    if (!/[\w>\]?]$/.test(before)) return undefined
    const convention = /\bvoid$/.test(before) && TEST_NAME.test(name)
    if (!marked && !convention) return undefined
    return { kind: 'function', name, column: from + m.index, convention }
  }
  return undefined
}
