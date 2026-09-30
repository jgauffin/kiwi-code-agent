import type { RunControls, RunRef } from './protocol'
import type { Step } from './webview/plan-step'

/**
 * Which conversation a feature tab's chat shows follows the phase the reader
 * picked on the stepper, and what they type reaches that phase's run alone.
 * `session` is the one chat of a tab that belongs to no feature.
 */
export type ChatPhase = 'plan' | 'implement' | 'verify' | 'cleanup' | 'session'

export const PHASE_LABEL: Record<ChatPhase, string> = {
  plan: 'Plan',
  implement: 'Implement',
  verify: 'Verify',
  cleanup: 'Cleanup',
  session: 'Session',
}

/** Review, approval and rulings are all spoken with the planner, so they share its chat. */
export function phaseOfStep(step: Step): ChatPhase {
  switch (step) {
    case 'implement':
    case 'verify':
    case 'cleanup':
      return step
    default:
      return 'plan'
  }
}

/** A fix run mends what a test run named, so it belongs to Verify; every other implementer builds tasks. */
export function phaseOfRun(run: RunRef): ChatPhase {
  switch (run.mode) {
    case 'plan':
    case 'reconcile':
      return 'plan'
    case 'implement':
      return run.fixAttempt === undefined ? 'implement' : 'verify'
    case 'cleanup':
      return 'cleanup'
    default:
      return 'session'
  }
}

/**
 * Why a run takes no input, or undefined when it does. A settled task or fix
 * run woken again would move the board on behind the build's back, and the
 * check reports to the decisions file rather than to the person.
 */
export function refusal(run: RunControls): string | undefined {
  if (run.mode === 'reconcile') return 'The check against the code is not a conversation.'
  if (run.mode === 'implement' && run.settled) {
    return run.task !== undefined ? `Task "${run.task}" is settled; pick the task being built to talk to it.` : 'This fix run is over.'
  }
  return undefined
}

/** Who the composer reaches, as it names them. */
export function recipient(run: RunControls): string {
  switch (run.mode) {
    case 'plan':
      return 'planner'
    case 'reconcile':
      return 'check'
    case 'implement':
      if (run.task !== undefined) return `task ${run.task}`
      return run.fixAttempt !== undefined ? `fix run ${run.fixAttempt}` : 'implementer'
    case 'cleanup':
      return 'cleanup'
    default:
      return run.title
  }
}

/**
 * The run a phase's chat talks to until the reader picks another: the planner,
 * the task being built (else the newest one still unsettled), the newest fix
 * run or cleanup. `runs` are the phase's own, oldest first.
 */
export function defaultTarget(phase: ChatPhase, runs: RunControls[]): RunControls | undefined {
  const newestFirst = [...runs].reverse()
  switch (phase) {
    case 'plan':
      return newestFirst.find((r) => r.mode === 'plan')
    case 'implement':
    case 'verify':
      return newestFirst.find((r) => r.live) ?? newestFirst.find((r) => !r.settled) ?? newestFirst[0]
    default:
      return newestFirst[0]
  }
}
