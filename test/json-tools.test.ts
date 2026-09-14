import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { jsonQueryTool, jsonSchemaTool } from '../src/agent/openai-session/tools/json'
import { ExpressionError, applyStages, parseExpression, parsePath } from '../src/agent/openai-session/tools/json/expr'
import { ValueBuilder } from '../src/agent/openai-session/tools/json/loader'
import { clipStrings, fitRows } from '../src/agent/openai-session/tools/json/output'
import { JsonSyntaxError, JsonTokenizer, LongString, formatPath } from '../src/agent/openai-session/tools/json/scanner'
import { ShapeBuilder } from '../src/agent/openai-session/tools/json/shape'
import { ReadTracker } from '../src/agent/openai-session/tools/read-tracker'
import { toDefinition, type ToolContext, type ToolOutput } from '../src/agent/openai-session/tools/tool'

const FIXTURES = resolve(import.meta.dirname, 'fixtures-json')
const ctx: ToolContext = { cwd: FIXTURES, signal: new AbortController().signal, files: new ReadTracker() }

function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

function payload(result: ToolOutput): any {
  expect(result.isError, result.text).toBe(false)
  return JSON.parse(result.text)
}

function errorText(result: ToolOutput): string {
  expect(result.isError).toBe(true)
  return result.text
}

/** Run text through the tokenizer in the given chunks and rebuild the value. */
function tokenizeToValue(chunks: string[]): unknown {
  const builder = new ValueBuilder('inline')
  const tokenizer = new JsonTokenizer({ onToken: (token) => builder.add(token) })
  for (const chunk of chunks) tokenizer.write(chunk)
  tokenizer.end()
  return builder.value
}

describe('scanner', () => {
  it('produces_the_same_value_regardless_of_where_the_input_is_split', () => {
    for (const fixture of ['orders.json', 'tricky.json', 'many.json']) {
      const text = fixtureText(fixture)
      const expected = JSON.parse(text)
      for (let split = 0; split <= text.length; split++) {
        expect(tokenizeToValue([text.slice(0, split), text.slice(split)]), `${fixture} split at ${split}`).toEqual(expected)
      }
    }
  })

  it('survives_a_multi_byte_character_split_across_stream_chunks', () => {
    const bytes = readFileSync(join(FIXTURES, 'tricky.json'))
    const expected = JSON.parse(bytes.toString('utf8'))
    for (let split = 0; split <= bytes.length; split++) {
      const decoder = new StringDecoder('utf8')
      const first = decoder.write(bytes.subarray(0, split))
      const second = decoder.write(bytes.subarray(split)) + decoder.end()
      expect(tokenizeToValue([first, second]), `byte split at ${split}`).toEqual(expected)
    }
  })

  it('clips_a_huge_string_but_reports_its_true_length', () => {
    const value = tokenizeToValue([`{"s":"${'x'.repeat(70_000)}"}`]) as { s: LongString }
    expect(value.s).toBeInstanceOf(LongString)
    expect(value.s.totalLength).toBe(70_000)
    expect(value.s.text.length).toBe(64 * 1024)
  })

  it('names_the_character_and_the_path_when_the_document_is_malformed', () => {
    expect(() => tokenizeToValue([`{"orders":[{"id":1,}]}`])).toThrowError(JsonSyntaxError)
    try {
      tokenizeToValue([`{"a":{"b":tru}}`])
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as JsonSyntaxError).jsonPath).toBe('$.a.b')
      expect((err as JsonSyntaxError).message).toContain('character')
    }
  })

  it('rejects_an_unfinished_document_and_trailing_content', () => {
    expect(() => tokenizeToValue([`{"a":[1,2`])).toThrowError(/unexpected end of input/)
    expect(() => tokenizeToValue([''])).toThrowError(/empty/)
    expect(() => tokenizeToValue([`{} {}`])).toThrowError(JsonSyntaxError)
  })

  it('formats_paths_the_way_a_caller_would_write_them', () => {
    expect(formatPath(['orders', 3, 'customer', 'name'])).toBe('$.orders[3].customer.name')
    expect(formatPath(['key with spaces'])).toBe('$["key with spaces"]')
  })
})

