import { describe, expect, it } from 'vitest'
import { languageOf } from '../src/agent/cleanup/language'
import { stripLiterals } from '../src/agent/cleanup/strip-literals'

const strip = (ext: string, text: string): string => stripLiterals(text, languageOf(`x.${ext}`)!)

const braces = (text: string): number => (text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length

describe('stripLiterals', () => {
  it('keeps_the_line_count_and_columns_and_blanks_comments', () => {
    const text = 'a // { one\n/* two\n   { three */ b\nc'
    expect(strip('ts', text)).toBe(`a${' '.repeat(9)}\n${' '.repeat(6)}\n${' '.repeat(14)}b\nc`)
  })

  it('a_string_keeps_its_quotes_and_loses_its_content_so_the_line_still_counts_as_code', () => {
    expect(strip('ts', "const s = 'a { b'")).toBe('const s = "     "')
    expect(strip('ts', 'const s = "a \\" { b"')).toBe('const s = "        "')
  })

  it('an_unterminated_string_ends_at_the_newline_so_a_regex_costs_one_line_at_most', () => {
    const text = "const re = /'/\nfunction f() {\n}"
    const out = strip('ts', text)
    expect(out.split('\n')).toHaveLength(3)
    expect(out.split('\n')[1]).toBe('function f() {')
  })

  it('a_template_hole_with_a_nested_template_and_braces_is_blanked_with_the_string', () => {
    const text = 'const t = `a ${cond ? `{${x}}` : "}"} b`; go()'
    const out = strip('ts', text)
    expect(braces(out)).toBe(0)
    expect(out).toMatch(/^const t = " *"; go\(\)$/)
  })

  it('csharp_verbatim_interpolated_and_raw_strings_hide_their_braces_and_quotes', () => {
    const text = [
      'var a = @"c:\\x "" { y";',
      'var b = $"v {new List<int> { 1 }.Count} {{lit}}";',
      'var c = $@"{a} "" }";',
      'var d = """',
      '  { raw }',
      '  """;',
      'var e = "";',
      'var f = $"{x}";',
    ].join('\n')
    const out = strip('cs', text)
    expect(braces(out)).toBe(0)
    expect(out.split('\n')).toHaveLength(8)
    expect(out.split('\n')[0]).toBe('var a =  "           ";')
    expect(out.split('\n')[6]).toBe('var e = "";')
    expect(out.split('\n')[7]).toBe('var f =  "   ";')
  })

  it('rust_raw_strings_chars_and_lifetimes_are_told_apart', () => {
    const text = 'let r = r#"a " { b"#; let c = \'{\'; fn f<\'a>(x: &\'a str) -> &\'a str { x }'
    const out = strip('rs', text)
    expect(braces(out)).toBe(0)
    expect(out).toContain("fn f<'a>(x: &'a str) -> &'a str { x }")
  })

  it('rust_block_comments_nest', () => {
    expect(strip('rs', '/* a /* b */ { */ x')).toBe(`${' '.repeat(18)}x`)
  })

  it('c_directives_are_blanked_including_continuation_lines_and_raw_strings_hide_their_braces', () => {
    const text = '#define X { \\\n  }\nint a = R"x(a { )x"; char c = \'{\';'
    const out = strip('c', text)
    expect(braces(out)).toBe(0)
    expect(out.split('\n')).toHaveLength(3)
    expect(out.split('\n')[0]!.trim()).toBe('')
    expect(out.split('\n')[1]!.trim()).toBe('')
  })

  it('swift_interpolation_holes_and_hash_delimited_strings_are_blanked', () => {
    const text = 'let s = "a \\(f("{")) b"; let r = #"x " { y"#; let t = """\n{\n"""'
    const out = strip('swift', text)
    expect(braces(out)).toBe(0)
    expect(out.split('\n')).toHaveLength(3)
  })

  it('kotlin_dollar_holes_in_ordinary_and_triple_strings_are_blanked', () => {
    const text = 'val s = "a ${b.map { it }} c"; val t = """x ${y { z }} w"""'
    expect(braces(strip('kt', text))).toBe(0)
  })

  it('go_raw_strings_and_runes_hide_their_braces', () => {
    expect(braces(strip('go', 'x := `a { b`; r := \'{\''))).toBe(0)
  })

  it('python_triple_quotes_prefixes_and_hash_comments_are_blanked', () => {
    const text = 'a = f"""x {\n{\n"""\nb = rb\'{\'  # { c\nc = 1'
    const out = strip('py', text)
    expect(braces(out)).toBe(0)
    expect(out.split('\n')).toHaveLength(5)
    expect(out.split('\n')[4]).toBe('c = 1')
  })

  it('php_hash_comments_and_single_quoted_strings_are_blanked', () => {
    expect(strip('php', "$a = '{'; # { x")).toBe('$a = " ";      ')
  })
})
