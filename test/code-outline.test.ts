import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CodeOutlineGate } from '../src/agent/code-outline/code-outline-gate'
import { codeOutlineTool } from '../src/agent/code-outline/code-outline-tool'
import { codeSearchTool } from '../src/agent/code-outline/code-search'
import { findSymbols, outlineCode } from '../src/agent/code-outline/outline'
import { renderFiles, renderNodes } from '../src/agent/code-outline/render'
import type { ToolContext } from '../src/agent/openai-session/tools/tool'

const CART = [
  '/** A cart of order lines. */',
  'export class Cart {',
  '  /**',
  '   * Adds a line. Bumps the quantity when the product is already in.',
  '   */',
  '  addLine(sku: string) {',
  '    const find = () => {',
  '      return 1',
  '    }',
  '  }',
  '',
  '  total(): number {',
  '    return 0',
  '  }',
  '}',
  '',
  'export function tax(amount: number) {',
  '  return amount',
  '}',
].join('\n')

const outline = (path: string, text: string): string => renderNodes(outlineCode(path, text)).join('\n')

describe('outline of one file', () => {
  it('methods_nest_under_their_type_with_ranges_starting_at_the_doc_and_closures_left_out', () => {
    expect(outline('cart.ts', CART)).toBe(
      ['Cart (1-15)  A cart of order lines.', '  addLine (3-10)  Adds a line.', '  total (12-14)', 'tax (17-19)'].join('\n'),
    )
  })

  it('python_classes_and_functions_take_their_docstrings', () => {
    const text = ['class Greeter:', '    """Greets people by name."""', '', '    def greet(self):', '        return 1'].join('\n')
    expect(outline('g.py', text)).toBe(['Greeter (1-5)  Greets people by name.', '  greet (4-5)'].join('\n'))
  })

  it('a_language_the_scanner_does_not_read_has_no_outline', () => {
    expect(outlineCode('notes.rb', 'class A\nend\n')).toEqual([])
  })
})

describe('finding declarations by name', () => {
  const nodes = outlineCode('cart.ts', CART)
  const names = (query: string): string[] => findSymbols(nodes, query).map((m) => m.qualified)

  it('a_name_matches_case_insensitively_on_any_part_of_the_own_name', () => {
    expect(names('LINE')).toEqual(['Cart.addLine'])
  })

  it('a_dotted_query_matches_the_qualified_name_so_a_type_can_narrow_it', () => {
    expect(names('cart.t')).toEqual(['Cart.total'])
    expect(names('cart')).toEqual(['Cart'])
  })
})

describe('rendering outlines of several files', () => {
  const files = [
    { path: 'src/a.ts', nodes: outlineCode('a.ts', CART) },
    { path: 'src/b.ts', nodes: outlineCode('b.ts', CART) },
  ]

  it('files_render_in_full_with_summaries_while_they_fit', () => {
    expect(renderFiles(files.slice(0, 1), [])).toBe(['## src/a.ts', outline('cart.ts', CART)].join('\n'))
  })

  it('over_budget_the_summaries_go_first_then_the_members', () => {
    const noDocs = renderFiles(files, [], 160)
    expect(noDocs).toContain('names and line ranges only')
    expect(noDocs).toContain('  addLine (3-10)\n')
    expect(noDocs).not.toContain('Adds a line')
    const topLevel = renderFiles(files, [], 90)
    expect(topLevel).toContain('top level only')
    expect(topLevel).not.toContain('addLine')
  })
})

