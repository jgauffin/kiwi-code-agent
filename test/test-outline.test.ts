import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countTests, outlineTests } from '../src/agent/test-outline/scan'
import { renderNodes } from '../src/agent/test-outline/render'
import { renderFiles } from '../src/agent/code-outline/render'
import { findSources } from '../src/agent/code-structure/source-files'
import { CodeOutlineGate } from '../src/agent/code-outline/code-outline-gate'
import { codeOutlineTool } from '../src/agent/code-outline/code-outline-tool'
import type { ToolContext } from '../src/agent/openai-session/tools/tool'

const outline = (path: string, ...lines: string[]): string => renderNodes(outlineTests(path, lines.join('\n'))).join('\n')

describe('outline of one file', () => {
  it('nested_describe_blocks_become_groups_with_modifiers_as_tags', () => {
    expect(
      outline(
        'cart.test.ts',
        "import { describe, it, expect } from 'vitest'",
        "describe('cart', () => {",
        "  describe('adding', () => {",
        "    it('adds an item', () => {",
        '      expect(1).toBe(1)',
        '    })',
        "    it.skip('rejects a negative quantity', () => {})",
        '  })',
        "  it.each([[1, 2], [3, 4]])('sums %i and %i', (a, b) => {",
        '    const o = { a: { b } }',
        '  })',
        "  test.todo('removes an item')",
        '})',
      ),
    ).toBe(
      [
        'cart (line 2)',
        '  adding (line 3)',
        '    adds an item (line 4)',
        '    rejects a negative quantity (line 7) [skip]',
        '  sums %i and %i (line 9) [param]',
        '  removes an item (line 12) [todo]',
      ].join('\n'),
    )
  })

  it('brace_inside_test_name_does_not_shift_nesting', () => {
    expect(
      outline(
        'names.spec.js',
        'describe("parser", function () {',
        '  it("reads { and } in names", () => {',
        '    const s = `${"}"}`',
        '  })',
        '})',
        'it(`top level`, async () => {})',
      ),
    ).toBe(['parser (line 1)', '  reads { and } in names (line 2)', 'top level (line 6)'].join('\n'))
  })

  it('a_call_named_like_a_test_without_a_body_or_second_argument_is_not_a_test', () => {
    expect(outline('code.kt', 'val xs = list.map { it(x) }', 'fun test(a: Int) = a', 'regex.test("x")')).toBe('')
  })

  it('xunit_attributes_mark_tests_and_classes_without_tests_are_left_out', () => {
    expect(
      outline(
        'CartTests.cs',
        'namespace Shop.Tests;',
        '',
        'public class CartTests',
        '{',
        '    [Fact]',
        '    public void Empty_cart_has_no_total()',
        '    {',
        '        Assert.Equal(0, new Cart().Total);',
        '    }',
        '',
        '    [Theory]',
        '    [InlineData(1)]',
        '    [InlineData(2)]',
        '    public async Task Quantity_is_positive(int quantity)',
        '    {',
        '    }',
        '',
        '    [Fact(Skip = "flaky")]',
        '    public void Checkout_sends_mail() { }',
        '',
        '    private void Helper() { }',
        '',
        '    public class Nested',
        '    {',
        '        [Test]',
        '        public void Inner_rule() { }',
        '    }',
        '}',
        '',
        'public class NotATestClass',
        '{',
        '    public void Run() { }',
        '}',
      ),
    ).toBe(
      [
        'CartTests (line 3)',
        '  Empty_cart_has_no_total (line 6)',
        '  Quantity_is_positive (line 14) [param]',
        '  Checkout_sends_mail (line 19) [skip]',
        '  Nested (line 23)',
        '    Inner_rule (line 26)',
      ].join('\n'),
    )
  })

  it('junit_annotations_mark_tests_and_display_name_renames_the_class', () => {
    expect(
      outline(
        'OrderTest.kt',
        'class OrderTest {',
        '    @Test',
        '    fun `cancels an open order`() {',
        '    }',
        '',
        '    @ParameterizedTest',
        '    @ValueSource(ints = [1, 2])',
        '    fun rejectsQuantity(q: Int) {',
        '    }',
        '',
        '    @Nested',
        '    @DisplayName("when shipped")',
        '    inner class Shipped {',
        '        @Test',
        '        @Disabled',
        '        fun cannotCancel() {}',
        '    }',
        '}',
      ),
    ).toBe(
      [
        'OrderTest (line 1)',
        '  cancels an open order (line 3)',
        '  rejectsQuantity (line 8) [param]',
        '  when shipped (line 13)',
        '    cannotCancel (line 16) [skip]',
      ].join('\n'),
    )
  })

  it('rust_test_attributes_mark_tests_inside_the_tests_module', () => {
    expect(
      outline(
        'lib.rs',
        'fn helper() {}',
        '',
        '#[cfg(test)]',
        'mod tests {',
        '    use super::*;',
        '',
        '    #[test]',
        '    fn adds_two() {',
        '        assert_eq!(2, 1 + 1);',
        '    }',
        '',
        '    #[tokio::test]',
        '    #[ignore]',
        '    async fn fetches() {}',
        '}',
      ),
    ).toBe(['tests (line 4)', '  adds_two (line 8)', '  fetches (line 14) [skip]'].join('\n'))
  })

  it('php_test_attribute_survives_hash_comment_stripping', () => {
    expect(
      outline(
        'PriceTest.php',
        '<?php',
        'final class PriceTest extends TestCase',
        '{',
        '    #[Test]',
        '    public function rounds_half_up(): void',
        '    {',
        '    }',
        '',
        '    public function testAddsVat(): void',
        '    {',
        '    }',
        '',
        "    #[DataProvider('prices')]",
        '    public function testDiscount(int $p): void {}',
        '',
        '    public static function prices(): array { return []; }',
        '}',
      ),
    ).toBe(['PriceTest (line 2)', '  rounds_half_up (line 5)', '  testAddsVat (line 9)', '  testDiscount (line 14) [param]'].join('\n'))
  })

  it('pytest_names_and_decorators_mark_tests_and_a_decorator_may_span_lines', () => {
    expect(
      outline(
        'test_cart.py',
        'import pytest',
        '',
        'def helper():',
        '    pass',
        '',
        'def test_top_level():',
        '    assert True',
        '',
        'class TestCart:',
        '    @pytest.mark.parametrize("qty", [',
        '        1,',
        '        2,',
        '    ])',
        '    def test_quantity(self, qty):',
        '        data = {',
        '            "a": 1,',
        '        }',
        '',
        '    @pytest.mark.skip(reason="later")',
        '    def test_later(self):',
        '        pass',
        '',
        '    def helper(self):',
        '        pass',
        '',
        'class Other:',
        '    def method(self):',
        '        pass',
      ),
    ).toBe(['test_top_level (line 6)', 'TestCart (line 9)', '  test_quantity (line 14) [param]', '  test_later (line 20) [skip]'].join('\n'))
  })

  it('rspec_do_end_blocks_nest_by_indentation', () => {
    expect(
      outline(
        'cart_spec.rb',
        'RSpec.describe Cart do',
        '  describe "#total" do',
        '    it "sums the lines" do',
        '      expect(cart.total).to eq(3)',
        '    end',
        '',
        '    context "when empty" do',
        '      it "is zero" do',
        '      end',
        '    end',
        '  end',
        '',
        '  it "has an id" do',
        '  end',
        'end',
      ),
    ).toBe(
      [
        'Cart (line 1)',
        '  #total (line 2)',
        '    sums the lines (line 3)',
        '    when empty (line 7)',
        '      is zero (line 8)',
        '  has an id (line 13)',
      ].join('\n'),
    )
  })

  it('go_subtest_with_variable_name_is_dynamic', () => {
    expect(
      outline(
        'cart_test.go',
        'package cart',
        '',
        'import "testing"',
        '',
        'func TestTotal(t *testing.T) {',
        '\tcases := []struct{ name string }{{name: "a"}}',
        '\tfor _, tc := range cases {',
        '\t\tt.Run(tc.name, func(t *testing.T) {',
        '\t\t})',
        '\t}',
        '\tt.Run("empty cart", func(t *testing.T) {})',
        '}',
        '',
        'func helper() {}',
      ),
    ).toBe(['TestTotal (line 5)', '  (dynamic: tc.name) (line 8)', '  empty cart (line 11)'].join('\n'))
  })

  it('catch2_sections_nest_and_googletest_names_join_suite_and_test', () => {
    expect(
      outline(
        'vector_test.cpp',
        '#include <catch2/catch_test_macros.hpp>',
        '',
        'TEST_CASE("vector grows", "[vector]") {',
        '    std::vector<int> v;',
        '    SECTION("push_back adds one") {',
        '        v.push_back(1);',
        '    }',
        '}',
        '',
        'TEST(MathTest, AddsTwo) {',
        '    EXPECT_EQ(2, 1 + 1);',
        '}',
        '',
        'TEST_P(MathParam, Squares) {}',
      ),
    ).toBe(['vector grows (line 3)', '  push_back adds one (line 5)', 'MathTest.AddsTwo (line 10)', 'MathParam.Squares (line 14) [param]'].join('\n'))
  })

  it('swift_testing_display_names_and_xctest_method_names_mark_tests', () => {
    expect(
      outline(
        'CartTests.swift',
        'import Testing',
        'import XCTest',
        '',
        '@Suite("Cart rules")',
        'struct CartTests {',
        '    @Test("empty cart totals zero")',
        '    func emptyTotal() {',
        '    }',
        '',
        '    @Test func addsItem() {}',
        '}',
        '',
        'final class LegacyTests: XCTestCase {',
        '    func testRemoves() {',
        '    }',
        '    func helper() {}',
        '}',
      ),
    ).toBe(['Cart rules (line 5)', '  empty cart totals zero (line 7)', '  addsItem (line 10)', 'LegacyTests (line 13)', '  testRemoves (line 14)'].join('\n'))
  })

  it('kotest_string_and_call_specs_nest_inside_the_spec_class', () => {
    expect(
      outline(
        'CartSpec.kt',
        'class CartSpec : StringSpec({',
        '    "totals the lines" {',
        '    }',
        '})',
        'class FunCart : FunSpec({',
        '    context("checkout") {',
        '        test("sends mail") { }',
        '    }',
        '})',
      ),
    ).toBe(['CartSpec (line 1)', '  totals the lines (line 2)', 'FunCart (line 5)', '  checkout (line 6)', '    sends mail (line 7)'].join('\n'))
  })

  it('a_test_with_subtests_counts_as_its_subtests', () => {
    const nodes = outlineTests('a_test.go', ['func TestA(t *testing.T) {', '\tt.Run("x", func(t *testing.T) {})', '\tt.Run("y", func(t *testing.T) {})', '}', 'func TestB(t *testing.T) {}'].join('\n'))
    expect(countTests(nodes)).toBe(3)
  })
})