describe('expressions', () => {
  const item = {
    id: 'o-1',
    status: 'open',
    total: 120.5,
    customer: { name: 'Ada', city: 'Stockholm' },
    tags: ['rush', 'paid'],
  }

  function keep(expr: string, value: unknown = item): boolean {
    return applyStages(value, parseExpression(expr).stages).kept
  }

  it('splits_a_path_into_streamable_steps', () => {
    expect(parseExpression('$.orders[*].lines[0]').path).toEqual([
      { kind: 'key', name: 'orders' },
      { kind: 'wildcard' },
      { kind: 'key', name: 'lines' },
      { kind: 'index', index: 0 },
    ])
  })

  it('points_at_the_character_that_broke_the_expression', () => {
    try {
      parseExpression('$.orders[*] | select(.total > )')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ExpressionError)
      expect((err as ExpressionError).offset).toBe('$.orders[*] | select(.total > '.length)
      expect((err as ExpressionError).message).toContain('expected a value')
    }
    expect(() => parseExpression('$.a | sum')).toThrowError(/unknown stage "sum"/)
    expect(() => parseExpression('$.a | select(.b[*] == 1)')).toThrowError(/only allowed in the leading path/)
  })

  it('compares_and_combines_conditions', () => {
    expect(keep('$ | select(.total > 100)')).toBe(true)
    expect(keep('$ | select(.total > 900)')).toBe(false)
    expect(keep('$ | select(.status == "open")')).toBe(true)
    expect(keep('$ | select(.total > 100 and .status == "open")')).toBe(true)
    expect(keep('$ | select(.total > 900 or .status == "open")')).toBe(true)
    expect(keep('$ | select(not .status == "open")')).toBe(false)
    expect(keep('$ | select((.total < 10 or .total > 100) and .customer.city == "Stockholm")')).toBe(true)
  })

  it('matches_substrings_and_array_membership', () => {
    expect(keep('$ | select(.customer.city contains "holm")')).toBe(true)
    expect(keep('$ | select(.id startswith "o-")')).toBe(true)
    expect(keep('$ | select(.id endswith "-9")')).toBe(false)
    expect(keep('$ | select(.tags contains "paid")')).toBe(true)
    expect(keep('$ | select(.tags contains "late")')).toBe(false)
  })

  it('separates_a_missing_key_from_a_stored_null_and_never_orders_across_types', () => {
    expect(keep('$ | select(.note missing)')).toBe(true)
    expect(keep('$ | select(.note exists)')).toBe(false)
    expect(keep('$ | select(.note == null)', { note: null })).toBe(true)
    expect(keep('$ | select(.note exists)', { note: null })).toBe(true)
    expect(keep('$ | select(.status > 5)')).toBe(false)
    expect(keep('$ | select(.missing > 5)')).toBe(false)
  })

  it('projects_named_and_nested_fields_reporting_absent_ones_as_null', () => {
    expect(applyStages(item, parseExpression('$ | {id, customer.name, city: .customer.city}').stages).value).toEqual({
      id: 'o-1',
      'customer.name': 'Ada',
      city: 'Stockholm',
    })
    expect(applyStages(item, parseExpression('$ | {id, missing: .nope.deeper}').stages).value).toEqual({ id: 'o-1', missing: null })
  })

  it('returns_keys_values_and_length', () => {
    expect(applyStages(item, parseExpression('$ | keys').stages).value).toEqual(['id', 'status', 'total', 'customer', 'tags'])
    expect(applyStages(item.tags, parseExpression('$ | length').stages).value).toBe(2)
    expect(applyStages(item.id, parseExpression('$ | length').stages).value).toBe(3)
    expect(applyStages(item, parseExpression('$ | length').stages).value).toBe(5)
    expect(applyStages(item.customer, parseExpression('$ | values').stages).value).toEqual(['Ada', 'Stockholm'])
  })

  it('reads_a_standalone_path_in_either_notation', () => {
    expect(parsePath('.customer.name', 'value')).toEqual(parsePath('customer.name', 'value'))
    expect(parsePath('$.customer.name', 'value')).toEqual(parsePath('.customer.name', 'value'))
  })
})

