import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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

  it('a_task_that_just_blocked_is_not_picked_up_again_by_the_build_itself', async () => {
    await stuck()
    const plan = await sessions.create(profile, 'plan', FEATURE)
    await sessions.create(profile, 'implement', FEATURE, { parentId: plan.id, task: 'Refund' })
    await build().startImplementing(plan)
    expect(sessions.sent).toEqual([])
  })

  it('the_person_asking_again_hands_a_blocked_task_back_to_its_run_with_the_reason', async () => {
    await stuck()
    const plan = await sessions.create(profile, 'plan', FEATURE)
    const run = await sessions.create(profile, 'implement', FEATURE, { parentId: plan.id, task: 'Refund' })
    await build().startImplementing(plan, true)
    expect(sessions.sent.map((s) => s.id)).toEqual([run.id])
    expect(sessions.sent[0]!.text).toContain('no e2e setup')
    const refund = (await readBoard(tasksPath(dir, FEATURE)))!.tasks.find((t) => t.name === 'Refund')!
    expect(refund.state).toBe('in_progress')
  })
})