async function withWorkspace<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'test-outline-'))
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

const SPEC = "describe('a', () => {\n  it('b', () => {})\n})\n"

describe('finding the files to outline', () => {
  it('nested_repository_is_skipped_and_named', () =>
    withWorkspace({ 'test/a.test.ts': SPEC, 'vendor/lib/.git': 'gitdir: ../../.git/modules/lib', 'vendor/lib/b.test.ts': SPEC }, async (dir) => {
      const found = await findSources(dir, '.')
      expect(found.files).toEqual(['test/a.test.ts'])
      expect(found.nestedRepositories).toEqual(['vendor/lib'])
    }))

  it('built_minified_generated_ignored_and_documentation_files_are_left_out', () =>
    withWorkspace(
      {
        '.gitignore': 'tmp/\n',
        'test/a.test.ts': SPEC,
        'test/a.min.js': SPEC,
        'test/api.generated.ts': SPEC,
        'coverage/x.test.ts': SPEC,
        'node_modules/dep/x.test.ts': SPEC,
        'tmp/x.test.ts': SPEC,
        'docs/testing.md': SPEC,
      },
      async (dir) => {
        expect((await findSources(dir, '.')).files).toEqual(['test/a.test.ts'])
      },
    ))

  it('a_glob_picks_files_under_its_static_base', () =>
    withWorkspace({ 'test/a.test.ts': SPEC, 'test/b.ts': SPEC, 'src/c.test.ts': SPEC }, async (dir) => {
      expect((await findSources(dir, 'test/**/*.test.ts')).files).toEqual(['test/a.test.ts'])
    }))
})

