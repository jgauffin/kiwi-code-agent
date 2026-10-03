import { describe, expect, it } from 'vitest'
import { withWorkspace } from './workspace-fixture'
import { specSearchTool } from '../src/agent/phases/spec-search'
import { ReadTracker } from '../src/agent/openai-session/tools/read-tracker'
import type { ToolContext } from '../src/agent/openai-session/tools/tool'

const ORDERS = `---
feature: Order cancellation
status: approved
---

# Order cancellation

## Goal
A customer can cancel an order until it ships.

## Cancelling an order
- **Cancel command**: an open order can be cancelled by its customer (docs/intent/orders.md#Cancellation)
  - **Shipped order**: a shipped order is refused
  - **Old rule**: something no longer meant [removed]
- **Refund on cancel**: a cancelled order is refunded in full

## Open questions
- **Partial refunds**: may a part of an order be refunded on cancel
`

const RETURNS = `---
feature: Returns
status: draft
---

# Returns

## Goal
A customer returns what they no longer want.

## Returning an item
- **Return window**: an item can be returned within thirty days of delivery
- **Gone rule**: a return is refunded [removed]
`

const withSpecs = <T>(files: Record<string, string>, fn: (ctx: ToolContext) => Promise<T>): Promise<T> =>
  withWorkspace(files, (dir) => fn({ cwd: dir, signal: new AbortController().signal, files: new ReadTracker() }))

const search = async (ctx: ToolContext, input: Parameters<ReturnType<typeof specSearchTool>['execute']>[0], canRead?: (rel: string) => boolean) => {
  const result = await specSearchTool(canRead).execute(input, ctx)
  expect(result.isError, result.text).toBe(false)
  return result
}

describe('SpecSearch', () => {
  it('a_match_returns_the_whole_rule_with_its_scenario_status_citation_and_live_edge_cases', async () => {
    await withSpecs({ 'specs/order-cancellation.spec.md': ORDERS }, async (ctx) => {
      const { text } = await search(ctx, { query: 'cancelled by' })
      expect(text).toContain('specs/order-cancellation.spec.md: Order cancellation [approved]')
      expect(text).toContain('  ## Cancelling an order\n  - **Cancel command**: an open order can be cancelled by its customer (docs/intent/orders.md#Cancellation)\n    - **Shipped order**: a shipped order is refused')
      expect(text).not.toContain('Old rule')
      expect(text).not.toContain('Refund on cancel')
    })
  })

  it('a_match_in_an_edge_case_returns_the_rule_it_qualifies', async () => {
    await withSpecs({ 'specs/order-cancellation.spec.md': ORDERS }, async (ctx) => {
      const { items } = await search(ctx, { query: 'shipped order is refused' })
      expect(items).toEqual([expect.objectContaining({ kind: 'rule', name: 'Cancel command', scenario: 'Cancelling an order' })])
    })
  })

  it('a_citation_finds_the_rules_that_cite_a_heading', async () => {
    await withSpecs({ 'specs/order-cancellation.spec.md': ORDERS }, async (ctx) => {
      const { items } = await search(ctx, { query: 'orders.md#Cancellation' })
      expect(items).toEqual([expect.objectContaining({ name: 'Cancel command', citation: 'docs/intent/orders.md#Cancellation' })])
    })
  })

  it('goals_and_open_questions_match_too', async () => {
    await withSpecs({ 'specs/order-cancellation.spec.md': ORDERS }, async (ctx) => {
      const { items, text } = await search(ctx, { query: 'refund' })
      expect((items as { kind: string; name: string | null }[]).map((m) => [m.kind, m.name])).toEqual([
        ['rule', 'Refund on cancel'],
        ['question', 'Partial refunds'],
      ])
      expect(text).toContain('  ## Open questions\n  - **Partial refunds**:')
      expect((await search(ctx, { query: 'until it ships' })).text).toContain('  goal: A customer can cancel an order until it ships.')
    })
  })

  it('approved_rules_come_before_a_drafts_and_removed_rules_never_match', async () => {
    await withSpecs({ 'specs/a-returns.spec.md': RETURNS, 'specs/order-cancellation.spec.md': ORDERS }, async (ctx) => {
      const { items } = await search(ctx, { query: 'customer' })
      expect((items as { file: string }[]).map((m) => m.file)).toEqual([
        'specs/order-cancellation.spec.md',
        'specs/order-cancellation.spec.md',
        'specs/a-returns.spec.md',
      ])
      expect((await search(ctx, { query: 'is refunded' })).items).toEqual([expect.objectContaining({ name: 'Refund on cancel' })])
    })
  })

  it('only_specs_the_phase_may_read_are_searched', async () => {
    await withSpecs({ 'specs/a-returns.spec.md': RETURNS, 'specs/order-cancellation.spec.md': ORDERS }, async (ctx) => {
      const { text } = await search(ctx, { query: 'customer' }, (rel) => rel !== 'specs/a-returns.spec.md')
      expect(text).not.toContain('Returns')
    })
  })

  it('a_workspace_without_specs_says_so', async () => {
    await withSpecs({}, async (ctx) => {
      expect((await search(ctx, { query: 'x' })).text).toBe('No specs under specs/ yet.')
    })
  })

  it('the_limit_cuts_what_is_shown_not_what_a_script_gets', async () => {
    await withSpecs({ 'specs/order-cancellation.spec.md': ORDERS }, async (ctx) => {
      const { text, items } = await search(ctx, { query: 'order', limit: 1 })
      expect(items!.length).toBeGreaterThan(1)
      expect(text).toContain(`${items!.length} matches in 1 spec searched, 1 shown from 1.`)
    })
  })
})
