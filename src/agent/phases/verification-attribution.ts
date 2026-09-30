import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { readStructure, type CodeBlock, type CodeItem } from '../code-structure/structure'
import { describeHand, type FileHands } from '../session/file-hands'
import type { VerificationFailure } from './verification'

/**
 * Whether a failing test is this feature's own doing or another hand's: the
 * files a run's output names, and whether the content that failed there is
 * this feature's own or was changed since, `runVerification` folds into one
 * call per failure.
 */
export type Classification = { foreign: boolean; files: string[]; hand?: string }

/**
 * A file (and, where the output gave one, a line) a failure's output names.
 * Vitest's summary (`FAIL <path>`) and stack frames (`❯ <path>:<line>:<col>`),
 * and a generic stack frame shape (`at ... (<path>:<line>:<col>)`,
 * `in <path>:line <n>`, the shape `dotnet test` prints) are read; a command
 * whose runner prints neither names no file, and a failure with none is never
 * called foreign, for lack of anything to attribute.
 */
export function failureFiles(output: string, baseDir: string): { path: string; line?: number }[] {
  const withLine = new Map<string, number>()
  const seen = new Set<string>()
  const add = (raw: string, line?: number): void => {
    const path = isAbsolute(raw) ? raw : resolve(baseDir, raw)
    seen.add(path)
    if (line !== undefined) withLine.set(path, line)
  }
  for (const m of output.matchAll(/^\s*FAIL\s+(\S+\.(?:ts|tsx|js|jsx|cs))\b/gm)) add(m[1]!)
  for (const m of output.matchAll(/[❯>]\s*(\S+\.(?:ts|tsx|js|jsx|cs)):(\d+):\d+/g)) add(m[1]!, Number(m[2]))
  for (const m of output.matchAll(/\((\S+\.(?:ts|tsx|js|jsx|cs)):(\d+):\d+\)/g)) add(m[1]!, Number(m[2]))
  for (const m of output.matchAll(/\bin\s+(\S+\.cs):line\s+(\d+)/g)) add(m[1]!, Number(m[2]))
  return [...seen].map((path) => ({ path, ...(withLine.has(path) ? { line: withLine.get(path)! } : {}) }))
}

/**
 * A failure is foreign when every file its output names is: no session of
 * `feature` currently owns it, and either another Kiwipow Agent session does or
 * this feature's own last known content there no longer matches what is on
 * disk. A file the output names but nothing tracked is never called foreign
 * (`No other hand no excuse`): the run is silent on whether it changed since
 * this feature's implementation began, so the failure stays the feature's.
 */
export async function classifyFailure(failure: VerificationFailure, hands: FileHands, feature: string, cwd: string): Promise<Classification> {
  const refs = failureFiles(failure.output, failure.cwd)
  if (refs.length === 0) return { foreign: false, files: [] }
  const results = await Promise.all(refs.map((r) => classifyPath(r.path, r.line, hands, feature)))
  const files = refs.map((r) => relative(cwd, r.path).split('\\').join('/'))
  const hand = results.find((r) => r.hand)?.hand
  return { foreign: results.every((r) => r.foreign), files, ...(hand !== undefined ? { hand } : {}) }
}

async function classifyPath(path: string, line: number | undefined, hands: FileHands, feature: string): Promise<{ foreign: boolean; hand?: string }> {
  let mtimeMs: number
  try {
    mtimeMs = (await stat(path)).mtimeMs
  } catch {
    return { foreign: false }
  }
  const current = await hands.handFor(path, mtimeMs)
  // This feature's own session currently owns the file's content: its whole word, no other hand's.
  if (current && current.feature === feature) return { foreign: false }
  const own = await hands.ownSnapshot(feature, path)
  // Never part of this feature's own history: nothing here says it changed since this feature's implementation began.
  if (!own || own.mtimeMs === mtimeMs) return { foreign: false }
  if (line !== undefined) {
    const currentText = await readFile(path, 'utf8').catch(() => undefined)
    if (currentText !== undefined) {
      const narrowed = narrowToFunction(path, currentText, own.text, line)
      if (narrowed !== undefined) return narrowed ? { foreign: false } : { foreign: true, hand: describeHand(current) }
    }
  }
  return { foreign: true, hand: describeHand(current) }
}

/**
 * Whether the failing line's own function reads the same now as it did in
 * this feature's own last known content of the file (`true`: this feature's
 * word stands, not foreign even though the rest of the file moved on;
 * `false`: that function itself reads differently, foreign); `undefined`
 * when the file's shape gives nothing to narrow with, falling back to the
 * whole file.
 */
export function narrowToFunction(path: string, currentText: string, ownText: string, line: number): boolean | undefined {
  const current = blockAt(readStructure(path, currentText).items, line)
  if (!current) return undefined
  const own = matchingBlock(readStructure(path, ownText).items, current.header)
  if (!own) return undefined
  return linesOf(currentText, current.line, current.endLine) === linesOf(ownText, own.line, own.endLine)
}

/** The innermost block covering `line`, its header identifying it well enough to find the same one elsewhere. */
function blockAt(items: CodeItem[], line: number): CodeBlock | undefined {
  for (const item of items) {
    if (line < item.line || line > item.endLine) continue
    if (item.kind !== 'block') return undefined
    return blockAt(item.children, line) ?? item
  }
  return undefined
}

function matchingBlock(items: CodeItem[], header: string): CodeBlock | undefined {
  for (const item of items) {
    if (item.kind !== 'block') continue
    if (item.header === header) return item
    const inner = matchingBlock(item.children, header)
    if (inner) return inner
  }
  return undefined
}

function linesOf(text: string, from: number, to: number): string {
  return text.split(/\r?\n/).slice(from - 1, to).join('\n')
}