describe('rendering a suite', () => {
  const file = (path: string): { path: string; tests: ReturnType<typeof outlineTests> } => ({
    path,
    tests: outlineTests(path, "describe('group', () => {\n  it('first rule', () => {})\n  it('second rule', () => {})\n})\n"),
  })

  it('files_render_as_full_trees_with_a_count_while_they_fit', () => {
    expect(renderFiles([file('test/a.test.ts')], [])).toBe(
      ['## test/a.test.ts: 2 tests', 'group (line 1)', '  first rule (line 2)', '  second rule (line 3)'].join('\n'),
    )
  })

  it('suite_view_falls_back_to_top_level_groups_when_over_budget', () => {
    const text = renderFiles([file('test/a.test.ts'), file('test/b.test.ts')], [], 150)
    expect(text).toContain('## test/a.test.ts: 2 tests\ngroup (line 1)\n## test/b.test.ts')
    expect(text).not.toContain('first rule')
    expect(text).toContain('top level only')
  })

  it('skipped_nested_repositories_are_named', () => {
    expect(renderFiles([file('test/a.test.ts')], ['vendor/lib'])).toContain('vendor/lib')
  })
})

const ctx = (cwd: string): ToolContext => ({ cwd, signal: new AbortController().signal }) as ToolContext

describe('the CodeOutline tool on tests', () => {
  it('a_file_with_neither_tests_nor_declarations_says_so_so_the_agent_reads_it', () =>
    withWorkspace({ 'src/a.ts': 'export const a = 1\n' }, async (dir) => {
      const out = await codeOutlineTool.execute({ path: 'src/a.ts' }, ctx(dir))
      expect(out.isError).toBe(false)
      expect(out.text).toContain('Nothing recognised')
    }))

  it('a_test_file_is_outlined_by_its_tests_and_a_file_with_nothing_to_outline_is_left_out', () =>
    withWorkspace({ 'test/a.test.ts': SPEC, 'test/helper.ts': 'export const h = 1\n' }, async (dir) => {
      const out = await codeOutlineTool.execute({ path: 'test' }, ctx(dir))
      expect(out.text).toBe(['## test/a.test.ts: 1 test', 'a (line 1)', '  b (line 2)'].join('\n'))
    }))
})

