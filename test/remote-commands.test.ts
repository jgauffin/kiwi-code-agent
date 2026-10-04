import { describe, expect, it } from 'vitest'
import { parseRemoteCommand } from '../src/remote-control/remote-commands'

describe('answer resolves the card', () => {
  it('a_question_answer_from_the_phone_parses_to_a_command', () => {
    const command = parseRemoteCommand({
      type: 'answer_question',
      sessionId: 's1',
      requestId: 'q-1',
      outcome: { kind: 'answered', answers: [{ chosen: ['Large'] }] },
    })
    expect(command).toEqual({ type: 'answer_question', sessionId: 's1', requestId: 'q-1', outcome: { kind: 'answered', answers: [{ chosen: ['Large'] }] } })
  })

  it('free_text_in_the_outcome_carries_through', () => {
    const command = parseRemoteCommand({
      type: 'answer_question',
      sessionId: 's1',
      requestId: 'q-1',
      outcome: { kind: 'answered', answers: [{ chosen: [], other: 'In my own words' }] },
    })
    expect(command).toMatchObject({ outcome: { answers: [{ other: 'In my own words' }] } })
  })

  it('missing_fields_are_refused_rather_than_guessed', () => {
    expect(parseRemoteCommand({ type: 'answer_question', sessionId: 's1' })).toBeUndefined()
  })
})

describe('permission answered from the phone', () => {
  it('allow_and_deny_both_parse', () => {
    expect(parseRemoteCommand({ type: 'answer_permission', sessionId: 's1', requestId: 'req-1', decision: { kind: 'allow' } })).toEqual({
      type: 'answer_permission',
      sessionId: 's1',
      requestId: 'req-1',
      decision: { kind: 'allow' },
    })
    expect(parseRemoteCommand({ type: 'answer_permission', sessionId: 's1', requestId: 'req-1', decision: { kind: 'deny', message: 'no' } })).toEqual({
      type: 'answer_permission',
      sessionId: 's1',
      requestId: 'req-1',
      decision: { kind: 'deny', message: 'no' },
    })
  })
})

describe('steering a running session', () => {
  it('a_prompt_parses_with_its_text', () => {
    expect(parseRemoteCommand({ type: 'send_prompt', sessionId: 's1', text: 'keep going' })).toEqual({ type: 'send_prompt', sessionId: 's1', text: 'keep going' })
  })

  it('an_interrupt_parses_with_only_the_session', () => {
    expect(parseRemoteCommand({ type: 'interrupt_session', sessionId: 's1' })).toEqual({ type: 'interrupt_session', sessionId: 's1' })
  })
})

describe('approving and ruling', () => {
  it('approve_spec_and_send_rulings_name_the_feature', () => {
    expect(parseRemoteCommand({ type: 'approve_spec', feature: 'Orders' })).toEqual({ type: 'approve_spec', feature: 'Orders' })
    expect(parseRemoteCommand({ type: 'send_rulings', feature: 'Orders' })).toEqual({ type: 'send_rulings', feature: 'Orders' })
  })

  it('a_ruling_carries_the_decision_and_the_ruling_text', () => {
    expect(parseRemoteCommand({ type: 'rule_decision', feature: 'Orders', decision: 'Refund window', ruling: 'keep' })).toEqual({
      type: 'rule_decision',
      feature: 'Orders',
      decision: 'Refund window',
      ruling: 'keep',
    })
  })
})

describe("starting a draft's session", () => {
  it('names_the_feature_whose_draft_is_picked_up', () => {
    expect(parseRemoteCommand({ type: 'start_draft_session', feature: 'Orders' })).toEqual({ type: 'start_draft_session', feature: 'Orders' })
  })
})

describe('authoring stays at the desk', () => {
  it('a_message_type_the_phone_may_not_send_parses_to_nothing', () => {
    expect(parseRemoteCommand({ type: 'add_comment', target: 'plan', text: 'hmm' })).toBeUndefined()
    expect(parseRemoteCommand({ type: 'new_session', mode: 'chat' })).toBeUndefined()
    expect(parseRemoteCommand({ type: 'set_default_profile', name: 'Claude' })).toBeUndefined()
  })
})
