import { describe, expect, it } from 'vitest'
import { formatUsage } from '../src/chat/webview/format-usage'

describe('formatUsage', () => {
  it('shows_fresh_input_and_cache_reads_separately_so_cached_context_is_not_mistaken_for_billable_input', () => {
    expect(formatUsage({ inputTokens: 45_210, outputTokens: 38_503, cacheReadTokens: 6_534_014, cacheWriteTokens: 0 })).toBe(
      '45.2K in · 6.5M cached / 38.5K out',
    )
  })

  it('omits_cached_when_the_engine_reports_no_cache_reads', () => {
    expect(formatUsage({ inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe('1.2K in / 300 out')
  })

  it('counts_cache_writes_as_fresh_input_since_they_are_billed_as_such', () => {
    expect(formatUsage({ inputTokens: 500, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 2000 })).toBe('2.5K in / 10 out')
  })
})
