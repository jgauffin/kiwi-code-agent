import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { anyLimit, DEFAULT_TEST_GLOBS, oversized, oversizedFiles, sizeReport, type Limits, type Thresholds } from '../src/agent/cleanup/oversized'
import type { Unit } from '../src/agent/cleanup/unit-size'

const limits: Thresholds = { functionLines: 25, functionComplexity: 15, typeLines: 200, fileLines: 400 }
const off: Thresholds = { functionLines: 0, functionComplexity: 0, typeLines: 0, fileLines: 0 }
const sourceOnly: Limits = { source: limits, tests: off, testGlobs: [] }

const units: Unit[] = [
  { kind: 'file', name: 'a.ts', line: 1, lines: 401 },
  { kind: 'type', name: 'Big', line: 3, lines: 200 },
  { kind: 'function', name: 'long', line: 10, lines: 26, complexity: 15 },
  { kind: 'function', name: 'tangled', line: 40, lines: 25, complexity: 16 },
  { kind: 'function', name: 'both', line: 70, lines: 30, complexity: 20 },
]

const lines = (value: number, limit: number) => ({ measure: 'lines', value, limit })
const complexity = (value: number, limit: number) => ({ measure: 'complexity', value, limit })

describe('oversized', () => {
  it('a_unit_over_any_of_its_kinds_limits_is_flagged_once_with_each_limit_it_passed_and_one_exactly_at_a_limit_is_not', () => {
    expect(oversized('/w/a.ts', units, limits)).toEqual([
      { ...units[0], path: '/w/a.ts', breaches: [lines(401, 400)] },
      { ...units[2], path: '/w/a.ts', breaches: [lines(26, 25)] },
      { ...units[3], path: '/w/a.ts', breaches: [complexity(16, 15)] },
      { ...units[4], path: '/w/a.ts', breaches: [complexity(20, 15), lines(30, 25)] },
    ])
  })

  it('a_zero_limit_turns_that_measure_off', () => {
    expect(oversized('/w/a.ts', units, { ...limits, functionLines: 0, fileLines: 0 }).map((u) => u.name)).toEqual(['tangled', 'both'])
    expect(oversized('/w/a.ts', units, { ...limits, functionComplexity: 0, fileLines: 0 }).map((u) => u.name)).toEqual(['long', 'both'])
    expect(anyLimit({ source: off, tests: off, testGlobs: [] })).toBe(false)
    expect(anyLimit({ source: { ...off, typeLines: 1 }, tests: off, testGlobs: [] })).toBe(true)
    expect(anyLimit({ source: { ...off, functionComplexity: 1 }, tests: off, testGlobs: [] })).toBe(true)
    expect(anyLimit({ source: off, tests: { ...off, fileLines: 1 }, testGlobs: [] })).toBe(true)
  })

  it('the_report_names_path_line_name_kind_and_each_measure_with_its_limit_relative_to_the_workspace', () => {
    const cwd = process.platform === 'win32' ? 'D:\\w' : '/w'
    const path = join(cwd, 'src', 'a.ts')
    const report = sizeReport(cwd, oversized(path, units, limits))
    expect(report).toBe(
      [
        'src/a.ts:1 a.ts (file, 401 lines, limit 400)',
        'src/a.ts:10 long (function, 26 lines, limit 25)',
        'src/a.ts:40 tangled (function, complexity 16, limit 15)',
        'src/a.ts:70 both (function, complexity 20, limit 15; 30 lines, limit 25)',
      ].join('\n'),
    )
  })

  it('files_that_are_gone_binary_ignored_or_in_an_unknown_language_are_passed_over', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oversized-'))
    try {
      const body = Array.from({ length: 30 }, (_, i) => `  a${i}()`).join('\n')
      await writeFile(join(cwd, 'big.ts'), `function big() {\n${body}\n}\n`)
      await writeFile(join(cwd, 'big.test.ts'), `function bigTest() {\n${body}\n}\n`)
      await writeFile(join(cwd, 'blob.ts'), 'function x() {\u0000}')
      await writeFile(join(cwd, 'schema.sql'), Array.from({ length: 60 }, (_, i) => `CREATE TABLE t${i} (id int);`).join('\n'))
      const found = await oversizedFiles(
        cwd,
        [join(cwd, 'big.ts'), join(cwd, 'big.test.ts'), join(cwd, 'blob.ts'), join(cwd, 'gone.ts'), join(cwd, 'schema.sql')],
        { ...sourceOnly, source: { ...sourceOnly.source, fileLines: 50 } },
        ['**/*.test.*'],
      )
      expect(found).toEqual([{ kind: 'function', name: 'big', line: 1, lines: 32, complexity: 0, path: join(cwd, 'big.ts'), breaches: [lines(32, 25)] }])
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('a_test_file_is_held_to_the_larger_test_limits_since_it_stays_one_file_per_tested_file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oversized-'))
    try {
      const body = Array.from({ length: 30 }, (_, i) => `  a${i}()`).join('\n')
      await writeFile(join(cwd, 'big.ts'), `function big() {\n${body}\n}\n`)
      await writeFile(join(cwd, 'big.test.ts'), `function bigTest() {\n${body}\n}\n`)
      const found = await oversizedFiles(
        cwd,
        [join(cwd, 'big.ts'), join(cwd, 'big.test.ts')],
        { source: limits, tests: { ...limits, functionLines: 60 }, testGlobs: ['**/*.test.*'] },
        [],
      )
      expect(found.map((u) => u.name)).toEqual(['big'])
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('by_default_a_file_named_as_a_test_in_any_case_is_a_test_file_and_other_names_holding_test_are_not', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oversized-'))
    try {
      const tests = ['src/Shop/OrderServiceTests.cs', 'src/OrderServiceTest.java', 'order_test.go', 'TEST_cart.py', 'cart.test.ts', 'cart.spec.ts']
      const sources = ['src/Shop/OrderService.cs', 'src/attestation.ts', 'Shop.Tests/OrderFixture.cs', 'src/test/java/Orders.java']
      const paths = [...tests, ...sources].map((p) => join(cwd, p))
      for (const path of paths) {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, 'a\nb\n')
      }
      const found = await oversizedFiles(cwd, paths, { source: { ...off, fileLines: 1 }, tests: off, testGlobs: DEFAULT_TEST_GLOBS }, [])
      expect(found.map((u) => u.path)).toEqual(sources.map((p) => join(cwd, p)))
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
