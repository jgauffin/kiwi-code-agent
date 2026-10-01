import { describe, expect, it } from 'vitest'
import { measureUnits } from '../src/agent/cleanup/unit-size'

/** The cognitive complexity of the named function, or of the first one in the file. */
const complexity = (path: string, text: string, name?: string): number | undefined =>
  measureUnits(path, text).find((u) => u.kind === 'function' && (name === undefined || u.name === name))?.complexity

const ts = (text: string, name?: string) => complexity('x.ts', text, name)

describe('cognitive complexity, the SonarSource rules', () => {
  it('a_function_without_branches_scores_zero', () => {
    expect(ts('function f(a) {\n  const b = a + 1\n  return b\n}\n')).toBe(0)
  })

  it('a_loop_and_a_condition_cost_one_each_plus_how_deeply_they_are_nested', () => {
    expect(ts('function f(xs) {\n  for (const x of xs) {\n    if (x) {\n      use(x)\n    }\n  }\n}\n')).toBe(3)
  })

  it('else_if_and_else_cost_one_and_nest_what_they_hold', () => {
    const text = 'function f(a, b) {\n  if (a > 1) {\n    one()\n  } else if (a > 0) {\n    two()\n  } else {\n    if (b) {\n      three()\n    }\n  }\n}\n'
    expect(ts(text)).toBe(5)
  })

  it('a_run_of_one_boolean_operator_costs_one_and_each_change_of_operator_another', () => {
    expect(ts('function f(a, b, c, d, e) {\n  if (a && b && c || d) {\n    run()\n  }\n  return e || d\n}\n')).toBe(4)
  })

  it('a_lambda_raises_the_nesting_of_what_it_holds', () => {
    expect(ts('function f(xs) {\n  xs.forEach((x) => {\n    if (x) {\n      use(x)\n    }\n  })\n}\n')).toBe(2)
  })

  it('a_nested_function_counts_toward_the_function_it_sits_in_one_level_deeper', () => {
    expect(ts('function outer(a) {\n  function inner() {\n    if (a) return 1\n  }\n  return inner()\n}\n', 'outer')).toBe(2)
  })

  it('a_ternary_costs_one_plus_its_nesting_and_optional_or_nullable_syntax_is_not_one', () => {
    const text = 'function f(a, b) {\n  const c = a ?? b\n  const d = b?.name\n  let e: string | undefined\n  if (a) {\n    return c ? d : e\n  }\n}\n'
    expect(ts(text)).toBe(3)
    const cs = 'class C\n{\n    int F(int? y, Foo o)\n    {\n        int? x = y ?? 0;\n        var s = o?.Name;\n        return x > 0\n            ? 1\n            : 2;\n    }\n}\n'
    expect(complexity('x.cs', cs, 'F')).toBe(1)
  })

  it('a_braceless_if_and_else_count_like_braced_ones', () => {
    expect(ts('function f(a) {\n  if (!a) return 0\n  else return 1\n}\n')).toBe(2)
    expect(complexity('x.cs', 'class C\n{\n    int F(bool a)\n    {\n        if (a)\n            return 1;\n        return 2;\n    }\n}\n', 'F')).toBe(1)
  })

  it('a_do_while_loop_costs_one_not_two', () => {
    expect(ts('function f(x) {\n  do {\n    x++\n  } while (x < 3)\n  return x\n}\n')).toBe(1)
  })

  it('a_catch_costs_one_plus_its_nesting_and_try_and_finally_cost_nothing', () => {
    const text = 'function f() {\n  try {\n    run()\n  } catch (e) {\n    if (e) log(e)\n  } finally {\n    done()\n  }\n}\n'
    expect(ts(text)).toBe(3)
  })

  it('a_function_that_calls_itself_costs_one', () => {
    expect(ts('function fact(n) {\n  if (n <= 1) return 1\n  return n * fact(n - 1)\n}\n')).toBe(2)
    const method = 'class T {\n  walk(node) {\n    for (const c of node.children) this.walk(c)\n  }\n  other(node) {\n    return node.walk()\n  }\n}\n'
    expect(ts(method, 'walk')).toBe(2)
    expect(ts(method, 'other')).toBe(0)
  })

  it('a_switch_costs_one_however_many_cases_it_has', () => {
    const java = `class W {
    String getWords(int number) {
        switch (number) {
            case 1:
                return "one";
            case 2:
                return "a couple";
            default:
                return "lots";
        }
    }
}
`
    expect(complexity('x.java', java, 'getWords')).toBe(1)
  })

  it('a_labelled_jump_costs_one_and_a_labelled_loop_is_still_a_loop', () => {
    const java = `class P {
    int sumOfPrimes(int max) {
        int total = 0;
        OUT: for (int i = 1; i <= max; ++i) {
            for (int j = 2; j < i; ++j) {
                if (i % j == 0) {
                    continue OUT;
                }
            }
            total += i;
        }
        return total;
    }
}
`
    expect(complexity('x.java', java, 'sumOfPrimes')).toBe(7)
  })

  it('match_and_when_arms_do_not_nest_beyond_the_match', () => {
    const rust = 'fn f(x: Option<u32>) -> u32 {\n    match x {\n        Some(v) => {\n            if v > 1 { 1 } else { 0 }\n        }\n        None => 0,\n    }\n}\n'
    expect(complexity('x.rs', rust)).toBe(4)
    const kotlin = 'fun f(x: Any): Int {\n    return when (x) {\n        is String -> {\n            if (x.isEmpty()) return 0\n            1\n        }\n        else -> 2\n    }\n}\n'
    expect(complexity('x.kt', kotlin)).toBe(3)
  })

  it('a_rust_closure_is_a_lambda_not_a_boolean_operator', () => {
    expect(complexity('x.rs', 'fn f(a: bool) {\n    thread::spawn(move || {\n        if a { b() }\n    });\n}\n')).toBe(2)
  })

  it('go_for_and_if_with_init_statements_count_once_and_nest_their_bodies', () => {
    const go = 'func f(m map[string]int) int {\n\tfor i := 0; i < 3; i++ {\n\t\tif v, ok := m["a"]; ok {\n\t\t\treturn v\n\t\t}\n\t}\n\treturn 0\n}\n'
    expect(complexity('x.go', go)).toBe(3)
  })

  it('python_loops_conditions_except_and_conditional_expressions_are_counted_and_and_or_are_operators', () => {
    const py = `def f(a, b, c):
    for x in a:
        if x and b or c:
            pass
        elif b:
            pass
        else:
            pass
    try:
        pass
    except ValueError:
        pass
    return a if b else c
`
    expect(complexity('x.py', py)).toBe(9)
  })
})

