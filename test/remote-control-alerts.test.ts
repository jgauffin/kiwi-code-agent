import { describe, expect, it } from 'vitest'
import { alertFor, mayPush, permissionAlert, questionAlert, resolvesCompletion } from '../src/remote-control/alerts'
import type { SessionEvent } from '../src/agent/session/code-session'
import type { UserQuestionRequest } from '../src/agent/session/user-question'

const single: UserQuestionRequest = { questions: [{ header: 'Which', question: 'Which approach?', options: [{ label: 'A' }, { label: 'B' }] }] }
const freeText: UserQuestionRequest = { questions: [{ header: 'Why', question: 'What should it do instead?' }] }
const several: UserQuestionRequest = {
  questions: [
    { header: 'Which', question: 'Which approach?', options: [{ label: 'A' }] },
    { header: 'Why', question: 'Why that one?', options: [{ label: 'B' }] },
  ],
}
const multiSelect: UserQuestionRequest = { questions: [{ header: 'Which', question: 'Which apply?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }] }

const write: Extract<SessionEvent, { type: 'permission_request' }> = {
  type: 'permission_request',
  requestId: 'r1',
  toolName: 'Write',
  input: {},
  edit: { path: '/repo/a.ts', label: 'a.ts', diffs: ['@@ -1 +1 @@'], omitted: 0 },
}
const command: Extract<SessionEvent, { type: 'permission_request' }> = { type: 'permission_request', requestId: 'r2', toolName: 'Bash', input: {} }

describe('anything that blocks completion pushes', () => {
  it('a_question_asked_or_a_permission_prompt_pending_is_what_pushes', () => {
    const question: SessionEvent = { type: 'question_request', requestId: 'r1', request: single }
    expect(alertFor('s1', 'Orders', question)).toBeDefined()
    expect(alertFor('s1', 'Orders', command)).toBeDefined()
  })

  it('a_turn_that_merely_ended_pushes_nothing', () => {
    const turnDone: SessionEvent = { type: 'turn_done', isError: false, errors: [] }
    expect(alertFor('s1', 'Orders', turnDone)).toBeUndefined()
  })
})

describe('progress is not an alert', () => {
  it('work_still_moving_pushes_nothing', () => {
    const status: SessionEvent = { type: 'status', status: 'requesting' }
    const reply: SessionEvent = { type: 'assistant_message', messageId: 'm1', text: 'working on it' }
    expect(alertFor('s1', 'Orders', status)).toBeUndefined()
    expect(alertFor('s1', 'Orders', reply)).toBeUndefined()
  })
})

describe('choices as buttons', () => {
  it('a_single_select_question_offers_its_options_as_buttons_that_settle_it_in_one_tap', () => {
    const alert = questionAlert('s1', 'Orders', single)
    expect(alert.buttons).toEqual([
      { label: 'A', value: 'A' },
      { label: 'B', value: 'B' },
    ])
    expect(alert.opensApp).toBe(false)
  })

  it('a_question_with_no_offered_choices_carries_a_way_into_the_app_instead_of_buttons', () => {
    const alert = questionAlert('s1', 'Orders', freeText)
    expect(alert.buttons).toBeUndefined()
    expect(alert.opensApp).toBe(true)
  })
})

describe('wizard for several questions', () => {
  it('a_request_holding_more_than_one_question_carries_no_buttons_so_the_app_takes_them_one_screen_at_a_time', () => {
    const alert = questionAlert('s1', 'Orders', several)
    expect(alert.buttons).toBeUndefined()
    expect(alert.opensApp).toBe(true)
  })

  it('a_multiselect_question_takes_more_than_one_tap_so_it_carries_no_buttons_either', () => {
    const alert = questionAlert('s1', 'Orders', multiSelect)
    expect(alert.buttons).toBeUndefined()
    expect(alert.opensApp).toBe(true)
  })
})

describe('decision that needs a screen', () => {
  it('a_file_write_offers_allow_and_deny_as_buttons_and_still_carries_the_way_into_its_diff', () => {
    const alert = permissionAlert('s1', 'Orders', write)
    expect(alert.buttons).toEqual([
      { label: 'Allow', value: 'allow' },
      { label: 'Deny', value: 'deny' },
    ])
    expect(alert.opensApp).toBe(true)
  })

  it('a_plain_permission_settles_fully_with_its_buttons_alone', () => {
    const alert = permissionAlert('s1', 'Orders', command)
    expect(alert.opensApp).toBe(false)
  })
})

describe('per-session push permission', () => {
  it('the_persons_own_choice_for_the_session_overrides_everything_else', () => {
    expect(mayPush(false, 'phone', true)).toBe(false)
    expect(mayPush(true, undefined, false)).toBe(true)
  })
})

describe('default by where it started', () => {
  it('a_session_started_from_the_phone_may_push_regardless_of_the_workspace_default', () => {
    expect(mayPush(undefined, 'phone', false)).toBe(true)
  })

  it('a_session_started_at_the_desk_follows_the_workspace_standing_default', () => {
    expect(mayPush(undefined, 'desk', true)).toBe(true)
    expect(mayPush(undefined, 'desk', false)).toBe(false)
    expect(mayPush(undefined, undefined, true)).toBe(true)
  })
})

describe('quiet session waits to be visited', () => {
  it('a_session_without_permission_computes_no_push_so_nothing_is_sent', () => {
    expect(mayPush(false, 'phone', true)).toBe(false)
    expect(mayPush(undefined, 'desk', false)).toBe(false)
  })
})

describe('alert withdrawn once answered', () => {
  it('a_question_or_permission_resolved_or_the_session_ending_withdraws_the_alert', () => {
    const questionResolved: SessionEvent = { type: 'question_resolved', requestId: 'r1', outcome: { kind: 'unanswered' } }
    const permissionResolved: SessionEvent = { type: 'permission_resolved', requestId: 'r1', decision: 'allow' }
    const ended: SessionEvent = { type: 'ended' }
    expect(resolvesCompletion(questionResolved)).toBe(true)
    expect(resolvesCompletion(permissionResolved)).toBe(true)
    expect(resolvesCompletion(ended)).toBe(true)
  })

  it('progress_resolves_nothing', () => {
    const turnDone: SessionEvent = { type: 'turn_done', isError: false, errors: [] }
    expect(resolvesCompletion(turnDone)).toBe(false)
  })
})