describe('output caps', () => {
  it('clips_a_long_string_and_states_how_long_it_really_is', () => {
    expect(clipStrings({ s: 'abcdefghij' }, 4)).toEqual({ s: 'abcd...[len=10]' })
    expect(clipStrings(new LongString('abcd', 9000), 4)).toBe('abcd...[len=9000]')
    expect(clipStrings({ s: 'abc', n: 1, b: null }, 200)).toEqual({ s: 'abc', n: 1, b: null })
  })

  it('stops_adding_rows_at_the_byte_budget_but_always_keeps_one', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ i, pad: 'x'.repeat(50) }))
    const fitted = fitRows(rows, 500)
    expect(fitted.kept.length).toBeLessThan(100)
    expect(fitted.kept.length + fitted.omitted).toBe(100)
    const single = fitRows([{ pad: 'x'.repeat(5000) }, { pad: 'y' }], 100)
    expect(single.kept).toHaveLength(1)
    expect(single.omitted).toBe(1)
  })
})

describe('JsonSchema', () => {
  it('describes_structure_without_returning_the_data', async () => {
    const result = payload(await jsonSchemaTool.execute({ file_path: 'orders.json', depth: 3 }, ctx))
    expect(result.shape.type).toBe('object')
    expect(result.shape.keys.orders.type).toBe('array')
    expect(result.shape.keys.orders.length).toBe(5)
    const keys = result.shape.keys.orders.items.keys
    expect(keys.id.type).toBe('string')
    expect(keys.note.optional).toBe(true)
    expect(keys.id.optional).toBeUndefined()
    expect(keys.total.type).toBe('number|null')
    expect(result.truncated).toBeNull()
  })

  it('counts_every_array_element_while_only_sampling_their_shape', async () => {
    const result = payload(await jsonSchemaTool.execute({ file_path: 'many.json', depth: 3 }, ctx))
    expect(result.shape.keys.values.length).toBe(30)
    expect(result.shape.keys.values.items_sampled).toBe(20)
    expect(result.shape.keys.mixed.items.type).toBe('number|string|null|boolean')
  })

  it('counts_a_huge_array_without_holding_it', () => {
    const builder = new ShapeBuilder(3)
    const tokenizer = new JsonTokenizer({ onToken: (token) => builder.handle(token) })
    tokenizer.write('[')
    for (let i = 0; i < 50_000; i++) tokenizer.write(i === 0 ? '1' : ',1')
    tokenizer.write(']')
    tokenizer.end()
    const shape = builder.render(3, true) as { type: string; length: number }
    expect(shape.type).toBe('array')
    expect(shape.length).toBe(50_000)
  })

  it('marks_where_the_depth_limit_cut_the_tree_off_and_goes_deeper_when_asked', async () => {
    const shallow = payload(await jsonSchemaTool.execute({ file_path: 'tricky.json', depth: 2 }, ctx))
    expect(shallow.shape.keys.deep.keys.a.truncated).toBe('depth')
    expect(shallow.shape.keys.deep.keys.a.keys).toBeUndefined()
    const deep = payload(await jsonSchemaTool.execute({ file_path: 'tricky.json', depth: 6 }, ctx))
    expect(deep.shape.keys.deep.keys.a.keys.b.keys.c.keys.d.keys.e.type).toBe('string')
  })

  it('returns_no_example_values_when_sample_is_0', async () => {
    const withSamples = payload(await jsonSchemaTool.execute({ file_path: 'orders.json' }, ctx))
    const without = payload(await jsonSchemaTool.execute({ file_path: 'orders.json', sample: 0 }, ctx))
    expect(withSamples.shape.keys.generated.sample).toBe('2026-08-01T09:00:00Z')
    expect(without.shape.keys.generated.sample).toBeUndefined()
  })

  it('summarises_a_jsonl_file_as_the_array_of_records_it_behaves_like', async () => {
    const result = payload(await jsonSchemaTool.execute({ file_path: 'events.jsonl' }, ctx))
    expect(result.format).toBe('jsonl')
    expect(result.shape.type).toBe('array')
    expect(result.shape.length).toBe(4)
    expect(result.shape.items.keys.level.type).toBe('string')
  })

  it('accepts_an_absolute_path', async () => {
    const result = payload(await jsonSchemaTool.execute({ file_path: join(FIXTURES, 'orders.json') }, ctx))
    expect(result.shape.keys.orders.length).toBe(5)
  })
})