const bigSpec = (): string => `describe('big', () => {\n${Array.from({ length: 200 }, (_, i) => `  it('rule ${i}', () => {})`).join('\n')}\n})\n`

const read = (file_path: string, extra: Record<string, unknown> = {}) => ({ toolName: 'Read', input: { file_path, ...extra }, toolUseId: 'r' })

describe('the outline gate on tests', () => {
  it('the_first_whole_read_of_a_large_test_file_is_answered_with_its_outline', () =>
    withWorkspace({ 'test/big.test.ts': bigSpec() }, async (dir) => {
      const hook = new CodeOutlineGate(dir)
      const first = await hook.preToolUse(read(join(dir, 'test/big.test.ts')))
      expect(first && 'deny' in first ? first.deny : '').toContain("rule 0 (line 2)")
      expect(await hook.preToolUse(read(join(dir, 'test/big.test.ts')))).toBeUndefined()
    }))

  it('a_read_of_a_line_range_goes_through', () =>
    withWorkspace({ 'test/big.test.ts': bigSpec() }, async (dir) => {
      const hook = new CodeOutlineGate(dir)
      expect(await hook.preToolUse(read('test/big.test.ts',{ offset: 10, limit: 20 }))).toBeUndefined()
    }))

  it('a_small_test_file_is_read_and_the_suite_outline_is_mentioned_once', () =>
    withWorkspace({ 'test/a.test.ts': SPEC, 'test/b.test.ts': SPEC }, async (dir) => {
      const hook = new CodeOutlineGate(dir)
      expect(await hook.preToolUse(read('test/a.test.ts'))).toBeUndefined()
      const after = (path: string) => hook.postToolUse({ ...read(path), output: SPEC, isError: false })
      expect((await after('test/a.test.ts'))?.additionalContext).toContain('CodeOutline')
      expect(await after('test/b.test.ts')).toBeUndefined()
    }))

  it('a_long_file_with_nothing_to_outline_is_read_untouched', () =>
    withWorkspace({ 'src/big.ts': Array.from({ length: 300 }, (_, i) => `export const a${i} = ${i}`).join('\n') }, async (dir) => {
      const hook = new CodeOutlineGate(dir)
      expect(await hook.preToolUse(read('src/big.ts'))).toBeUndefined()
      expect(await hook.postToolUse({ ...read('src/big.ts'), output: '', isError: false })).toBeUndefined()
    }))
})
