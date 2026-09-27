import { describe, expect, it } from 'vitest'
import { readDeclarations } from '../src/agent/code-structure/declarations'
import { readStructure, type CodeItem } from '../src/agent/code-structure/structure'

/** One line per item, `block|stmt header line-endLine`, indented by depth; headers on one line. */
const shape = (items: CodeItem[], depth = 0): string[] =>
  items.flatMap((item) => [
    `${'  '.repeat(depth)}${item.kind === 'block' ? 'block' : 'stmt'} ${item.header.replace(/\s+/g, ' ').trim()} ${item.line}-${item.endLine}`,
    ...(item.kind === 'block' ? shape(item.children, depth + 1) : []),
  ])

const read = (path: string, ...lines: string[]): string[] => shape(readStructure(path, lines.join('\n')).items)

const docs = (path: string, ...lines: string[]): Record<string, string | undefined> =>
  Object.fromEntries(readDeclarations(path, lines.join('\n')).declarations.flatMap(function flat(d): [string, string | undefined][] {
    return [[d.name, d.doc?.text], ...d.children.flatMap(flat)]
  }))

describe('reading the structure of brace languages', () => {
  it('blocks_nest_and_statements_sit_inside_the_block_they_end_in', () => {
    expect(read('a.ts', 'class Cart {', '  total = 0;', '  add(n: number) {', '    this.total += n', '  }', '}')).toEqual([
      'block class Cart 1-6',
      '  stmt total = 0 2-2',
      '  block add(n: number) 3-5',
      '    stmt this.total += n 4-4',
    ])
  })

  it('a_header_split_over_lines_and_an_allman_brace_make_one_block_from_the_first_line', () => {
    expect(read('a.cs', 'public void Foo(', '    int a)', '{', '    Bar();', '}')).toEqual(['block public void Foo( int a) 1-5', '  stmt Bar() 4-4'])
  })

  it('a_brace_in_a_string_or_comment_is_not_structure', () => {
    expect(read('a.ts', "const s = '{' // {", 'function f() {', '  return `}`', '}')).toEqual([
      'stmt const s = " " 1-1',
      'block function f() 2-4',
      '  stmt return " " 3-3',
    ])
  })

  it('a_destructuring_pattern_in_a_signature_stays_in_the_header', () => {
    expect(read('a.ts', 'const f = ({ a }: P) => {', '  go(a)', '}')).toEqual(['block const f = ({ a }: P) => 1-3', '  stmt go(a) 2-2'])
  })

  it('a_case_label_in_a_brace_language_opens_no_indented_block', () => {
    expect(read('a.ts', 'switch (x) {', '  case 1:', '    go()', '}')).toEqual(['block switch (x) 1-4', '  stmt case 1: go() 2-3'])
  })

  it('unbalanced_braces_close_at_the_end_of_the_file_without_failing', () => {
    expect(read('a.ts', 'function f() {', '  }', '}', 'function g() {', '  a()')).toEqual(['block function f() 1-2', 'block function g() 4-5', '  stmt a() 5-5'])
  })

  it('stripped_and_original_headers_line_up_across_crlf_line_ends', () => {
    const [item] = readStructure('a.ts', 'x()\r\nlog("a { b")\r\n').items.slice(1)
    expect(item?.origHeader).toBe('log("a { b")')
    expect(item?.header).toBe(`log("${' '.repeat(5)}")`)
  })
})

describe('reading the structure of indented languages', () => {
  it('python_bodies_are_the_lines_indented_under_a_header_and_brackets_continue_a_line', () => {
    expect(read('a.py', 'class A:', '    def f(self,', '          b):', '        x = {', "            'k': 1,", '        }', '', 'y = 1')).toEqual([
      'block class A: 1-6',
      '  block def f(self, b): 2-6',
      '    stmt x = { " ": 1, } 4-6',
      'stmt y = 1 8-8',
    ])
  })

  it('a_ruby_do_block_ends_at_the_dedent', () => {
    expect(read('a_spec.rb', 'describe "cart" do', '  it "adds" do', '    go', '  end', 'end')).toEqual([
      'block describe " " do 1-4',
      '  block it " " do 2-3',
      '    stmt go 3-3',
      '  stmt end 4-4',
      'stmt end 5-5',
    ])
  })
})

describe('doc comments', () => {
  it('a_jsdoc_block_documents_the_declaration_below_it', () => {
    expect(docs('a.ts', '/**', ' * Adds a line.', ' * @param n how many', ' */', 'function add(n) {', '}')).toEqual({ add: 'Adds a line.\n@param n how many' })
  })

  it('an_xml_doc_comment_passes_over_attributes_and_loses_its_tags', () => {
    expect(docs('a.cs', 'public class Cart', '{', '    /// <summary>Totals the cart.</summary>', '    [Pure]', '    public int Total()', '    {', '    }', '}')).toEqual({
      Cart: undefined,
      Total: 'Totals the cart.',
    })
  })

  it('a_blank_line_between_comment_and_declaration_breaks_the_attachment', () => {
    expect(docs('a.ts', '// file header', '', 'function f() {', '}')).toEqual({ f: undefined })
  })

  it('a_block_comment_documents_even_its_unmarked_middle_lines', () => {
    expect(docs('a.go', '/*', '   Serve answers requests.', '*/', 'func Serve() {', '}')).toEqual({ Serve: 'Serve answers requests.' })
  })

  it('a_comment_after_code_on_the_line_above_is_no_doc', () => {
    expect(docs('a.ts', 'const a = 1 // one', 'function f() {', '}')).toEqual({ f: undefined })
  })

  it('a_python_docstring_documents_its_function_and_comments_above_a_def_do_too', () => {
    expect(docs('a.py', '# Greets people.', 'class Greeter:', '    def greet(self):', '        """Says hi."""', '        return 1')).toEqual({
      Greeter: 'Greets people.',
      greet: 'Says hi.',
    })
  })
})
