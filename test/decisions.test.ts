import { describe, expect, it } from 'vitest'
import {
  assertAllRuled,
  assertRulingsSent,
  decisions,
  decisionsFile,
  openDecisions,
  pendingDecisions,
  rulingKind,
  withRuling,
} from '../src/agent/phases/decisions'

const file = `# Decisions for Order cancellation

### Shipped orders cannot be cancelled
- on: Cancel command
- finding: OrderService.Cancel refuses shipped orders; the rule says any order
- proposed: the rule says an unshipped order
- proposed: a shipped order is cancelled and returned

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
- ruling: say the reservation is released when the job runs
`

describe('decisions', () => {
  it('a_decision_is_open_until_ruled_and_settled_once_applied_or_withdrawn', () => {
    expect(decisions(file).map((d) => [d.title, d.state, d.on, d.proposals, d.ruling])).toEqual([
      [
        'Shipped orders cannot be cancelled',
        'open',
        ['Cancel command'],
        ['the rule says an unshipped order', 'a shipped order is cancelled and returned'],
        undefined,
      ],
      ['The daily report counts cancelled orders', 'withdrawn', ['Cancel command'], [], undefined],
      ['Refunds are asynchronous', 'open', ['Cancel command', 'Refund'], [], undefined],
      [
        'Reservations are released by a job',
        'applied',
        ['Refund'],
        ['say the reservation is released when the job runs'],
        'say the reservation is released when the job runs',
      ],
    ])
    expect(decisions(file)[0]!.finding).toBe('OrderService.Cancel refuses shipped orders; the rule says any order')
    expect(openDecisions(decisions(file)).map((d) => d.title)).toEqual(['Shipped orders cannot be cancelled', 'Refunds are asynchronous'])
    const ruled = decisions(withRuling(file, 'Refunds are asynchronous', 'keep the rule, queue the refund'))
    expect(openDecisions(ruled).map((d) => d.title)).toEqual(['Shipped orders cannot be cancelled'])
    expect(pendingDecisions(ruled).map((d) => d.title)).toEqual(['Shipped orders cannot be cancelled', 'Refunds are asynchronous'])
  })

  it('approval_is_refused_while_a_decision_is_pending_and_names_how_many', () => {
    expect(() => assertRulingsSent(decisions(file))).toThrow('Send the rulings first: 2 decisions are pending.')
    // A ruled decision is still pending: the planner has yet to apply it.
    const oneRuled = '### Refunds are asynchronous\n- on: Refund\n- finding: queued\n- ruling: queue it\n'
    expect(() => assertRulingsSent(decisions(oneRuled))).toThrow('Send the rulings first: a decision is pending.')
    expect(() => assertRulingsSent([])).not.toThrow()
  })

  it('the_handover_waits_for_every_open_decision_since_there_is_no_default_among_several_options', () => {
    expect(() => assertAllRuled(decisions(file))).toThrow('Rule on the 2 open decisions first.')
    const oneLeft = withRuling(file, 'Refunds are asynchronous', 'keep')
    expect(() => assertAllRuled(decisions(oneLeft))).toThrow('Rule on the open decision first.')
    expect(() => assertAllRuled(decisions(withRuling(oneLeft, 'Shipped orders cannot be cancelled', 'keep')))).not.toThrow()
  })

  it('a_file_without_decisions_or_a_missing_one_has_none', () => {
    expect(decisions('# Decisions for Orders\n')).toEqual([])
    expect(decisions('')).toEqual([])
    expect(decisionsFile('Order cancellation')).toBe('plan/order-cancellation.decisions.md')
  })

  it('a_ruling_lands_under_the_proposals_and_a_second_one_replaces_it_until_applied', () => {
    const once = withRuling(file, 'Shipped orders cannot be cancelled', 'keep')
    expect(once).toContain('- proposed: a shipped order is cancelled and returned\n- ruling: keep\n\n### The daily report')
    const twice = withRuling(once, 'Shipped orders cannot be cancelled', 'the rule stands; fix the code')
    expect(twice).toContain('- proposed: a shipped order is cancelled and returned\n- ruling: the rule stands; fix the code\n\n### The daily report')
    expect(twice).not.toContain('- ruling: keep\n\n### The daily report')
    // A decision without a proposal takes a ruling too; the user may rule ahead of the planner.
    expect(withRuling(file, 'Refunds are asynchronous', 'queue it')).toContain(
      '- finding: refunds are queued, the rule says refunded on cancel\n- ruling: queue it\n',
    )
    expect(() => withRuling(file, 'Reservations are released by a job', 'no')).toThrow(/applied/)
    expect(() => withRuling(file, 'The daily report counts cancelled orders', 'no')).toThrow(/withdrawn/)
    expect(() => withRuling(file, 'Nope', 'no')).toThrow(/Nope/)
    expect(() => withRuling(file, 'Refunds are asynchronous', '  ')).toThrow(/text/)
  })

  it('a_ruling_is_keep_a_chosen_proposal_or_the_users_own_words', () => {
    const [shipped] = decisions(file)
    expect(rulingKind(shipped!)).toBeUndefined()
    expect(rulingKind(decisions(withRuling(file, 'Shipped orders cannot be cancelled', 'Keep'))[0]!)).toBe('keep')
    expect(rulingKind(decisions(withRuling(file, 'Shipped orders cannot be cancelled', 'the rule says an unshipped order'))[0]!)).toBe('proposal')
    expect(rulingKind(decisions(withRuling(file, 'Shipped orders cannot be cancelled', 'cancel it, but keep the shipment'))[0]!)).toBe('own')
  })
})
