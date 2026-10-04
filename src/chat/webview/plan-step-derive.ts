import type { PlanState, RunFailure } from '../protocol'
import type { ReviewRound } from '../../agent/phases/plan-review'
import type { Task } from '../../agent/phases/tasks-file'
import type { SessionMode } from '../../agent/session/session-manager'
import type { NextStep, PlanStep, Step } from './plan-step'

/** What a stage derives the plan step down to, before `reached`, `yours` and `complete` are filled in from the same `PlanState` by `planStep`. */
export type Derived = Omit<PlanStep, 'reached' | 'yours' | 'complete'>

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Nothing is left to build but blocked tasks: with no run at work, the build stands still until the person hands one back or accepts it. */
export function onlyBlockedLeft(live: Task[]): boolean {
  const unfinished = live.filter((t) => t.state !== 'tested')
  return unfinished.length > 0 && unfinished.every((t) => t.state === 'blocked')
}

export const RUN_NOUN: Record<SessionMode, string> = {
  chat: 'the session',
  plan: 'the planner',
  reconcile: 'the check',
  implement: 'the implementer',
  cleanup: 'the cleanup',
  'code-plan': 'the planner',
  'docs-map': 'the docs map',
  'file-decisions': 'the filing session',
  'doc-migration': 'the docs cleanup',
}

export const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** What the bar says about a run whose last turn failed. */
export const failureText = (failure: RunFailure): string => `${capitalized(RUN_NOUN[failure.mode])} failed: ${failure.message}`

/** A failed turn is retried by the same act that starts the build; the reason rides along so the dev fixes it first. */
export function tryAgain(failure: RunFailure): NextStep {
  return { kind: 'action', action: 'implement', label: 'Try again', hint: `${failureText(failure)}. Fix the cause, then hand the board back to the implementer.` }
}

/** A pending round still being written holds a count to submit; nothing else is offered until it is sent. */
export function derivePendingReview(pending: ReviewRound): Derived {
  const n = pending.comments.length + pending.strikes.length
  return {
    current: 'review',
    next: { kind: 'action', action: 'submit_review', label: `Submit review (${n})`, hint: 'Hand the plan and this review to the session that owns it.' },
  }
}

export function deriveUnderReview(plan: PlanState): Derived {
  const unanswered = plan.review.rounds.flatMap((r) => r.comments).filter((c) => !c.resolution).length
  return { current: 'review', next: { kind: 'waiting', text: `the planner is answering ${plural(unanswered, 'comment')}` } }
}

export function deriveFinalDraft(plan: PlanState): Derived {
  const open = plan.review.rounds.flatMap((r) => r.comments).filter((c) => !c.closed).length
  return {
    current: 'review',
    next: { kind: 'goto', tab: 'review', label: `${plural(open, 'answer')} to read`, hint: 'Read what the planner answered and resolve each comment; then the spec can be approved.' },
  }
}

export function deriveCreated(plan: PlanState): Derived {
  // A draft an earlier mapping left decisions on is ruled before it is approved.
  if (plan.pendingDecisions > 0) return ruling(plan)
  if (!plan.approvable) return { current: 'approve', next: { kind: 'waiting', text: 'the planner is revising the spec' } }
  return {
    current: 'approve',
    next: {
      kind: 'action',
      action: 'approve',
      label: 'Approve',
      hint: 'Comment on the spec first, or approve it as it stands: the code is checked against it, and the build starts unless the code disagrees.',
      // A planner turn on a draft says what it found in the chat alone; the bar carries that something is under way, approval still the person's.
      ...(plan.atWork ? { busy: 'the planner is at work on the draft; it answers in the chat' } : {}),
    },
  }
}

export function deriveChecking(plan: PlanState): Derived {
  if (plan.check?.live) return { current: 'approve', next: { kind: 'waiting', text: plan.check.text } }
  if (plan.applyingRulings) return { current: 'rule', next: { kind: 'waiting', text: `the planner is applying ${plural(plan.pendingDecisions, 'ruling')}` } }
  return { current: 'approve', next: { kind: 'waiting', text: 'the spec is checked against the code' } }
}

