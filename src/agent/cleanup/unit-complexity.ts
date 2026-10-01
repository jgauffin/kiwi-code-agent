import type { Language } from '../code-structure/language'
import type { CodeItem } from '../code-structure/structure'

/**
 * SonarSource's cognitive complexity of a function, read off the block tree
 * of its body without parsing it. A branch or loop costs one plus how deeply
 * it is nested; `else`, a change of boolean operator, a labelled jump and
 * recursion cost one flat. Headers arrive with their literals blanked, so a
 * keyword or operator found in one is code.
 */
export function cognitiveComplexity(name: string, body: CodeItem[], family: Language['family']): number {
  const counter = new Counter(family)
  counter.walk(body, 0, false)
  return counter.total + (calls(body, name) ? 1 : 0)
}

/** A label before a loop or switch says nothing about it: `OUT: for`, `'outer: loop`. */
const LABEL = /^'?[A-Za-z_]\w*\s*:(?!:)\s*(?=(?:for|while|do|loop|switch)\b)/

/** A `case x:` label in a brace language: what follows it on the line is an ordinary statement. */
const CASE_LABEL = /^(?:case\b[^:]*?|default)\s*:(?!:)\s*/

/** A branch of a switch, match or when that is its own block or line: `case 1 ->`, `Some(x) =>`, Python's `case 1:`. */
const ARM = /^(?:case|default)\b|^else\s*->/

const ARROW_END = /(?:=>|->)$/

/** Blocks that hold code at the same nesting as the code around them. */
const FLAT_BLOCK = /^(?:try|finally|using|lock|fixed|checked|unchecked|unsafe|synchronized|with|namespace|static|get|set|init|default|async)\b|^return$|\bnew\b/

const FUNCTION_KEYWORD = /(?<![\w$.])(?:function|func|fn|fun|def|lambda)\b/

/** `x switch {` in C#, `= match x {` in Rust, `return when (x) {` in Kotlin: a switch used as a value. */
const SWITCH_EXPRESSION = /(?<![\w$.])switch\b|(?:=|\breturn)\s*(?:match|when)\b/

class Counter {
  total = 0

  constructor(private readonly family: Language['family']) {}

  walk(items: CodeItem[], nesting: number, inArms: boolean): void {
    let previous: CodeItem | undefined
    for (const item of items) {
      this.visit(item, nesting, inArms, previous)
      previous = item
    }
  }

  private visit(item: CodeItem, nesting: number, inArms: boolean, previous: CodeItem | undefined): void {
    const header = this.normalize(item.header)
    const block = item.kind === 'block'
    const opened = this.opening(header, block, nesting, inArms, previous)
    this.total += this.conditionals(opened.rest, nesting) + operatorRuns(header, this.family)
    if (block) this.walk(item.children, nesting + (opened.nests ? 1 : 0), opened.arms)
  }

  private normalize(raw: string): string {
    let header = raw.replace(/\s+/g, ' ').trim()
    if (this.family === 'python') header = header.replace(/:$/, '').trimEnd()
    else header = header.replace(CASE_LABEL, '')
    return header.replace(/^async\s+/, '').replace(LABEL, '')
  }

  /**
   * What the start of a header opens: the structure it costs, whether what it
   * holds sits one level deeper, and the part of it left to read as an
   * expression.
   */
  private opening(header: string, block: boolean, nesting: number, inArms: boolean, previous: CodeItem | undefined): Opening {
    const nested = (rest: string, arms = false): Opening => {
      this.total += 1 + nesting
      return { nests: true, arms, rest }
    }
    const after = (pattern: RegExp): string => header.replace(pattern, '')
    if (ARM.test(header) || (inArms && block && ARROW_END.test(header))) return { nests: false, arms: false, rest: header }
    if (/^(?:else\s+if|elif)\b/.test(header)) {
      this.total += 1
      return { nests: true, arms: false, rest: after(/^(?:else\s+if|elif)\b/) }
    }
    if (/^else\b/.test(header)) {
      this.total += 1
      return { nests: true, arms: false, rest: after(/^else\b/) }
    }
    if (/^(?:if\b|guard\s+(?!\())/.test(header)) return nested(after(/^\w+/))
    // The condition closing a `do { } while (x)` is the loop already counted.
    if (/^while\b/.test(header) && previous?.kind === 'block' && /^\s*(?:do|repeat)\s*$/.test(previous.header)) return { nests: false, arms: false, rest: after(/^while\b/) }
    // `loop`, `repeat` and `do` are names elsewhere; alone before a brace they are Rust's, Swift's and the C family's loops.
    if (/^(?:for|foreach|while)\b/.test(header) || (block && /^(?:loop|repeat|do)$/.test(header))) return nested(after(/^\w+/))
    if (/^catch\b/.test(header) || (this.family === 'python' && /^except\b/.test(header))) return nested(after(/^\w+/))
    if (block && (/^(?:switch|select|match|when)\b/.test(header) || SWITCH_EXPRESSION.test(header))) return nested(header.replace(SWITCH_EXPRESSION, ''), true)
    if (/^(?:(?:break|continue)\s+'?[A-Za-z_]\w*|goto\b.*)$/.test(header)) this.total += 1
    return { nests: block && functionLike(header), arms: false, rest: header }
  }

  /** `if` inside an expression (Kotlin, Python's `a if b else c`) and the `? :` ternary each cost one plus the nesting. */
  private conditionals(rest: string, nesting: number): number {
    const ifs = rest.match(/(?<![#\w$.])if\b/g)?.length ?? 0
    const ternaries = this.family === 'python' ? 0 : (rest.match(/(?<=\s)\?(?=\s)/g)?.length ?? 0)
    return (ifs + ternaries) * (1 + nesting)
  }
}

type Opening = { nests: boolean; arms: boolean; rest: string }

/** A lambda, a local function, a trailing closure: what it holds is one level deeper. */
function functionLike(header: string): boolean {
  if (header.length === 0) return false
  if (/(?:=>|->|\|)$/.test(header) || FUNCTION_KEYWORD.test(header)) return true
  if (FLAT_BLOCK.test(header)) return false
  return /[\w$)]$/.test(header)
}

/** One for each run of the same boolean operator: `a && b && c` is one, `a && b || c` two. */
function operatorRuns(header: string, family: Language['family']): number {
  const operators = family === 'python' ? /\b(?:and|or)\b/g : /&&|\|\|/g
  let runs = 0
  let last: string | undefined
  for (const m of header.matchAll(operators)) {
    // `||` opening a closure (`move || {`, `f(|| x)`) is an empty parameter list.
    if (m[0] === '||' && /(?:^|[(,=]|\bmove)\s*$/.test(header.slice(0, m.index))) continue
    if (m[0] !== last) runs++
    last = m[0]
  }
  return runs
}

/** Whether the body calls the function itself, bare or on `this`/`self`. */
function calls(body: CodeItem[], name: string): boolean {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return false
  const escaped = name.replace(/\$/g, '\\$')
  const call = new RegExp(`(?:(?<![\\w$.>])(?<!\\bnew\\s+)|\\b(?:this|self)\\.|\\$this->)${escaped}\\s*\\(`)
  const visit = (items: CodeItem[]): boolean => items.some((item) => call.test(item.header) || (item.kind === 'block' && visit(item.children)))
  return visit(body)
}
