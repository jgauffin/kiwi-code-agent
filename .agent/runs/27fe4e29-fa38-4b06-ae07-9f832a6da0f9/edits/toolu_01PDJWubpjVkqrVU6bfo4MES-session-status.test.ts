import { describe, expect, it } from 'vitest'
import { nextStatus, type SessionStatus } from '../src/agent/session/session-status'
import type { SessionEvent } from '../src/agent/session/code-session'
import type { SessionMode } from '../src/agent/session/session-manager'

function run(mode: SessionMode, events: SessionEvent[], from: SessionStatus = 'idle'): SessionStatus[] {
  const out: SessionStatus[] = []
  let s = from
  for (const e of events) {
    s = nextStatus(s, mode, e)
    out.push(s)
  }
  return out
}

const turnDone = (isError = false): SessionEvent => ({ type: 'turn_done', isError, errors: [] })

describe('session status', () => {
  it('a_prompt_puts_a_chat_session_into_implementing_and_a_plan_session_into_planning', () => {
    expect(run('chat', [{ type: 'user_message', text: 'x' }])).toEqual(['implementing'])
    expect(run('plan', [{ type: 'user_message', text: 'x' }])).toEqual(['planning'])
  })

  it('reconciling_is_planning_and_its_findings_wait_for_the_human', () => {
    expect(run('reconcile', [{ type: 'user_message', text: 'x' }, turnDone()])).toEqual(['planning', 'needs_human'])
  })

  it('an_implementer_that_stops_is_done_or_blocked_and_either_way_needs_the_human', () => {
    expect(run('implement', [{ type: 'user_message', text: 'x' }, turnDone()])).toEqual(['implementing', 'needs_human'])
  })

  it('a_pending_permission_needs_the_human_until_it_is_answered', () => {
    const request: SessionEvent = { type: 'permission_request', requestId: 'r', toolName: 'Edit', input: {} }
    expect(run('chat', [{ type: 'user_message', text: 'x' }, request, { type: 'status', status: 'requesting' }])).toEqual([
      'implementing',
      'needs_human',
      'needs_human',
    ])
    expect(nextStatus('needs_human', 'chat', { type: 'permission_resolved', requestId: 'r', decision: 'allow' })).toBe('implementing')
  })

  it('a_failed_turn_or_fatal_error_is_an_error_until_the_next_prompt', () => {
    expect(run('chat', [turnDone(true), { type: 'ended' }], 'implementing')).toEqual(['error', 'error'])
    expect(run('chat', [{ type: 'error', message: 'boom', fatal: true }, { type: 'user_message', text: 'retry' }], 'implementing')).toEqual([
      'error',
      'implementing',
    ])
    expect(nextStatus('implementing', 'chat', { type: 'error', message: 'minor', fatal: false })).toBe('implementing')
  })

  it('a_session_that_revised_a_plan_after_a_review_waits_for_the_human_again', () => {
    // The review arrives as a prompt; when the revision and its resolutions are presented, the round is the human's again.
    for (const mode of ['plan', 'reconcile'] as const) {
      expect(run(mode, [{ type: 'user_message', text: 'review round 1' }, turnDone()])).toEqual(['planning', 'needs_human'])
    }
  })

  it('a_finished_chat_turn_is_idle_but_a_finished_plan_turn_needs_the_human', () => {
    expect(run('chat', [{ type: 'user_message', text: 'x' }, turnDone(), { type: 'ended' }])).toEqual(['implementing', 'idle', 'idle'])
    expect(run('plan', [{ type: 'user_message', text: 'x' }, turnDone(), { type: 'ended' }])).toEqual([
      'planning',
      'needs_human',
      'needs_human',
    ])
  })
})