async function withWorkspace<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'code-outline-'))
  try {
    for (const [path, text] of Object.entries(files)) {
      const full = join(dir, ...path.split('/'))
      await mkdir(join(full, '..'), { recursive: true })
      await writeFile(full, text, 'utf8')
    }
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const ctx = (cwd: string): ToolContext => ({ cwd, signal: new AbortController().signal }) as ToolContext

describe('the CodeOutline tool', () => {
  it('a_folder_lists_its_source_files_and_leaves_out_what_declares_nothing', () =>
    withWorkspace({ 'src/cart.ts': CART, 'src/consts.ts': 'export const a = 1\n', 'src/notes.md': '# Cart\n' }, async (dir) => {
      const out = await codeOutlineTool.execute({ path: 'src' }, ctx(dir))
      expect(out.text).toBe(['## src/cart.ts', outline('cart.ts', CART)].join('\n'))
    }))

  it('symbol_finds_where_a_declaration_lives_across_files', () =>
    withWorkspace({ 'src/cart.ts': CART, 'src/order.ts': 'export class Order {\n  addLine() {\n  }\n}\n' }, async (dir) => {
      const out = await codeOutlineTool.execute({ path: 'src', symbol: 'addline' }, ctx(dir))
      expect(out.text).toBe(['Cart.addLine  src/cart.ts:3-10  Adds a line.', 'Order.addLine  src/order.ts:2-3'].join('\n'))
    }))

  it('a_file_in_a_language_the_outline_does_not_read_is_sent_to_read', () =>
    withWorkspace({ 'a.rb': 'class A\nend\n' }, async (dir) => {
      expect((await codeOutlineTool.execute({ path: 'a.rb' }, ctx(dir))).text).toContain('Read it')
    }))
})

const bigSource = (): string => Array.from({ length: 80 }, (_, i) => `export function f${i}() {\n  return ${i}\n}`).join('\n')
const bigSpec = (): string => `describe('big', () => {\n${Array.from({ length: 250 }, (_, i) => `  it('rule ${i}', () => {})`).join('\n')}\n})\n`
const read = (file_path: string, extra: Record<string, unknown> = {}) => ({ toolName: 'Read', input: { file_path, ...extra }, toolUseId: 'r' })
const denied = (outcome: unknown): string => (outcome && typeof outcome === 'object' && 'deny' in outcome ? String(outcome.deny) : '')

describe('the code outline gate', () => {
  it('the_first_whole_read_of_a_long_source_file_is_answered_with_its_outline_and_the_second_goes_through', () =>
    withWorkspace({ 'src/big.ts': bigSource() }, async (dir) => {
      const hook = new CodeOutlineGate(dir)
      expect(denied(await hook.preToolUse(read('src/big.ts')))).toContain('f79 (238-240)')
      expect(await hook.preToolUse(read('src/big.ts'))).toBeUndefined()
    }))

  it('a_short_file_and_a_ranged_read_go_through', () =>
    withWorkspace({ 'src/cart.ts': CART, 'src/big.ts': bigSource() }, async (dir) => {
      const hook = new CodeOutlineGate(dir)
      expect(await hook.preToolUse(read('src/cart.ts'))).toBeUndefined()
      expect(await hook.preToolUse(read('src/big.ts', { offset: 1, limit: 20 }))).toBeUndefined()
    }))

  it('a_long_test_file_is_outlined_by_its_tests_rather_than_its_declarations', () =>
    withWorkspace({ 'test/big.test.ts': bigSpec() }, async (dir) => {
      const text = denied(await new CodeOutlineGate(dir).preToolUse(read('test/big.test.ts')))
      expect(text).toContain('253 lines and 250 tests')
      expect(text).toContain('rule 0 (line 2)')
    }))
})

describe('the CodeSearch tool', () => {
  const search = (dir: string, query: string, canRead?: (rel: string) => boolean) =>
    codeSearchTool(canRead).execute({ query, path: 'src' }, ctx(dir)).then((out) => out.text)

  it('matches_are_filed_under_the_declaration_they_sit_in_and_doc_matches_under_what_they_document', () =>
    withWorkspace({ 'src/cart.ts': CART }, async (dir) => {
      expect(await search(dir, 'quantity')).toContain('src/cart.ts: doc of Cart.addLine (3-10)\n  4: * Adds a line. Bumps the quantity')
      expect(await search(dir, 'return 0')).toContain('src/cart.ts: Cart.total (12-14)\n  13: return 0')
    }))

  it('a_match_outside_every_declaration_says_so', () =>
    withWorkspace({ 'src/a.ts': "import { x } from 'y'\n" }, async (dir) => {
      expect(await search(dir, 'import')).toContain('src/a.ts: (outside any declaration)')
    }))

  it('files_outside_the_read_scope_are_not_searched', () =>
    withWorkspace({ 'src/cart.ts': CART, 'src/secret.ts': 'const quantity = 1\n' }, async (dir) => {
      const out = await search(dir, 'quantity', (rel) => rel !== 'src/secret.ts')
      expect(out).not.toContain('secret')
      expect(out).toContain('1 match in 1 place')
    }))
})
