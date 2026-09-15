import { describe, expect, it } from 'vitest'
import { findConventions, renderConvention } from '../src/agent/repo-map/conventions'

const features = ['Orders', 'Users', 'Billing', 'Shipping', 'Carts', 'Search', 'Admin', 'Reports', 'Imports', 'Exports', 'Alerts', 'Audit', 'Files', 'Mail']

/** 14 features with an endpoint in the feature folder, one with it somewhere else. */
const tree = [
  ...features.map((f) => `src/${f}/Endpoint.cs`),
  'src/legacy/api/Endpoint.cs',
  ...features.map((f) => `src/${f}/Handler.cs`),
]

describe('folder conventions', () => {
  it('a_convention_is_a_fact_from_the_tree_with_the_count_it_rests_on', () => {
    const conventions = findConventions(tree)
    const endpoints = conventions.find((c) => c.subject === 'Endpoint.cs')
    expect(endpoints).toEqual({ subject: 'Endpoint.cs', place: 'src/<Feature>/', matches: 14, total: 15 })
    expect(renderConvention(endpoints!)).toBe('- `Endpoint.cs` lives in `src/<Feature>/` — 14 of 15')
  })

  it('a_pattern_with_too_few_files_or_with_counterexamples_past_the_threshold_is_left_out_entirely', () => {
    const thin = findConventions(['src/Orders/Endpoint.cs', 'src/Users/Endpoint.cs', 'src/a.ts', 'src/b.ts', 'lib/c.ts'])
    expect(thin.some((c) => c.subject === 'Endpoint.cs')).toBe(false)

    const contradicted = findConventions([
      'src/Orders/Endpoint.cs',
      'src/Users/Endpoint.cs',
      'src/Billing/Endpoint.cs',
      'src/Carts/Endpoint.cs',
      'api/Endpoint.cs',
      'tools/Endpoint.cs',
      'legacy/old/Endpoint.cs',
      'web/deep/nested/Endpoint.cs',
    ])
    const stated = contradicted.filter((c) => c.subject === 'Endpoint.cs')
    expect(stated).toEqual([])
    // Nothing hedged is written in its place either.
    expect(contradicted.map(renderConvention).join('\n')).not.toMatch(/Endpoint\.cs/)
  })

  it('conventions_are_derived_from_paths_alone_and_ordered_the_same_whatever_order_the_walk_returned', () => {
    const forward = findConventions(tree)
    const backward = findConventions([...tree].reverse())
    expect(backward).toEqual(forward)
    expect(forward.map(renderConvention)).toContain('- `*.cs` lives in `src/` — 29 of 29')
  })
})
