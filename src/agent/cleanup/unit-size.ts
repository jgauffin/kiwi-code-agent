import { basename } from 'node:path'
import { readDeclarations, type Declaration } from '../code-structure/declarations'
import { languageOf } from '../code-structure/language'
import { cognitiveComplexity } from './unit-complexity'

export type UnitKind = 'function' | 'type' | 'file'

/**
 * One measurable thing in a file: the file itself, a function, or a type.
 * `lines` counts code lines only; a function also has its cognitive complexity.
 */
export type Unit = { kind: UnitKind; name: string; line: number; lines: number; complexity?: number }

/**
 * The units of a source file and their sizes, read off its declarations.
 * Precise enough to decide whether a file deserves a cleanup pass, no more.
 * Nested functions count toward the function they sit in. A language not
 * known here yields the file unit alone.
 */
export function measureUnits(path: string, text: string): Unit[] {
  const file = { kind: 'file' as const, name: basename(path), line: 1 }
  if (!languageOf(path)) return [{ ...file, lines: countCode(text.split(/\r?\n/)) }]
  const { declarations, code, family, bodies } = readDeclarations(path, text)
  const lines = new CodeLines(code)
  const units: Unit[] = []
  const measure = (found: Declaration[]): void => {
    for (const d of found) {
      const unit: Unit = { kind: d.kind, name: d.name, line: d.line, lines: lines.between(d.line, d.endLine) }
      if (d.kind === 'function') unit.complexity = cognitiveComplexity(d.name, bodies.get(d) ?? [], family)
      units.push(unit)
      measure(d.children)
    }
  }
  measure(declarations)
  units.sort((a, b) => a.line - b.line)
  return [{ ...file, lines: countCode(code) }, ...units]
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
