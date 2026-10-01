import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tasksPath, writeBoard } from '../src/agent/phases/tasks-file'
import type { Thresholds } from '../src/agent/cleanup/oversized'
import { FeatureCleanup } from '../src/chat/feature-cleanup'
import { board, task } from './task-board-fixture'
import { FakeNotify, FakeRefresh, FakeSessions, profile } from './feature-runs-fixture'

const FEATURE = 'Order cancellation'
const none: Thresholds = { functionLines: 0, functionComplexity: 0, typeLines: 0, fileLines: 0 }

let dir: string
let sessions: FakeSessions
let refresh: FakeRefresh
let testRuns: number

/** The cleanup wired to a test run that behaves as the build's does: it tells the cleanup it starts, and that it passed. */
const cleanupOf = () => {
  const cleanup: FeatureCleanup = new FeatureCleanup({
    workspaceRoot: dir,
    sessions,
    profileFor: () => profile,
    sizeLimits: { limits: () => ({ source: none, tests: none, testGlobs: [] }), ignore: () => [] },
    refresh,
    notify: new FakeNotify(),
    verify: async (feature) => {
      testRuns++
      cleanup.runStarting(feature)
      await cleanup.passed(feature)
      return { passed: true, text: 'Tests passed' }
    },
  })
  return cleanup
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'feature-cleanup-'))
  await mkdir(join(dir, '.kiwi', 'specs'), { recursive: true })
  await writeBoard(tasksPath(dir, FEATURE), board(task('Cancel', { state: 'tested' })))
  sessions = new FakeSessions()
  refresh = new FakeRefresh()
  testRuns = 0
})

afterEach(() => rm(dir, { recursive: true, force: true }))

describe('FeatureCleanup', () => {
  it('the_test_run_after_a_split_neither_clears_its_line_nor_sweeps_again_on_its_pass', async () => {
    const cleanup = cleanupOf()
    const run = await sessions.create(profile, 'cleanup', FEATURE, { files: [] })
    await cleanup.reengage(run)
    const done = refresh.nextChange()
    cleanup.follow(run, { type: 'turn_done', isError: false, errors: [] })
    await done
    expect(testRuns).toBe(1)
    const state = cleanup.stateOf(FEATURE)
    expect(state.cleanup).toEqual({ live: false, text: 'Cleaned: every unit is within its limits; Tests passed' })
    expect(state.cleanupSweep).toBeUndefined()
  })

  it('a_new_test_run_leaves_a_running_cleanup_line_alone', async () => {
    const cleanup = cleanupOf()
    await cleanup.reengage(await sessions.create(profile, 'cleanup', FEATURE))
    cleanup.runStarting(FEATURE)
    expect(cleanup.stateOf(FEATURE).cleanup?.live).toBe(true)
  })

  it('a_new_test_run_clears_the_outcome_of_the_last_cleanup', async () => {
    const cleanup = cleanupOf()
    await cleanup.sweep(FEATURE)
    expect(cleanup.stateOf(FEATURE).cleanup?.text).toBe('Sizes not checked: no size limits are set')
    cleanup.runStarting(FEATURE)
    expect(cleanup.stateOf(FEATURE).cleanup).toBeUndefined()
  })
})
