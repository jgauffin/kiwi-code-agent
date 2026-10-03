import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBoard, tasksPath, writeBoard } from '../src/agent/phases/tasks-file'
import type { Classification } from '../src/agent/phases/verification-attribution'
import { FeatureBuild } from '../src/chat/feature-build'
import { board, task } from './task-board-fixture'
import { FakeNotify, FakeRefresh, FakeSessions, profile } from './feature-runs-fixture'

const FEATURE = 'Order cancellation'

let dir: string
let sessions: FakeSessions
let notify: FakeNotify
let testsPass: boolean
let foreign: boolean
let budget: number
const events: string[] = []

const build = () =>
  new FeatureBuild({
    workspaceRoot: dir,
    sessions,
    profileFor: () => profile,
    verifier: {
      rules: () => [{ match: 'src/**/*.ts', command: 'npm test' }],
      run: async () => ({ ok: testsPass, output: testsPass ? '' : 'FAIL src/order.ts' }),
      failureBudget: () => budget,
      retrySeconds: () => 0,
    },
    attribute: () => async (): Promise<Classification> => ({ foreign, files: ['src/order.ts'], ...(foreign ? { hand: 'another session' } : {}) }),
    allowWrites: { isEnabled: () => true, setEnabled: () => {} },
    statusOf: () => 'idle',
    isOpen: () => false,
    refresh: new FakeRefresh(),
    notify,
    listener: {
      runStarting: (feature) => void events.push(`starting ${feature}`),
      passed: async (feature) => void events.push(`passed ${feature}`),
    },
  })

const fixRuns = () => sessions.records.filter((r) => r.fixAttempt !== undefined)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'feature-build-'))
  await mkdir(join(dir, '.kiwi', 'specs'), { recursive: true })
  await mkdir(join(dir, 'specs'))
  await writeBoard(tasksPath(dir, FEATURE), board(task('Cancel', { state: 'tested', files: ['src/order.ts'] })))
  sessions = new FakeSessions()
  notify = new FakeNotify()
  testsPass = false
  foreign = false
  budget = 1
  events.length = 0
})

afterEach(() => rm(dir, { recursive: true, force: true }))

describe('FeatureBuild.verify', () => {
  it('a_run_failing_only_on_another_hand_s_files_is_asked_about_and_spared_from_the_budget', async () => {
    const feature = build()
    foreign = true
    await feature.verify(FEATURE, false)
    expect(notify.asked).toHaveLength(1)
    expect(fixRuns()).toHaveLength(0)

    // Had the foreign run counted, this own failure would be the second in a row and past the budget of one.
    foreign = false
    await feature.verify(FEATURE, false)
    expect(fixRuns()).toHaveLength(1)
  })

  it('own_failures_past_the_budget_are_left_for_the_user', async () => {
    const feature = build()
    await feature.verify(FEATURE, false)
    await feature.verify(FEATURE, false)
    expect(fixRuns()).toHaveLength(1)
    expect(feature.lineOf(FEATURE)?.text).toContain('2 in a row')
  })

  it('a_failure_after_the_first_goes_back_to_the_same_fix_run_with_the_attempt_counted', async () => {
    budget = 2
    const feature = build()
    await feature.verify(FEATURE, false)
    await feature.verify(FEATURE, false)
    expect(fixRuns()).toHaveLength(1)
    const [run] = fixRuns()
    expect(run!.fixAttempt).toBe(2)
    expect(sessions.sent.map((s) => s.id)).toEqual([run!.id, run!.id])
    expect(sessions.sent[1]!.text).toContain('failed again')
  })

  it('a_passing_run_hands_the_feature_to_the_step_after_it', async () => {
    testsPass = true
    expect(await build().verify(FEATURE, false)).toBe(true)
    expect(events).toEqual([`starting ${FEATURE}`, `passed ${FEATURE}`])
  })
})

