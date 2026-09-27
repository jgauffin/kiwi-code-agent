import { describe, expect, it } from 'vitest'
import {
  assertAllRuled,
  assertRulingsSent,
  compactApplied,
  decisions,
  decisionsFile,
  openDecisions,
  parseDecisions,
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
- recommended: 2
- because: the shipped order is the one the user is calling about

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
    expect(decisionsFile('Order cancellation')).toBe('.agent/plan/order-cancellation.decisions.md')
  })

  it('a_ruling_lands_under_the_proposals_and_a_second_one_replaces_it_until_applied', () => {
    const last = '- because: the shipped order is the one the user is calling about'
    const once = withRuling(file, 'Shipped orders cannot be cancelled', 'keep')
    expect(once).toContain(`${last}\n- ruling: keep\n\n### The daily report`)
    const twice = withRuling(once, 'Shipped orders cannot be cancelled', 'the rule stands; fix the code')
    expect(twice).toContain(`${last}\n- ruling: the rule stands; fix the code\n\n### The daily report`)
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

  it('a_recommendation_names_a_proposal_by_its_place_or_keeps_the_rule', () => {
    expect(decisions(file)[0]!.recommendation).toEqual({ choice: 2, because: 'the shipped order is the one the user is calling about' })
    // Nothing recommended: the user still has every option, just no argument for one.
    expect(decisions(file)[2]!.recommendation).toBeUndefined()
    const decision = (lines: string): string => `### Shipped\n- on: Cancel command\n- finding: it refuses\n- proposed: allow it\n${lines}`
    expect(decisions(decision('- recommended: keep\n'))[0]!.recommendation).toEqual({ choice: 'keep', because: '' })
    expect(decisions(decision('- recommended: 1\n- because: it is the smaller change\n'))[0]!.recommendation).toEqual({ choice: 1, because: 'it is the smaller change' })
    // A number with no proposal behind it would point at nothing, so it is reported rather than shown.
    const { decisions: parsed, problems } = parseDecisions(decision('- recommended: 3\n'))
    expect(parsed[0]!.recommendation).toBeUndefined()
    expect(problems[0]!.text).toContain('"3" recommends nothing')
  })

  it('a_ruling_is_keep_a_chosen_proposal_or_the_users_own_words', () => {
    const [shipped] = decisions(file)
    expect(rulingKind(shipped!)).toBeUndefined()
    expect(rulingKind(decisions(withRuling(file, 'Shipped orders cannot be cancelled', 'Keep'))[0]!)).toBe('keep')
    expect(rulingKind(decisions(withRuling(file, 'Shipped orders cannot be cancelled', 'the rule says an unshipped order'))[0]!)).toBe('proposal')
    expect(rulingKind(decisions(withRuling(file, 'Shipped orders cannot be cancelled', 'cancel it, but keep the shipment'))[0]!)).toBe('own')
  })

  it('an_applied_decision_keeps_only_its_finding_and_ruling', () => {
    const applied = `### Reservations are released by a job [applied]
- on: Refund
- finding: a job releases them nightly
- proposed: say the reservation is released when the job runs
- proposed: release it on cancel
- recommended: 1
- because: the job is what users see
- ruling: say the reservation is released when the job runs
`
    expect(compactApplied(applied)).toBe(`### Reservations are released by a job [applied]
- on: Refund
- finding: a job releases them nightly
- ruling: say the reservation is released when the job runs
`)
  })

  it('an_open_ruled_or_withdrawn_decision_is_left_whole', () => {
    const ruled = withRuling(file, 'Shipped orders cannot be cancelled', 'keep')
    const compacted = compactApplied(ruled)
    expect(compacted).toContain('- proposed: the rule says an unshipped order\n- proposed: a shipped order is cancelled and returned\n- recommended: 2')
    expect(compacted).not.toContain('- proposed: say the reservation is released when the job runs')
    expect(decisions(compacted).map((d) => [d.title, d.state])).toEqual(decisions(ruled).map((d) => [d.title, d.state]))
  })
})