/** The check found what the person rules on: proposals first, then the rulings, then the planner applies them. */
export function ruling(plan: PlanState): Derived {
  const unproposed = plan.decisions.filter((d) => d.state === 'open' && d.proposals.length === 0).length
  if (unproposed > 0) return { current: 'rule', next: { kind: 'waiting', text: `the planner is proposing on ${plural(unproposed, 'decision')}` } }
  if (plan.applyingRulings) return { current: 'rule', next: { kind: 'waiting', text: `the planner is applying ${plural(plan.pendingDecisions, 'ruling')}` } }
  if (plan.pendingDecisions > 0) {
    const open = plan.decisions.filter((d) => d.state === 'open').length
    // Every ruling is the user's: with several options to choose from there is no default, so the bar links to the wizard until all are ruled.
    if (open > 0) return { current: 'rule', next: { kind: 'goto', tab: 'decisions', label: `${open} to rule on`, hint: 'Rule on each decision: change the spec one of the proposed ways, keep it and change the code instead, or say it in your own words.' } }
    return {
      current: 'rule',
      next: {
        kind: 'action',
        action: 'send_rulings',
        label: `Send rulings (${plan.pendingDecisions})`,
        hint: 'Hand the rulings to the planner, which revises the rules; the spec is then checked again and the build starts.',
      },
    }
  }
  return { current: 'rule', next: { kind: 'waiting', text: 'the spec is checked against the code' } }
}

export function deriveUnderDevelopment(plan: PlanState): Derived {
  if (plan.reviewingDocs) return { current: 'approve', next: { kind: 'waiting', text: 'the planner is listing what the docs should now say; the implementation starts after it' } }
  const live = plan.tasks.filter((t) => !t.removed)
  if (plan.implementable && !live.some((t) => t.state !== 'open')) return deriveImplementStart(plan)
  return deriveBuildProgress(plan, live)
}

/** The clean check starts the build: this is the way back in when nothing is building the tasks. */
function deriveImplementStart(plan: PlanState): Derived {
  if (plan.failure) return { current: 'implement', next: tryAgain(plan.failure) }
  return { current: 'implement', next: { kind: 'action', action: 'implement', label: 'Implement', hint: 'Nothing is building the tasks: pick the board up in a session that builds them one by one.' } }
}

function deriveBuildProgress(plan: PlanState, live: Task[]): Derived {
  const tested = live.filter((t) => t.state === 'tested').length
  const blocked = live.filter((t) => t.state === 'blocked').length
  // The build handed each one back once and it stayed blocked: the person decides, on the task's row.
  if (!plan.atWork && !plan.failure && onlyBlockedLeft(live)) {
    return {
      current: 'implement',
      next: {
        kind: 'goto',
        tab: 'tasks',
        label: `${plural(blocked, 'task')} still blocked`,
        hint: 'Every other task is finished and these stayed blocked after another look: hand one back to its run, answer it in its chat, or accept it as it is.',
      },
    }
  }
  // The scenario under way is what the person wants to know; the count is how far along it is.
  const current = live.find((t) => t.state === 'in_progress')
  const where = current ? `${current.group ?? current.name}, ` : ''
  const progress = `${where}${tested} of ${live.length} tested${blocked > 0 ? `, ${blocked} blocked` : ''}`
  return { current: 'implement', next: { kind: 'waiting', text: progress } }
}

export function deriveVerification(plan: PlanState): Derived {
  // With no test command for the tasks' files the step is not shown: the empty run that moves the feature on is the end of Implement.
  const current: Step = plan.verifies ? 'verify' : 'implement'
  if (plan.verification?.live) return { current, next: { kind: 'waiting', text: plan.verification.text } }
  // A failed run goes to a fix run, which starts the tests again when its turn ends: running them under it would test half-made fixes.
  if (plan.atWork) return { current, next: { kind: 'waiting', text: 'the implementer is fixing the failed tests' } }
  return {
    current,
    next: { kind: 'action', action: 'verify', label: plan.lastVerification ? 'Verify again' : 'Verify', hint: 'Run the test commands over the files the tasks name.' },
  }
}

/**
 * The cleanup step: the split is offered, never taken on the user's behalf.
 * A run in flight speaks for itself; an offer and a postponement point at the
 * list on the Cleanup tab, where the choices are; a feature with no sweep
 * to show can ask for one.
 */
export function cleanupNext(plan: PlanState): NextStep {
  if (plan.cleanup?.live) return { kind: 'waiting', text: plan.cleanup.text }
  const units = plan.cleanupSweep?.units.length ?? 0
  if (units > 0 && plan.cleanupDecision !== 'skipped' && plan.cleanupDecision !== 'done') {
    const label = plan.cleanupDecision === 'postponed' ? `Cleanup postponed (${units})` : `${plural(units, 'unit')} over the limit`
    return { kind: 'goto', tab: 'cleanup', label, hint: 'Pick the files the sweep found to split, leave it for later, or settle the feature as it stands.' }
  }
  if (plan.cleanupDecision === 'skipped') return { kind: 'done', text: 'cleanup skipped' }
  if (plan.cleanupSweep || plan.cleanupDecision === 'done') return { kind: 'done', text: 'verified' }
  return { kind: 'action', action: 'sweep', label: 'Check sizes', hint: 'Measure the files this feature touched against the size limits.' }
}
