import type { TurnUsage } from '../../agent/session/code-session'

/** Cache reads are billed at a fraction of fresh input, so they are shown apart from "in" rather than summed into it. */
export function formatUsage(usage: TurnUsage): string {
  const fresh = usage.inputTokens + usage.cacheWriteTokens
  const input = usage.cacheReadTokens > 0 ? `${compact(fresh)} in · ${compact(usage.cacheReadTokens)} cached` : `${compact(fresh)} in`
  return `${input} / ${compact(usage.outputTokens)} out`
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}