describe('JsonQuery', () => {
  it('returns_the_selected_rows_with_their_paths', async () => {
    const result = payload(
      await jsonQueryTool.execute({ file_path: 'orders.json', expr: '$.orders[*] | select(.status == "open") | {id, total}' }, ctx),
    )
    expect(result.matched).toBe(3)
    expect(result.returned).toBe(3)
    expect(result.rows.map((r: any) => r.value.id)).toEqual(['o-1', 'o-3', 'o-4'])
    expect(result.rows[0].path).toBe('$.orders[0]')
    expect(result.truncated).toBeNull()
  })

  it('selects_leaves_under_a_wildcard_and_by_index', async () => {
    const names = payload(await jsonQueryTool.execute({ file_path: 'orders.json', expr: '$.orders[*].customer.name' }, ctx))
    expect(names.rows.map((r: any) => r.value)).toEqual(['Ada', 'Grace', 'Linus', 'Tove', 'Nils'])
    const one = payload(await jsonQueryTool.execute({ file_path: 'orders.json', expr: '$.orders[1].id' }, ctx))
    expect(one.rows.map((r: any) => r.value)).toEqual(['o-2'])
    const none = payload(await jsonQueryTool.execute({ file_path: 'orders.json', expr: '$.invoices[*]' }, ctx))
    expect(none.rows).toEqual([])
  })

  it('reports_the_true_match_count_when_the_limit_cuts_the_rows_short', async () => {
    const result = payload(await jsonQueryTool.execute({ file_path: 'orders.json', expr: '$.orders[*]', limit: 2 }, ctx))
    expect(result.matched).toBe(5)
    expect(result.returned).toBe(2)
    expect(result.truncated).toEqual({ reason: 'limit', rows_omitted: 3 })
  })

  it('clips_long_strings_and_reports_their_real_length', async () => {
    const result = payload(await jsonQueryTool.execute({ file_path: 'orders.json', expr: '$.source', max_string: 20 }, ctx))
    expect(result.rows[0].value).toBe('warehouse export "ni...[len=26]')
  })

  it('filters_jsonl_records_and_names_the_line_when_one_is_malformed', async () => {
    const result = payload(await jsonQueryTool.execute({ file_path: 'events.jsonl', expr: '$[*] | select(.level == "error") | {id, ms}' }, ctx))
    expect(result.matched).toBe(2)
    expect(result.rows.map((r: any) => r.value.id)).toEqual([2, 4])
    const broken = errorText(await jsonQueryTool.execute({ file_path: 'broken.jsonl', expr: '$[*]' }, ctx))
    expect(broken).toMatch(/broken\.jsonl: line 2 is not valid JSON/)
  })

  it('says_the_expression_is_broken_and_where', async () => {
    const text = errorText(await jsonQueryTool.execute({ file_path: 'orders.json', expr: '$.orders[*] | select(.a' }, ctx))
    expect(text).toContain('character')
  })

  it('missing_file_is_a_tool_error_not_an_exception', async () => {
    const text = errorText(await jsonQueryTool.execute({ file_path: 'nope.json', expr: '$' }, ctx))
    expect(text).toContain('nope.json')
    expect(text).toContain('not found')
  })
})

describe('tool definitions', () => {
  it('json_tools_are_read_only_and_require_a_file_path', () => {
    expect(jsonSchemaTool.readOnly).toBe(true)
    expect(jsonQueryTool.readOnly).toBe(true)
    expect(toDefinition(jsonSchemaTool).parameters['required']).toEqual(['file_path'])
    expect(toDefinition(jsonQueryTool).parameters['required']).toEqual(['file_path', 'expr'])
  })
})
