import { describe, expect, it } from 'vitest'
import { RemoteActions, type RemotePlanPort, type RemoteSessionPort } from '../src/chat/remote-actions'
import type { SessionRecord } from '../src/agent/session/session-manager'
import type { ModelProfile } from '../src/agent/session/model-profile'

const profile: ModelProfile = { name: 'Claude', engine: 'claude-sdk', model: 'opus' }

function record(id: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return { id, title: id, profile, mode: 'chat', createdAt: new Date().toISOString(), ...extra }
}

/** Stands in for `SessionManager`: records every call rather than running anything. */
function fakeSessions(records: SessionRecord[] = [], open = true) {
  const sent: { sessionId: string; text: string }[] = []
  const interrupted: string[] = []
  const answeredQuestions: { sessionId: string; requestId: string }[] = []
  const answeredPermissions: { sessionId: string; requestId: string }[] = []
  const notes: { sessionId: string; note: string }[] = []
  const port: RemoteSessionPort = {
    get: (id) => records.find((r) => r.id === id),
    list: () => records,
    send: async (sessionId, text) => void sent.push({ sessionId, text }),
    interrupt: async (sessionId) => void interrupted.push(sessionId),
    respondToQuestion: async (sessionId, requestId) => void answeredQuestions.push({ sessionId, requestId }),
    respondToPermission: async (sessionId, requestId) => void answeredPermissions.push({ sessionId, requestId }),
    isRequestOpen: async () => open,
    noteRemoteAct: async (sessionId, note) => void notes.push({ sessionId, note }),
  }
  return { port, sent, interrupted, answeredQuestions, answeredPermissions, notes }
}

/** Stands in for `PlanActions`: records every call rather than touching any spec file. */
function fakePlans() {
  const approved: SessionRecord[] = []
  const rulingsSent: SessionRecord[] = []
  const ruled: { decision: string; ruling: string }[] = []
  const resumed: string[] = []
  const port: RemotePlanPort = {
    approveSpec: async (shown) => void approved.push(shown!),
    sendRulings: async (shown) => void rulingsSent.push(shown!),
    ruleDecision: async (_shown, message) => void ruled.push({ decision: message.decision, ruling: message.ruling }),
    resumePlan: async (feature) => void resumed.push(feature),
  }
  return { port, approved, rulingsSent, ruled, resumed }
}

describe('answer resolves the card', () => {
  it('delivers_the_outcome_through_the_same_call_a_desk_answer_makes_and_notes_it', async () => {
    const sessions = fakeSessions([record('s1')])
    const actions = new RemoteActions({ sessions: sessions.port, plans: fakePlans().port, isDraft: async () => false })
    const outcome = { kind: 'answered' as const, answers: [{ chosen: ['Large'] }] }
    await actions.handle({ type: 'answer_question', sessionId: 's1', requestId: 'q-1', outcome })
    expect(sessions.answeredQuestions).toEqual([{ sessionId: 's1', requestId: 'q-1' }])
    expect(sessions.notes).toEqual([{ sessionId: 's1', note: 'Answered a question from the phone' }])
  })
})

describe('free text from the phone', () => {
  it('a_question_answered_in_the_persons_own_words_still_resolves_the_card', async () => {
    const sessions = fakeSessions([record('s1')])
    const actions = new RemoteActions({ sessions: sessions.port, plans: fakePlans().port, isDraft: async () => false })
    const outcome = { kind: 'answered' as const, answers: [{ chosen: [], other: 'In my own words' }] }
    await actions.handle({ type: 'answer_question', sessionId: 's1', requestId: 'q-1', outcome })
    expect(sessions.answeredQuestions).toEqual([{ sessionId: 's1', requestId: 'q-1' }])
  })
})

describe('permission answered from the phone', () => {
  it('allow_and_deny_both_resolve_the_prompt_and_are_noted', async () => {
    const sessions = fakeSessions([record('s1')])
    const actions = new RemoteActions({ sessions: sessions.port, plans: fakePlans().port, isDraft: async () => false })
    await actions.handle({ type: 'answer_permission', sessionId: 's1', requestId: 'req-1', decision: { kind: 'allow' } })
    await actions.handle({ type: 'answer_permission', sessionId: 's1', requestId: 'req-2', decision: { kind: 'deny', message: 'no' } })
    expect(sessions.answeredPermissions).toEqual([
      { sessionId: 's1', requestId: 'req-1' },
      { sessionId: 's1', requestId: 'req-2' },
    ])
    expect(sessions.notes).toEqual([
      { sessionId: 's1', note: 'Allowed a permission from the phone' },
      { sessionId: 's1', note: 'Denied a permission from the phone' },
    ])
  })
})