/**
 * Every language's literals and comments are full of decoys: control
 * keywords, boolean operators, question marks and braces. Each function has
 * one real `if`, so anything above 1 means a literal was read as code.
 */
describe('cognitive complexity ignores literals and comments', () => {
  it('typescript_strings_templates_and_comments', () => {
    const text = [
      'function f(a) {',
      "  const s = 'if (a && b) { x ? y : z }'",
      '  const d = "while (a || b) {"',
      '  const t = `for (;;) { ${a} } else {`',
      '  // else if (x) {',
      '  /* switch (a) { case 1: } */',
      '  if (a) {',
      '    return s',
      '  }',
      '}',
    ].join('\n')
    expect(ts(text)).toBe(1)
  })

  it('csharp_verbatim_interpolated_raw_strings_and_chars', () => {
    const text = [
      'class C',
      '{',
      '    void F(int a)',
      '    {',
      '        var v = @"if (a) { else ""quoted"" }";',
      '        var i = $"{a} and {{ while (x) }}";',
      '        var r = """',
      '            for (;;) { a ? b : c }',
      '            """;',
      "        var c = '{';",
      '        if (a > 0)',
      '        {',
      '            Run();',
      '        }',
      '    }',
      '}',
    ].join('\n')
    expect(complexity('x.cs', text, 'F')).toBe(1)
  })

  it('java_text_blocks_and_chars', () => {
    const text = 'class J {\n    void f(int a) {\n        String t = """\n            if (a || b) { ? }\n            """;\n        char c = \'?\';\n        if (a > 0) {\n            run();\n        }\n    }\n}\n'
    expect(complexity('x.java', text, 'f')).toBe(1)
  })

  it('go_raw_strings', () => {
    expect(complexity('x.go', 'func f(a int) {\n\ts := `if x { for ? }`\n\tif a > 0 {\n\t\trun(s)\n\t}\n}\n')).toBe(1)
  })

  it('rust_raw_strings_chars_lifetimes_and_nested_comments', () => {
    const text = "fn f<'a>(a: &'a str) {\n    let r = r#\"if a { \"quoted\" && }\"#;\n    let c = '{';\n    /* outer /* if { */ while { */\n    if a.is_empty() {\n        run(r, c);\n    }\n}\n"
    expect(complexity('x.rs', text)).toBe(1)
  })

  it('kotlin_triple_quoted_strings_and_templates', () => {
    const text = 'fun f(a: Int) {\n    val t = """when (x) { else -> } && """\n    val s = "${a} if { ||"\n    if (a > 0) {\n        run(t, s)\n    }\n}\n'
    expect(complexity('x.kt', text)).toBe(1)
  })

  it('swift_raw_strings_and_interpolation', () => {
    const text = 'func f(a: Int) {\n    let r = #"if "x" { guard ? }"#\n    let s = "\\(a) while { &&"\n    if a > 0 {\n        run(r, s)\n    }\n}\n'
    expect(complexity('x.swift', text)).toBe(1)
  })

  it('c_raw_strings_chars_and_preprocessor_directives', () => {
    const text = 'int f(int a) {\n#if DEBUG && TRACE\n    log("for (;;) {");\n#endif\n    const char *r = R"x(if (a) { ? })x";\n    char c = \'{\';\n    if (a > 0) {\n        return 1;\n    }\n    return 0;\n}\n'
    expect(complexity('x.c', text)).toBe(1)
  })

  it('php_hash_comments_and_both_quote_kinds', () => {
    const text = "<?php\nfunction f($a) {\n    # if ($a) { while\n    $s = 'if ($a) { || }';\n    $t = \"{$a} for (;;) {\";\n    if ($a > 0) {\n        return $s . $t;\n    }\n}\n"
    expect(complexity('x.php', text)).toBe(1)
  })

  it('python_triple_quoted_f_strings_and_comments', () => {
    const text = 'def f(a):\n    """if a and b:\n    {"""\n    s = f"{a if a else 0} or {{"\n    # elif a or b:\n    if a:\n        return s\n'
    expect(complexity('x.py', text)).toBe(1)
  })
})
