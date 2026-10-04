import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionEntries, sessionView, workspaceSnapshot, type ConversationSource } from '../src/remote-control/following'
import { renderBoard } from '../src/agent/phases/tasks-file'
import { board, task } from './task-board-fixture'
import type { SessionEvent } from '../src/agent/session/code-session'
import type { SessionMode, SessionRecord } from '../src/agent/session/session-manager'
import type { SessionStatus } from '../src/agent/session/session-status'

const record = (id: string, mode: SessionMode, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  title: id,
  profile: { name: 'Claude', engine: 'claude-sdk', model: 'opus' },
  mode,
  createdAt: '2026-09-29T00:00:00.000Z',
  ...extra,
})

const statuses =
  (map: Record<string, SessionStatus>) =>
  (id: string): SessionStatus =>
    map[id] ?? 'idle'

/** Specs go under `specs/`, every other plan file (tasks board, decisions) among the working files. */
async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'following-'))
  await mkdir(join(dir, 'specs'))
  await mkdir(join(dir, '.kiwi', 'specs'), { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    await writeFile(name.endsWith('.spec.md') ? join(dir, 'specs', name) : join(dir, '.kiwi', 'specs', name), text)
  }
  return dir
}

describe('workspaceSnapshot: three lists', () => {
  it('lists_every_unfinished_feature_with_the_step_it_is_waiting_on_and_leaves_out_what_is_verified', async () => {
    const dir = await workspace({
      'orders.spec.md': '---\nfeature: Orders\nstatus: draft\n---\n# Orders\n',
      'billing.spec.md': '---\nfeature: Billing\nstatus: approved\n---\n# Billing\n',
      'audit.spec.md': '---\nfeature: Audit\nstatus: approved\n---\n# Audit\n',
      'audit.tasks.json': renderBoard(board(task('A', { state: 'tested' }))),
    })
    try {
      const snapshot = await workspaceSnapshot(dir, [], statuses({}))
      expect(snapshot.features).toEqual([
        { feature: 'Audit', waitingOn: 'verification' },
        { feature: 'Billing', waitingOn: 'checking' },
        { feature: 'Orders', waitingOn: 'created' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('splits_sessions_between_at_work_and_stopped_by_their_status', async () => {
    const dir = await workspace({})
    try {
      const records = [record('planning', 'chat', { title: 'Planning' }), record('resting', 'chat', { title: 'Resting' }), record('done', 'chat', { title: 'Done' })]
      const snapshot = await workspaceSnapshot(dir, records, statuses({ planning: 'implementing', resting: 'needs_human', done: 'idle' }))
      expect(snapshot.sessionsAtWork).toEqual([{ sessionId: 'planning', title: 'Planning' }])
      // idle is neither at work nor stopped: nothing is asked of the person and nothing is running.
      expect(snapshot.sessionsStopped).toEqual([{ sessionId: 'resting', title: 'Resting', blocker: 'turn_ended_on_person' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('workspaceSnapshot: why a session stopped', () => {
  it('reads_a_question_or_a_permission_prompt_straight_off_the_status', async () => {
    const dir = await workspace({})
    try {
      const records = [record('asking', 'chat'), record('allowing', 'chat')]
      const snapshot = await workspaceSnapshot(dir, records, statuses({ asking: 'needs_answer', allowing: 'needs_approval' }))
      expect(snapshot.sessionsStopped).toEqual([
        { sessionId: 'asking', title: 'asking', blocker: 'question_open' },
        { sessionId: 'allowing', title: 'allowing', blocker: 'permission_pending' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads_a_blocked_task_off_the_board_rather_than_calling_every_turn_end_the_same', async () => {
    const dir = await workspace({
      'orders.spec.md': '---\nfeature: Orders\nstatus: approved\n---\n# Orders\n',
      'orders.tasks.json': renderBoard(board(task('A', { state: 'tested' }), task('B', { state: 'blocked' }))),
    })
    try {
      const records = [record('plan', 'plan', { feature: 'Orders' })]
      const snapshot = await workspaceSnapshot(dir, records, statuses({ plan: 'needs_human' }))
      expect(snapshot.sessionsStopped).toEqual([{ sessionId: 'plan', title: 'plan', blocker: 'task_blocked' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads_verification_held_off_the_board_once_every_task_is_tested_but_nothing_has_confirmed_it_yet', async () => {
    const dir = await workspace({
      'orders.spec.md': '---\nfeature: Orders\nstatus: approved\n---\n# Orders\n',
      'orders.tasks.json': renderBoard(board(task('A', { state: 'tested' }))),
    })
    try {
      const records = [record('plan', 'plan', { feature: 'Orders' })]
      const snapshot = await workspaceSnapshot(dir, records, statuses({ plan: 'needs_human' }))
      expect(snapshot.sessionsStopped).toEqual([{ sessionId: 'plan', title: 'plan', blocker: 'verification_held' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls_back_to_a_turn_that_simply_ended_once_the_board_gives_no_other_reason', async () => {
    const dir = await workspace({ 'orders.spec.md': '---\nfeature: Orders\nstatus: approved\n---\n# Orders\n' })
    try {
      const records = [record('plan', 'plan', { feature: 'Orders' })]
      const snapshot = await workspaceSnapshot(dir, records, statuses({ plan: 'needs_human' }))
      expect(snapshot.sessionsStopped).toEqual([{ sessionId: 'plan', title: 'plan', blocker: 'turn_ended_on_person' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('sessionEntries: session in view', () => {
  it('shows_the_prompts_sent_the_replies_and_the_tool_calls_with_their_outcomes', () => {
    const events: SessionEvent[] = [
      { type: 'user_message', text: 'Cancel the order' },
      { type: 'assistant_text', messageId: 'm1', delta: 'Can' },
      { type: 'assistant_message', messageId: 'm1', text: 'Cancelling the order now.' },
      { type: 'tool_call', toolUseId: 't1', name: 'Edit', input: {} },
      { type: 'tool_result', toolUseId: 't1', text: 'applied', isError: false },
      { type: 'tool_call', toolUseId: 't2', name: 'Bash', input: {} },
      { type: 'tool_result', toolUseId: 't2', text: 'command not found\nmore output', isError: true },
    ]

    expect(sessionEntries(events)).toEqual([
      { kind: 'prompt', text: 'Cancel the order' },
      { kind: 'reply', text: 'Cancelling the order now.' },
      { kind: 'tool_call', name: 'Edit', outcome: 'applied' },
      { kind: 'tool_call', name: 'Bash', outcome: 'failed: command not found' },
    ])
  })

  it('shows_a_prompt_the_extension_wrote_by_its_label_rather_than_its_sealed_text', () => {
    const events: SessionEvent[] = [{ type: 'user_message', text: 'full kickoff text the model reads', label: 'Kickoff' }]
    expect(sessionEntries(events)).toEqual([{ kind: 'prompt', text: 'Kickoff' }])
  })

  it('leaves_a_tool_call_running_when_its_result_never_arrives', () => {
    const events: SessionEvent[] = [{ type: 'tool_call', toolUseId: 't1', name: 'Read', input: {} }]
    expect(sessionEntries(events)).toEqual([{ kind: 'tool_call', name: 'Read', outcome: 'running' }])
  })
})

describe('sessionView', () => {
  const fakeSource = (records: Record<string, SessionRecord>, live: string | undefined, conversations: Record<string, SessionEvent[]>): ConversationSource => ({
    get: (id) => records[id],
    liveChildOf: (id) => (live && records[live]?.parentId === id ? records[live] : undefined),
    conversation: async (id) => conversations[id] ?? [],
  })

  it('reads_the_conversation_of_a_live_child_run_rather_than_the_tabs_own_when_one_is_at_work', async () => {
    const plan = record('plan', 'plan')
    const check = record('check', 'reconcile', { parentId: 'plan' })
    const source = fakeSource({ plan, check }, 'check', { check: [{ type: 'user_message', text: 'go' }] })

    const view = await sessionView(source, 'plan')

    expect(view).toEqual({ sessionId: 'plan', entries: [{ kind: 'prompt', text: 'go' }] })
  })

  it('reads_its_own_conversation_once_nothing_is_live_under_it', async () => {
    const plan = record('plan', 'plan')
    const source = fakeSource({ plan }, undefined, { plan: [{ type: 'user_message', text: 'approve it' }] })

    const view = await sessionView(source, 'plan')

    expect(view).toEqual({ sessionId: 'plan', entries: [{ kind: 'prompt', text: 'approve it' }] })
  })

  it('is_nothing_for_a_session_that_is_gone', async () => {
    const source = fakeSource({}, undefined, {})
    expect(await sessionView(source, 'gone')).toBeUndefined()
  })
})
