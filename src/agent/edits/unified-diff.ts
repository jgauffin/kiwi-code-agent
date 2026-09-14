/**
 * A line diff in unified form, with no dependency on the editor or the DOM:
 * the extension builds it from content it read itself, the webview only
 * renders what it is given.
 */

/** One line of the comparison, with where it sits on each side (0-based). */
type Op = { kind: 'equal' | 'del' | 'add'; aIndex: number; bIndex: number; text: string }

/**
 * Above this many cells the line-by-line table is not worth building; the
 * changed region is then reported as a whole-block replacement, which is what
 * a rewritten file looks like anyway.
 */
const MAX_CELLS = 4_000_000

export type DiffStats = { added: number; removed: number }

/** Text as lines, without the empty tail a trailing newline would produce. */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * The unified diff of `before` against `after`, `context` lines of context on
 * each side of a change. No file header: the step already says which file it
 * is, and the line budget is better spent on changed lines.
 */
export function unifiedDiff(before: string, after: string, context = 3): string[] {
  const ops = diffOps(splitLines(before), splitLines(after))
  const keep = ops.map(() => false)
  ops.forEach((op, i) => {
    if (op.kind === 'equal') return
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true
  })
  const lines: string[] = []
  for (let i = 0; i < ops.length; ) {
    if (!keep[i]) {
      i++
      continue
    }
    let end = i
    while (end < ops.length && keep[end]) end++
    const hunk = ops.slice(i, end)
    lines.push(hunkHeader(hunk))
    for (const op of hunk) lines.push(`${marker(op.kind)}${op.text}`)
    i = end
  }
  return lines
}

export function diffStats(before: string, after: string): DiffStats {
  let added = 0
  let removed = 0
  for (const op of diffOps(splitLines(before), splitLines(after))) {
    if (op.kind === 'add') added++
    if (op.kind === 'del') removed++
  }
  return { added, removed }
}

/**
 * Where the first change lands in the file as it now is, 1-based: where the
 * step's own line is, so opening the file puts the cursor on the change.
 */
export function firstChangedLine(before: string, after: string): number | undefined {
  const op = diffOps(splitLines(before), splitLines(after)).find((o) => o.kind !== 'equal')
  return op ? Math.max(1, op.bIndex + 1) : undefined
}

function marker(kind: Op['kind']): string {
  return kind === 'add' ? '+' : kind === 'del' ? '-' : ' '
}

function hunkHeader(hunk: Op[]): string {
  const a = hunk.filter((o) => o.kind !== 'add')
  const b = hunk.filter((o) => o.kind !== 'del')
  // A hunk that only adds has no line of its own on the left; it sits after
  // the lines before it, which is what a zero count says in unified form.
  const aStart = a.length > 0 ? a[0]!.aIndex + 1 : hunk[0]!.aIndex
  const bStart = b.length > 0 ? b[0]!.bIndex + 1 : hunk[0]!.bIndex
  return `@@ -${aStart},${a.length} +${bStart},${b.length} @@`
}

function diffOps(a: string[], b: string[]): Op[] {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const ops: Op[] = []
  for (let i = 0; i < prefix; i++) ops.push({ kind: 'equal', aIndex: i, bIndex: i, text: a[i]! })
  ops.push(...middleOps(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix), prefix))
  for (let i = 0; i < suffix; i++) {
    const aIndex = a.length - suffix + i
    ops.push({ kind: 'equal', aIndex, bIndex: b.length - suffix + i, text: a[aIndex]! })
  }
  return ops
}

/** The differing middle, by longest common subsequence; `offset` is where it starts on both sides. */
function middleOps(a: string[], b: string[], offset: number): Op[] {
  const dels = a.map((text, i) => ({ kind: 'del' as const, aIndex: offset + i, bIndex: offset, text }))
  const adds = b.map((text, i) => ({ kind: 'add' as const, aIndex: offset + a.length, bIndex: offset + i, text }))
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_CELLS) return [...dels, ...adds]

  const n = a.length
  const m = b.length
  const width = m + 1
  const lcs = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!)
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', aIndex: offset + i, bIndex: offset + j, text: a[i]! })
      i++
      j++
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      ops.push({ kind: 'del', aIndex: offset + i, bIndex: offset + j, text: a[i]! })
      i++
    } else {
      ops.push({ kind: 'add', aIndex: offset + i, bIndex: offset + j, text: b[j]! })
      j++
    }
  }
  while (i < n) {
    ops.push({ kind: 'del', aIndex: offset + i, bIndex: offset + j, text: a[i]! })
    i++
  }
  while (j < m) {
    ops.push({ kind: 'add', aIndex: offset + i, bIndex: offset + j, text: b[j]! })
    j++
  }
  return ops
}
