import { describe, expect, it } from 'vitest'
import { withWorkspace } from './workspace-fixture'
import { markdownSearchTool } from '../src/agent/openai-session/tools/markdown-search'
import { ReadTracker } from '../src/agent/openai-session/tools/read-tracker'
import type { ToolContext } from '../src/agent/openai-session/tools/tool'

const withDocs = <T>(files: Record<string, string>, fn: (ctx: ToolContext) => Promise<T>): Promise<T> =>
  withWorkspace(files, (dir) => fn({ cwd: dir, signal: new AbortController().signal, files: new ReadTracker() }))

const ORDERS = `Orders may be cancelled, says the intro.

# Orders

## Placing an order

A placed order reserves stock.

### Reserving stock

A reservation is held for 15 minutes; a cancelled order releases it.

## Cancelling

An order may be cancelled until it ships (see path#Heading).
`

const search = async (ctx: ToolContext, input: Parameters<ReturnType<typeof markdownSearchTool>['execute']>[0], canRead?: (rel: string) => boolean) => {
  const result = await markdownSearchTool(canRead).execute(input, ctx)
  expect(result.isError, result.text).toBe(false)
  return result.text
}

describe('MarkdownSearch', () => {
  it('search_names_the_closest_heading_above_each_match', async () => {
    await withDocs({ 'docs/orders.md': ORDERS }, async (ctx) => {
      const text = await search(ctx, { query: 'cancelled', path: 'docs' })
      expect(text).toContain('docs/orders.md#Reserving stock  (9-12)\n  11: A reservation is held')
      expect(text).toContain('docs/orders.md#Cancelling  (13-15)\n  15: An order may be cancelled')
    })
  })

  it('a_script_gets_each_match_with_its_section_as_data', async () => {
    await withDocs({ 'docs/orders.md': ORDERS }, async (ctx) => {
      const result = await markdownSearchTool().execute({ query: 'intro|ships', regex: true }, ctx)
      expect(result.items).toEqual([
        { file: 'docs/orders.md', line: 1, text: 'Orders may be cancelled, says the intro.', heading: null, start: null, end: null },
        { file: 'docs/orders.md', line: 15, text: 'An order may be cancelled until it ships (see path#Heading).', heading: 'Cancelling', start: 13, end: 15 },
      ])
    })
  })

  it('match_before_any_heading_names_the_file', async () => {
    await withDocs({ 'docs/orders.md': ORDERS }, async (ctx) => {
      const text = await search(ctx, { query: 'intro' })
      expect(text).toContain('docs/orders.md (before first heading)  (1-2)\n  1: Orders may be cancelled')
    })
  })

  it('query_is_literal_unless_regex_is_asked_for', async () => {
    await withDocs({ 'docs/orders.md': ORDERS }, async (ctx) => {
      expect(await search(ctx, { query: 'path#Heading)' })).toContain('15: ')
      expect(await search(ctx, { query: 'held for \\d+' })).toBe('No matches in 1 markdown file.')
      expect(await search(ctx, { query: 'held for \\d+', regex: true })).toContain('11: ')
    })
  })

  it('case_is_ignored_unless_asked_for', async () => {
    await withDocs({ 'docs/orders.md': ORDERS }, async (ctx) => {
      expect(await search(ctx, { query: 'AN ORDER' })).toContain('15: ')
      expect(await search(ctx, { query: 'AN ORDER', case_sensitive: true })).toBe('No matches in 1 markdown file.')
    })
  })

  it('search_reports_total_matches_next_to_those_shown', async () => {
    await withDocs({ 'docs/orders.md': ORDERS }, async (ctx) => {
      const text = await search(ctx, { query: 'cancelled', limit: 1 })
      expect(text).toContain('3 matches in 3 sections, 1 shown.')
      expect(text).not.toContain('11: ')
    })
  })

  it('only_markdown_files_are_searched', async () => {
    await withDocs({ 'docs/orders.md': ORDERS, 'docs/orders.txt': 'cancelled', 'src/order.ts': '// cancelled' }, async (ctx) => {
      const text = await search(ctx, { query: 'cancelled' })
      expect(text).not.toContain('orders.txt')
      expect(text).not.toContain('order.ts')
    })
  })

  it('search_skips_files_the_phase_may_not_read', async () => {
    await withDocs({ 'docs/orders.md': ORDERS, 'docs/api/secret.md': 'cancelled in secret' }, async (ctx) => {
      const text = await search(ctx, { query: 'cancelled', path: 'docs' }, (rel) => !rel.startsWith('docs/api/'))
      expect(text).toContain('docs/orders.md')
      expect(text).not.toContain('secret')
    })
  })

  it('an_invalid_regex_is_reported_not_thrown', async () => {
    await withDocs({ 'docs/orders.md': ORDERS }, async (ctx) => {
      const result = await markdownSearchTool().execute({ query: '(', regex: true }, ctx)
      expect(result.isError).toBe(true)
      expect(result.text).toContain('Invalid regular expression')
    })
  })
})
