import { describe, expect, it } from 'vitest'
import { acceptProposals, assertRulingsSent, decisions, openDecisions, pendingDecisions, withRuling } from '../src/agent/phases/decisions'

const spec = `---
status: draft
---
# Order cancellation

## Cancelling
- **Cancel command**: an order can be cancelled

## Decisions
### Shipped orders cannot be cancelled
- on: Cancel command
- finding: OrderService.Cancel refuses shipped orders; the rule says any order
- proposed: the rule says an unshipped order

### The daily report counts cancelled orders [withdrawn]
- on: Cancel command
- finding: the report still counts them

### Refunds are asynchronous
- on: Cancel command, Refund
- finding: refunds are queued, the rule says refunded on cancel

### Reservations are released by a job [applied]
- on: Refund
- finding: a job releases them nightly
- proposed: say the reservation is released when the job runs
- ruling: accepted
`

describe('decisions', () => {
  it('a_decision_is_open_until_ruled_and_settled_once_applied_or_withdrawn', () => {
    expect(decisions(spec).map((d) => [d.title, d.state, d.on, d.proposal, d.ruling])).toEqual([
      ['Shipped orders cannot be cancelled', 'open', ['Cancel command'], 'the rule says an unshipped order', undefined],
      ['The daily report counts cancelled orders', 'withdrawn', ['Cancel command'], '', undefined],
      ['Refunds are asynchronous', 'open', ['Cancel command', 'Refund'], '', undefined],
      ['Reservations are released by a job', 'applied', ['Refund'], 'say the reservation is released when the job runs', 'accepted'],
    ])
    expect(decisions(spec)[0]!.finding).toBe('OrderService.Cancel refuses shipped orders; the rule says any order')
    expect(openDecisions(spec).map((d) => d.title)).toEqual(['Shipped orders cannot be cancelled', 'Refunds are asynchronous'])
    const ruled = withRuling(spec, 'Refunds are asynchronous', 'keep the rule, queue the refund')
    expect(openDecisions(ruled).map((d) => d.title)).toEqual(['Shipped orders cannot be cancelled'])
    expect(pendingDecisions(ruled).map((d) => d.title)).toEqual(['Shipped orders cannot be cancelled', 'Refunds are asynchronous'])
  })

  it('approval_is_refused_while_a_decision_is_pending_and_names_how_many', () => {
    expect(() => assertRulingsSent(spec)).toThrow('Send the rulings first: 2 decisions are pending.')
    // A ruled decision is still pending: the planner has yet to apply it.
    const oneRuled = '## Decisions\n### Refunds are asynchronous\n- on: Refund\n- finding: queued\n- ruling: queue it\n'
    expect(() => assertRulingsSent(oneRuled)).toThrow('Send the rulings first: a decision is pending.')
    expect(() => assertRulingsSent('# Orders\n\n## Cancelling\n- **A**: x\n')).not.toThrow()
  })

  it('a_spec_without_the_section_has_no_decisions', () => {
    expect(decisions('# Orders\n\n## Cancelling\n- **A**: x\n')).toEqual([])
    expect(decisions('## Tasks\n### Not a decision\n- finding: no\n')).toEqual([])
  })

  it('a_ruling_lands_under_the_proposal_and_a_second_one_replaces_it_until_applied', () => {
    const once = withRuling(spec, 'Shipped orders cannot be cancelled', 'accepted')
    expect(once).toContain('- proposed: the rule says an unshipped order\n- ruling: accepted\n\n### The daily report')
    const twice = withRuling(once, 'Shipped orders cannot be cancelled', 'the rule stands; fix the code')
    expect(twice).toContain('- proposed: the rule says an unshipped order\n- ruling: the rule stands; fix the code\n\n### The daily report')
    expect(twice).not.toContain('- ruling: accepted\n\n### The daily report')
    // A decision without a proposal takes a ruling too; the user may rule ahead of the planner.
    expect(withRuling(spec, 'Refunds are asynchronous', 'queue it')).toContain(
      '- finding: refunds are queued, the rule says refunded on cancel\n- ruling: queue it\n',
    )
    expect(() => withRuling(spec, 'Reservations are released by a job', 'no')).toThrow(/applied/)
    expect(() => withRuling(spec, 'The daily report counts cancelled orders', 'no')).toThrow(/withdrawn/)
    expect(() => withRuling(spec, 'Nope', 'no')).toThrow(/Nope/)
    expect(() => withRuling(spec, 'Refunds are asynchronous', '  ')).toThrow(/text/)
  })

  it('accepting_the_proposals_rules_accepted_on_every_open_decision_that_has_one', () => {
    const { text, accepted } = acceptProposals(spec)
    expect(accepted).toEqual(['Shipped orders cannot be cancelled'])
    expect(decisions(text).map((d) => d.state)).toEqual(['ruled', 'withdrawn', 'open', 'applied'])
    expect(acceptProposals(text)).toEqual({ text, accepted: [] })
  })
})
