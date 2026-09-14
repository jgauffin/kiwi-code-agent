import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { measureUnits, type Unit } from '../src/agent/cleanup/unit-size'

const FIXTURES = resolve(import.meta.dirname, 'fixtures-units')

const measure = (name: string): Unit[] => measureUnits(join(FIXTURES, name), readFileSync(join(FIXTURES, name), 'utf8'))

const fn = (name: string, line: number, lines: number): Unit => ({ kind: 'function', name, line, lines })
const type = (name: string, line: number, lines: number): Unit => ({ kind: 'type', name, line, lines })
const file = (name: string, lines: number): Unit => ({ kind: 'file', name, line: 1, lines })

describe('measureUnits over the fixtures', () => {
  it('typescript_classes_methods_functions_and_arrows_are_units_and_callbacks_are_not', () => {
    expect(measure('sample.ts')).toEqual([
      file('sample.ts', 48),
      type('Options', 7, 3),
      type('Shape', 11, 3),
      type('Box', 15, 17),
      fn('handle', 17, 5),
      fn('size', 23, 3),
      fn('method', 27, 6),
      fn('plain', 35, 6),
      fn('arrow', 42, 3),
      fn('helper', 50, 3),
    ])
  })

  it('csharp_members_are_units_and_accessors_initializers_and_interpolations_are_not', () => {
    expect(measure('sample.cs')).toEqual([
      file('sample.cs', 43),
      type('Widget', 6, 29),
      fn('Widget', 18, 6),
      fn('RunAsync', 26, 12),
      type('Point', 40, 4),
      type('Kind', 45, 1),
      type('Pair', 47, 4),
    ])
  })

  it('go_receivers_and_type_declarations_are_named_and_literals_and_goroutines_are_not', () => {
    expect(measure('sample.go')).toEqual([
      file('sample.go', 26),
      type('Server', 5, 3),
      type('Handler', 9, 3),
      fn('Serve', 13, 8),
      fn('main', 22, 10),
    ])
  })

  it('rust_impls_and_functions_with_where_clauses_attributes_lifetimes_and_raw_strings_are_measured', () => {
    expect(measure('sample.rs')).toEqual([
      file('sample.rs', 31),
      type('Point', 5, 3),
      type('fmt::Display', 9, 7),
      fn('fmt', 10, 5),
      fn('run', 17, 12),
      fn('it_works', 33, 3),
    ])
  })

  it('python_units_end_at_the_dedent_and_a_bracket_continuation_does_not_end_them', () => {
    expect(measure('sample.py')).toEqual([
      file('sample.py', 23),
      type('Greeter', 4, 10),
      fn('__init__', 7, 2),
      fn('greet', 10, 6),
      fn('helper', 18, 3),
      fn('fetch', 23, 7),
    ])
  })

  it('java_annotations_text_blocks_anonymous_classes_and_static_blocks_do_not_confuse_the_measure', () => {
    expect(measure('sample.java')).toEqual([
      file('sample.java', 19),
      type('Greeter', 4, 15),
      fn('run', 10, 7),
      type('Point', 23, 1),
      type('Color', 25, 1),
    ])
  })

  it('kotlin_primary_constructors_objects_extension_functions_and_trailing_lambdas_are_handled', () => {
    expect(measure('sample.kt')).toEqual([
      file('sample.kt', 20),
      type('User', 3, 3),
      type('Registry', 7, 8),
      fn('register', 8, 3),
      fn('shout', 12, 3),
      fn('main', 17, 8),
    ])
  })

  it('swift_computed_properties_and_accessors_are_not_units_and_extensions_are_types', () => {
    expect(measure('sample.swift')).toEqual([
      file('sample.swift', 22),
      type('Point', 3, 7),
      type('Greeter', 11, 11),
      fn('greet', 12, 4),
      fn('init', 17, 5),
      type('Greeter', 24, 3),
      fn('bye', 25, 1),
    ])
  })

  it('c_directives_are_blanked_and_a_function_returning_a_struct_is_a_function', () => {
    expect(measure('sample.c')).toEqual([
      file('sample.c', 20),
      type('point', 5, 3),
      type('(anonymous)', 9, 3),
      fn('add', 13, 5),
      fn('make', 19, 5),
      fn('main', 25, 4),
    ])
  })

  it('php_closures_take_the_name_of_the_variable_they_are_assigned_to', () => {
    expect(measure('sample.php')).toEqual([
      file('sample.php', 22),
      type('Greeter', 5, 11),
      fn('greet', 6, 9),
      fn('helper', 17, 6),
      fn('$g', 24, 3),
    ])
  })

  it('an_unknown_extension_yields_only_the_file_unit', () => {
    expect(measure('notes.txt')).toEqual([file('notes.txt', 2)])
  })
})

describe('measureUnits header rules', () => {
  const units = (text: string, name = 'x.ts'): Unit[] => measureUnits(name, text).slice(1)

  it('an_unclosed_unit_closes_at_the_end_of_the_file', () => {
    expect(units('function open() {\n  a()\n  b()\n')).toEqual([fn('open', 1, 3)])
  })

  it('a_nested_function_counts_toward_the_function_it_sits_in', () => {
    const text = 'function outer() {\n  function inner() {\n    return 1\n  }\n  return inner()\n}\n'
    expect(units(text)).toEqual([fn('outer', 1, 6)])
  })

  it('a_control_block_a_literal_and_an_object_argument_open_no_unit', () => {
    const text = 'if (a) {\n  b()\n}\nconst x = {\n  y: 1,\n}\nfoo({ a: 1 }, {\n  b: 2,\n})\nreturn {\n  z: 1,\n}\n'
    expect(units(text)).toEqual([])
  })

  it('an_arrow_argument_is_a_callback_and_an_arrow_assigned_to_a_name_is_a_function', () => {
    expect(units("app.get('/', (req, res) => {\n  res.send()\n})\n")).toEqual([])
    expect(units('const handler = (req, res) => {\n  res.send()\n}\n')).toEqual([fn('handler', 1, 3)])
  })

  it('a_type_alias_and_a_new_expression_are_told_apart_from_a_type_and_a_function', () => {
    expect(units('type Foo = {\n  a: string\n}\n')).toEqual([type('Foo', 1, 3)])
    expect(units('new Runnable() {\n  run()\n}\n', 'x.java')).toEqual([])
  })

  it('a_multi_line_header_is_measured_from_its_first_line', () => {
    expect(units('public void Foo(\n    int a)\n{\n    Bar();\n}\n', 'x.cs')).toEqual([fn('Foo', 1, 5)])
  })

  it('comment_and_blank_lines_do_not_count_as_code', () => {
    const text = 'function f() {\n  // one\n\n  /* two\n     three */\n  return 1\n}\n'
    expect(units(text)).toEqual([fn('f', 1, 3)])
  })
})