describe('first answer wins', () => {
  it('a_request_no_longer_open_is_left_alone_rather_than_answered_again', async () => {
    const sessions = fakeSessions([record('s1')], false)
    const actions = new RemoteActions({ sessions: sessions.port, plans: fakePlans().port, isDraft: async () => false })
    await actions.handle({ type: 'answer_question', sessionId: 's1', requestId: 'q-1', outcome: { kind: 'answered', answers: [{ chosen: ['A'] }] } })
    await actions.handle({ type: 'answer_permission', sessionId: 's1', requestId: 'req-1', decision: { kind: 'allow' } })
    expect(sessions.answeredQuestions).toEqual([])
    expect(sessions.answeredPermissions).toEqual([])
    expect(sessions.notes).toEqual([])
  })
})

describe('steering a running session', () => {
  it('a_prompt_reaches_the_session_and_an_interrupt_ends_its_turn', async () => {
    const sessions = fakeSessions([record('s1')])
    const actions = new RemoteActions({ sessions: sessions.port, plans: fakePlans().port, isDraft: async () => false })
    await actions.handle({ type: 'send_prompt', sessionId: 's1', text: 'keep going' })
    await actions.handle({ type: 'interrupt_session', sessionId: 's1' })
    expect(sessions.sent).toEqual([{ sessionId: 's1', text: 'keep going' }])
    expect(sessions.interrupted).toEqual(['s1'])
    expect(sessions.notes.map((n) => n.note)).toEqual(['Sent from the phone', 'Interrupted from the phone'])
  })

  it('nothing_is_sent_to_a_session_that_no_longer_exists', async () => {
    const sessions = fakeSessions([])
    const actions = new RemoteActions({ sessions: sessions.port, plans: fakePlans().port, isDraft: async () => false })
    await actions.handle({ type: 'send_prompt', sessionId: 'gone', text: 'keep going' })
    expect(sessions.sent).toEqual([])
  })
})

describe('approving and ruling', () => {
  it('approves_the_spec_and_sends_rulings_for_the_feature_s_plan_session', async () => {
    const sessions = fakeSessions([record('plan-1', { mode: 'plan', feature: 'Orders' })])
    const plans = fakePlans()
    const actions = new RemoteActions({ sessions: sessions.port, plans: plans.port, isDraft: async () => false })
    await actions.handle({ type: 'approve_spec', feature: 'Orders' })
    await actions.handle({ type: 'send_rulings', feature: 'Orders' })
    expect(plans.approved.map((r) => r.id)).toEqual(['plan-1'])
    expect(plans.rulingsSent.map((r) => r.id)).toEqual(['plan-1'])
    expect(sessions.notes.map((n) => n.note)).toEqual(['Approved the spec from the phone', 'Sent the rulings from the phone'])
  })

  it('a_ruling_is_written_under_the_decision_it_answers', async () => {
    const sessions = fakeSessions([record('plan-1', { mode: 'plan', feature: 'Orders' })])
    const plans = fakePlans()
    const actions = new RemoteActions({ sessions: sessions.port, plans: plans.port, isDraft: async () => false })
    await actions.handle({ type: 'rule_decision', feature: 'Orders', decision: 'Refund window', ruling: 'keep' })
    expect(plans.ruled).toEqual([{ decision: 'Refund window', ruling: 'keep' }])
  })

  it('nothing_happens_for_a_feature_with_no_plan_session_open', async () => {
    const sessions = fakeSessions([])
    const plans = fakePlans()
    const actions = new RemoteActions({ sessions: sessions.port, plans: plans.port, isDraft: async () => false })
    await actions.handle({ type: 'approve_spec', feature: 'Orders' })
    expect(plans.approved).toEqual([])
    expect(sessions.notes).toEqual([])
  })
})

describe("starting a draft's session", () => {
  it('picking_a_draft_opens_its_planning_session', async () => {
    const sessions = fakeSessions([record('plan-1', { mode: 'plan', feature: 'Orders' })])
    const plans = fakePlans()
    const actions = new RemoteActions({ sessions: sessions.port, plans: plans.port, isDraft: async (feature) => feature === 'Orders' })
    await actions.handle({ type: 'start_draft_session', feature: 'Orders' })
    expect(plans.resumed).toEqual(['Orders'])
    expect(sessions.notes).toEqual([{ sessionId: 'plan-1', note: 'Opened the draft from the phone' }])
  })

  it('a_feature_whose_spec_is_not_a_draft_is_not_started_from_the_phone', async () => {
    const sessions = fakeSessions([])
    const plans = fakePlans()
    const actions = new RemoteActions({ sessions: sessions.port, plans: plans.port, isDraft: async () => false })
    await actions.handle({ type: 'start_draft_session', feature: 'Orders' })
    expect(plans.resumed).toEqual([])
  })
})
