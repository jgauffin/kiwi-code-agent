import { readStructure, type CodeItem } from '../code-structure/structure'
import { callsIn, declarationIn, markEnd, marksOf, markStartsAt, type Marks, type TestTag } from './markers'

export type { TestTag }

/**
 * One entry of a file's test tree. A `group` is a named call (`describe`), a
 * `container` a class or module holding tests, a `test` a test; a test with
 * subtests (`t.Run`, `SECTION`) keeps them as children.
 */
export type TestNode = { kind: 'group' | 'container' | 'test'; name: string; line: number; tags: TestTag[]; children: TestNode[] }

/**
 * The tests of a source file, read off its structure: each header is read
 * for what `markers.ts` knows marks a test, and the last test or group a
 * header names owns its block. A class with no test inside is left out.
 */
export function outlineTests(path: string, text: string): TestNode[] {
  const { items, code } = readStructure(path, text)
  const reader = new TestReader(code, text.split(/\r?\n/))
  const roots: TestNode[] = []
  reader.visit(items, roots)
  return prune(roots)
}

/** Tests a reader would count: a test with subtests counts as its subtests. */
export function countTests(nodes: TestNode[]): number {
  let count = 0
  for (const node of nodes) {
    const inner = countTests(node.children)
    count += node.kind === 'test' && inner === 0 ? 1 : inner
  }
  return count
}

function prune(nodes: TestNode[]): TestNode[] {
  const kept: TestNode[] = []
  for (const node of nodes) {
    node.children = prune(node.children)
    if (node.kind !== 'container' || countTests(node.children) > 0) kept.push(node)
  }
  return kept
}

/** Before a `{` these make it a literal (an object, an initializer), never a body. */
const LITERAL_BEFORE = /[,=:[?|&!]$/

class TestReader {
  /** Attributes and decorators read so far, waiting for the declaration they mark. */
  private marks: Marks | undefined
  private readonly hashMarksRead = new Set<number>()

  constructor(
    private readonly code: string[],
    private readonly orig: string[],
  ) {}

  visit(items: CodeItem[], into: TestNode[]): void {
    for (const item of items) {
      this.readHashMarks(item.line)
      const owner = this.read(item, into)
      if (item.kind === 'block') this.visit(item.children, owner ? owner.children : into)
    }
  }

  /** Adds the tests and groups the item's header names to `into`; returns the one whose body the block is. */
  private read(item: CodeItem, into: TestNode[]): TestNode | undefined {
    // A trailing block is part of how a call is recognised: `test("x") {`, `"adds lines" {`.
    const brace = item.kind === 'block' && item.delimiter === 'brace'
    const code = brace ? `${item.header} {` : item.header
    const orig = brace ? `${item.origHeader} {` : item.origHeader
    const from = this.readMarks(code, orig)
    if (code.slice(from).trim().length === 0) return undefined

    const lineAt = (column: number): number => item.line + (orig.slice(0, column).match(/\n/g)?.length ?? 0)
    const found = callsIn(code, orig, from).map((f) => ({
      column: f.column,
      node: { kind: f.kind, name: f.name, line: lineAt(f.column), tags: f.tags, children: [] } as TestNode,
    }))
    const declared = declarationIn(code, from, this.marks?.test ?? false)
    if (declared && (declared.kind === 'container' || this.marks?.test || declared.convention)) {
      found.push({
        column: declared.column,
        node: {
          kind: declared.kind === 'container' ? 'container' : 'test',
          name: this.marks?.name ?? declared.name,
          line: lineAt(declared.column),
          tags: this.marks?.tags ?? [],
          children: [],
        },
      })
      found.sort((a, b) => a.column - b.column)
    }
    this.marks = undefined

    for (const f of found) into.push(f.node)
    const last = found[found.length - 1]?.node
    if (!last || item.kind !== 'block' || (brace && LITERAL_BEFORE.test(item.header.trimEnd()))) return undefined
    return last
  }

  /** Reads the attributes and decorators opening the header; the column after them. */
  private readMarks(code: string, orig: string): number {
    let at = 0
    for (;;) {
      while (at < code.length && /\s/.test(code[at]!)) at++
      if (at >= code.length || !markStartsAt(code, orig, at)) return at
      const end = markEnd(code, orig, at)
      if (end < 0) return at
      this.marks ??= { test: false, tags: [] }
      marksOf(code.slice(at, end), orig.slice(at, end), this.marks)
      at = end
    }
  }

  /** `#[Test]` in a language with `#` comments is blanked out of the structure: read from the lines above as written. */
  private readHashMarks(line: number): void {
    if (this.hashMarksRead.has(line)) return
    this.hashMarksRead.add(line)
    const marks: string[] = []
    for (let n = line - 1; n >= 1 && (this.code[n - 1] ?? '').trim().length === 0; n--) {
      const text = (this.orig[n - 1] ?? '').trim()
      if (!text.startsWith('#[')) break
      marks.unshift(text)
    }
    for (const text of marks) {
      this.marks ??= { test: false, tags: [] }
      marksOf(text, text, this.marks)
    }
  }
}
