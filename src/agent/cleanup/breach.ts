/** What a unit is measured by: its code lines, or, for a function, its cognitive complexity. */
export type Measure = 'lines' | 'complexity'

/** One limit a unit went past. */
export type Breach = { measure: Measure; value: number; limit: number }

/** `complexity 22, limit 15; 70 lines, limit 60`, as the cleanup run and the Cleanup tab read it. Shared with the webview, so no Node imports. */
export function describeBreaches(breaches: Breach[]): string {
  return breaches.map((b) => (b.measure === 'complexity' ? `complexity ${b.value}, limit ${b.limit}` : `${b.value} lines, limit ${b.limit}`)).join('; ')
}