describe('FeatureBuild.startImplementing', () => {
  const stuck = () =>
    writeBoard(
      tasksPath(dir, FEATURE),
      board(task('Cancel', { state: 'tested', files: ['src/order.ts'] }), task('Refund', { state: 'blocked', blockedReason: 'no e2e setup' })),
    )

  const refund = async () => (await readBoard(tasksPath(dir, FEATURE)))!.tasks.find((t) => t.name === 'Refund')!
  const approvedSpec = () =>
    writeFile(
      join(dir, 'specs', 'order-cancellation.spec.md'),
      '---\nfeature: Order cancellation\nstatus: approved\n---\n\n# Order cancellation\n\n## Goal\nCancel.\n\n## Refund\n- **Refund on cancel**: refunded.\n',
    )

  it('a_task_that_just_blocked_waits_while_another_is_left_to_build', async () => {
    await approvedSpec()
    await writeBoard(tasksPath(dir, FEATURE), board(task('Cancel'), task('Refund', { state: 'blocked', blockedReason: 'no e2e setup' })))
    const plan = await sessions.create(profile, 'plan', FEATURE)
    await sessions.create(profile, 'implement', FEATURE, { parentId: plan.id, task: 'Refund' })
    await build().startImplementing(plan)
    // The open task gets a run of its own; the blocked one is left alone.
    expect(sessions.records.filter((r) => r.task === 'Cancel')).toHaveLength(1)
    expect((await refund()).state).toBe('blocked')
  })

  it('another_look_at_the_end_the_blocked_task_goes_back_once_to_its_own_run_told_the_rest_is_finished', async () => {
    await stuck()
    const plan = await sessions.create(profile, 'plan', FEATURE)
    const run = await sessions.create(profile, 'implement', FEATURE, { parentId: plan.id, task: 'Refund' })
    await build().startImplementing(plan)
    expect(sessions.sent.map((s) => s.id)).toEqual([run.id])
    expect(sessions.sent[0]!.text).toContain('no e2e setup')
    expect(sessions.sent[0]!.text).toContain('Every other task on the board is finished')
    expect(await refund()).toMatchObject({ state: 'in_progress', reassessed: true })
  })

  it('still_blocked_waits_for_the_developer_and_is_not_handed_back_again_by_itself', async () => {
    await writeBoard(
      tasksPath(dir, FEATURE),
      board(task('Cancel', { state: 'tested', files: ['src/order.ts'] }), task('Refund', { state: 'blocked', blockedReason: 'no e2e setup', reassessed: true })),
    )
    const plan = await sessions.create(profile, 'plan', FEATURE)
    await sessions.create(profile, 'implement', FEATURE, { parentId: plan.id, task: 'Refund' })
    await build().startImplementing(plan)
    expect(sessions.sent).toEqual([])
  })

  it('its_run_is_gone_a_new_run_takes_up_the_blocked_task_told_why_it_was_blocked', async () => {
    await stuck()
    const plan = await sessions.create(profile, 'plan', FEATURE)
    await approvedSpec()
    await build().startImplementing(plan)
    const run = sessions.records.find((r) => r.task === 'Refund')
    expect(run).toBeDefined()
    expect(sessions.sent.map((s) => s.id)).toEqual([run!.id])
    expect(sessions.sent[0]!.text).toContain('no e2e setup')
  })

  it('hand_back_the_person_hands_a_named_blocked_task_back_to_its_run_with_the_reason', async () => {
    await writeBoard(
      tasksPath(dir, FEATURE),
      board(task('Cancel', { state: 'tested', files: ['src/order.ts'] }), task('Refund', { state: 'blocked', blockedReason: 'no e2e setup', reassessed: true })),
    )
    const plan = await sessions.create(profile, 'plan', FEATURE)
    const run = await sessions.create(profile, 'implement', FEATURE, { parentId: plan.id, task: 'Refund' })
    await build().startImplementing(plan, true, 'Refund')
    expect(sessions.sent.map((s) => s.id)).toEqual([run.id])
    expect(sessions.sent[0]!.text).toContain('The user hands it back to you')
    expect((await refund()).state).toBe('in_progress')
  })

  it('accepted_is_finished_accepting_the_last_blocked_task_starts_the_test_run', async () => {
    await stuck()
    testsPass = true
    await build().acceptTask(FEATURE, 'Refund')
    expect(await refund()).toMatchObject({ state: 'tested', accepted: 'no e2e setup' })
    expect(events).toEqual([`starting ${FEATURE}`, `passed ${FEATURE}`])
  })
})

describe('FeatureBuild.followTask', () => {
  it('answer_in_the_chat_a_run_whose_task_ended_blocked_is_closed_but_not_settled', async () => {
    await writeBoard(tasksPath(dir, FEATURE), board(task('Refund', { state: 'blocked', blockedReason: 'no e2e setup', reassessed: true })))
    const plan = await sessions.create(profile, 'plan', FEATURE)
    const run = await sessions.create(profile, 'implement', FEATURE, { parentId: plan.id, task: 'Refund' })
    await build().followTask(run, { type: 'turn_done', isError: false } as never)
    expect(sessions.closed).toEqual([run.id])
    expect(sessions.settled).toEqual([])
  })
})
