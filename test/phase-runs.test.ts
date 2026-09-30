import { describe, expect, it } from 'vitest'
import { defaultTarget, phaseOfRun, phaseOfStep, recipient, refusal } from '../src/chat/phase-runs'
import type { RunControls } from '../src/chat/protocol'

const run = (sessionId: string, over: Partial<RunControls> = {}): RunControls => ({
  sessionId,
  mode: 'implement',
  title: sessionId,
  profileName: 'Claude',
  live: false,
  settled: false,
  ...over,
})

describe('which phase a step and a run belong to', () => {
  it('review_approval_and_rulings_are_spoken_with_the_planner', () => {
    expect(['plan', 'review', 'approve', 'rule'].map((s) => phaseOfStep(s as never))).toEqual(['plan', 'plan', 'plan', 'plan'])
    expect(phaseOfStep('implement')).toBe('implement')
    expect(phaseOfStep('verify')).toBe('verify')
    expect(phaseOfStep('cleanup')).toBe('cleanup')
  })

  it('the_check_folds_into_the_plan_chat_and_a_fix_run_belongs_to_verify', () => {
    expect(phaseOfRun(run('c', { mode: 'reconcile' }))).toBe('plan')
    expect(phaseOfRun(run('t', { task: 'A' }))).toBe('implement')
    expect(phaseOfRun(run('f', { fixAttempt: 1 }))).toBe('verify')
    expect(phaseOfRun(run('x', { mode: 'cleanup' }))).toBe('cleanup')
    expect(phaseOfRun(run('s', { mode: 'chat' }))).toBe('session')
  })
})

describe('the run a phase talks to', () => {
  it('the_task_being_built_is_the_default_over_newer_and_older_task_runs', () => {
    const a = run('a', { task: 'A', settled: true })
    const b = run('b', { task: 'B', live: true })
    const c = run('c', { task: 'C' })
    expect(defaultTarget('implement', [a, b, c])?.sessionId).toBe('b')
  })

  it('with_nothing_building_the_newest_unsettled_task_run_waits_for_the_person', () => {
    const a = run('a', { task: 'A' })
    const b = run('b', { task: 'B', settled: true })
    expect(defaultTarget('implement', [a, b])?.sessionId).toBe('a')
  })

  it('with_every_task_settled_the_newest_is_shown_but_takes_no_input', () => {
    const a = run('a', { task: 'A', settled: true })
    const b = run('b', { task: 'B', settled: true })
    const target = defaultTarget('implement', [a, b])!
    expect(target.sessionId).toBe('b')
    expect(refusal(target)).toContain('Task "B" is settled')
  })

  it('the_plan_chat_talks_to_the_planner_never_to_the_check', () => {
    const plan = run('p', { mode: 'plan' })
    const check = run('c', { mode: 'reconcile', live: true })
    expect(defaultTarget('plan', [plan, check])?.sessionId).toBe('p')
    expect(refusal(check)).toBeDefined()
  })

  it('a_finished_cleanup_still_takes_input', () => {
    const cleanup = run('x', { mode: 'cleanup' })
    expect(defaultTarget('cleanup', [cleanup])?.sessionId).toBe('x')
    expect(refusal(cleanup)).toBeUndefined()
  })

  it('an_ended_fix_run_takes_no_input', () => {
    expect(refusal(run('f', { fixAttempt: 2, settled: true }))).toBe('This fix run is over.')
  })

  it('the_composer_names_the_task_it_reaches', () => {
    expect(recipient(run('t', { task: 'Cancel order' }))).toBe('task Cancel order')
    expect(recipient(run('f', { fixAttempt: 2 }))).toBe('fix run 2')
    expect(recipient(run('p', { mode: 'plan' }))).toBe('planner')
  })
})
