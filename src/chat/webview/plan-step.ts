import type { CleanupUnit, PlanState } from '../protocol'
import { isVerified } from '../../agent/phases/spec-status'
import type { RunBlock } from '../../agent/session/session-status'
import {
  RUN_NOUN,
  capitalized,
  cleanupNext,
  deriveChecking,
  deriveCreated,
  deriveFinalDraft,
  derivePendingReview,
  deriveUnderDevelopment,
  deriveUnderReview,
  deriveVerification,
  failureText,
  onlyBlockedLeft,
  ruling,
  tryAgain,
  type Derived,
} from './plan-step-derive'

/** Re-exported from `./plan-step-derive`, where every other stage's step is also derived. */
export { failureText, onlyBlockedLeft }

/**
 * The plan flow as the person walks it, read off the plan state: which step
 * they are at, which they may go back to, and the one thing to do next. The
 * stage says where the files stand; the step says what that asks of the
 * person, which is what the stepper and the bar's next-step slot show.
 * Whose turn it is comes from the runs, not the stage: a step that expects
 * an agent at work, with none at work, is the person's.
 */

export type Step = 'plan' | 'review' | 'approve' | 'rule' | 'implement' | 'verify' | 'cleanup'

export const STEPS: Step[] = ['plan', 'review', 'approve', 'rule', 'implement', 'verify', 'cleanup']

export const STEP_LABEL: Record<Step, string> = {
  plan: 'Plan',
  review: 'Review',
  approve: 'Approve',
  rule: 'Rule',
  implement: 'Implement',
  verify: 'Verify',
  cleanup: 'Cleanup',
}

/** A tab of the plan view; each step works in one of them. */
export type Tab = 'spec' | 'review' | 'decisions' | 'tasks' | 'cleanup'

/** A tab of the strip: a plan tab, or the conversation. */
export type ViewTab = Tab | 'chat'

export type NextAction = 'check' | 'submit_review' | 'send_rulings' | 'approve' | 'implement' | 'verify' | 'sweep'

export type NextStep =
  /** A button in the bar: the act moves the plan on. `busy` says who is at work beside it, while the act stays the person's. */
  | { kind: 'action'; action: NextAction; label: string; hint: string; busy?: string }
  /** A link in the bar: the act is on a row of the named tab, or in the chat. */
  | { kind: 'goto'; tab: ViewTab; label: string; hint: string }
  /** Nothing to do; the text says who is at work. */
  | { kind: 'waiting'; text: string }
  | { kind: 'done'; text: string }

export type PlanStep = {
  current: Step
  /** Steps the person may open from the stepper: the ones passed, and Review on any draft. */
  reached: Step[]
  next: NextStep
  /** Where to read up beside a bar action, when there is somewhere. */
  goto?: { tab: ViewTab; label: string; hint: string }
  /** The next act is the person's: the flow stands still until they take it. */
  yours: boolean
  /** The tests passed and nothing runs: the plan is complete, and what the cleanup left is the dev's to decide on. */
  complete: boolean
}

/** Who a step waits on while it is not the person's. */
const STEP_AGENT: Record<Step, string> = {
  plan: 'planner',
  review: 'planner',
  approve: 'check',
  rule: 'planner',
  implement: 'implementer',
  verify: 'test run',
  cleanup: 'cleanup',
}

export function planStep(plan: PlanState): PlanStep {
  const derived = derive(plan)
  const step = plan.blocked
    ? { current: derived.current, next: blockedNext(plan.blocked) }
    : derived.next.kind === 'waiting' && !plan.atWork
      ? stopped(derived.current, plan)
      : derived
  const complete = plan.stage === 'verified' && !plan.blocked && !plan.cleanup?.live && !plan.verification?.live && !plan.startingChange
  return { ...step, reached: reached(step.current, plan), yours: !complete && (step.next.kind === 'action' || step.next.kind === 'goto'), complete }
}

/** A run stopped mid-turn on the person outranks every other act: nothing moves until it is answered. */
function blockedNext(block: RunBlock): NextStep {
  const who = RUN_NOUN[block.mode]
  return block.on === 'answer'
    ? { kind: 'goto', tab: 'chat', label: `Question from ${who}`, hint: `${who} asked a question and waits for the answer.` }
    : { kind: 'goto', tab: 'chat', label: `Allow or deny: ${who}`, hint: `${who} waits for you to allow or deny a call.` }
}

/**
 * The step says an agent is at work and none is: its turn ended short of
 * what the step needs, usually with a question asked in prose. The person
 * reads it in the chat, or restarts the work where the bar can.
 */
function stopped(current: Step, plan: PlanState): Derived {
  const chat = { tab: 'chat' as const, label: 'Read the chat', hint: 'What the implementer said when it stopped.' }
  if (plan.implementable) {
    return {
      current,
      next: plan.failure
        ? tryAgain(plan.failure)
        : { kind: 'action', action: 'implement', label: 'Continue implementing', hint: 'Nothing is building the tasks: hand the board back to the implementer, which carries on where it stopped.' },
      goto: chat,
    }
  }
  if (plan.failure) {
    const who = RUN_NOUN[plan.failure.mode]
    return { current, next: { kind: 'goto', tab: 'chat', label: `${capitalized(who)} failed`, hint: failureText(plan.failure) } }
  }
  if (plan.checkable) {
    return { current, next: { kind: 'action', action: 'check', label: 'Check again', hint: 'No check is running and the approved spec still needs one: check it against the code as it stands.' } }
  }
  const who = STEP_AGENT[current]
  return {
    current,
    next: { kind: 'goto', tab: 'chat', label: `The ${who} stopped`, hint: `Nothing is at work on this step: read what the ${who} said in the chat and answer there.` },
  }
}

function derive(plan: PlanState): Derived {
  if (plan.status === 'missing') return { current: 'plan', next: { kind: 'waiting', text: 'the planner is writing the spec' } }
  // A swept feature stands on its spec alone: no board is left to offer a cleanup from.
  if (isVerified(plan.status) && plan.tasks.length === 0) return { current: 'cleanup', next: { kind: 'done', text: 'verified' } }

  // A change or an update was just asked for on this settled feature: the bar says so at once, on whatever step it was showing, rather than only in the chat the request reached.
  if (plan.startingChange) return { current: 'plan', next: { kind: 'waiting', text: 'the planner is working the change' } }

  const pending = pendingRound(plan)
  if (pending) return derivePendingReview(pending)

  if (plan.stage === 'under_review') return deriveUnderReview(plan)
  if (plan.stage === 'final_draft') return deriveFinalDraft(plan)
  if (plan.stage === 'created') return deriveCreated(plan)
  if (plan.stage === 'checking') return deriveChecking(plan)
  if (plan.stage === 'ruling') return ruling(plan)
  if (plan.stage === 'under_development') return deriveUnderDevelopment(plan)
  if (plan.stage === 'verification') return deriveVerification(plan)

  // verified
  return { current: 'cleanup', next: cleanupNext(plan) }
}

/** Every step up to the current one; a draft can always take a comment, so Review stays open on one. */
function reached(current: Step, plan: PlanState): Step[] {
  const steps = shownSteps(plan).slice(0, shownSteps(plan).indexOf(current) + 1)
  if (plan.status === 'draft' && !steps.includes('review')) steps.push('review')
  return steps
}

/**
 * The steps the stepper shows: Rule only once the check found something,
 * since a clean check asks nothing of the person, and Verify only when a test
 * command applies to the feature, since a step that runs nothing would say
 * tests were run.
 */
export function shownSteps(plan: PlanState): Step[] {
  return STEPS.filter((step) => (step !== 'rule' || plan.decisions.length > 0) && (step !== 'verify' || plan.verifies))
}

const TAB_ORDER: Tab[] = ['spec', 'review', 'decisions', 'tasks', 'cleanup']

/** The tabs with something on them, in fixed order; the spec is always there. */
export function presentTabs(plan: PlanState): Tab[] {
  return TAB_ORDER.filter((tab) => {
    switch (tab) {
      case 'spec':
        return true
      case 'review':
        return plan.review.rounds.length > 0
      case 'decisions':
        return plan.decisions.length > 0
      case 'tasks':
        return plan.tasks.length > 0
      case 'cleanup':
        // The tab is there from the moment the tests pass, so the step the build hands over to has a page of its own
        // before anything is measured; a swept feature has no board left to offer a cleanup from.
        return (
          (plan.stage === 'verified' && plan.tasks.length > 0) ||
          (plan.cleanupSweep?.units.length ?? 0) > 0 ||
          plan.cleanup !== undefined ||
          plan.cleanupDecision !== undefined ||
          plan.cleanupProgress !== undefined
        )
    }
  })
}

/** The units the sweep found while the offer to split them still stands. */
export function offeredUnits(plan: PlanState): CleanupUnit[] {
  if (plan.cleanup?.live || plan.cleanupDecision === 'skipped' || plan.cleanupDecision === 'done') return []
  return plan.cleanupSweep?.units ?? []
}

/** The tab's name with the count that says whether it needs the reader. */
export function tabLabel(tab: Tab, plan: PlanState): string {
  switch (tab) {
    case 'spec':
      return 'Spec'
    case 'review': {
      const open = plan.review.rounds.flatMap((r) => r.comments).filter((c) => !c.closed).length
      return counted('Review', open)
    }
    case 'decisions':
      return counted('Decisions', plan.decisions.filter((d) => d.state === 'open').length)
    case 'tasks': {
      const live = plan.tasks.filter((t) => !t.removed)
      if (!live.some((t) => t.state !== 'open')) return `Tasks (${live.length})`
      return `Tasks (${live.filter((t) => t.state === 'tested').length} of ${live.length})`
    }
    case 'cleanup':
      return counted('Cleanup', offeredUnits(plan).length)
  }
}

const counted = (label: string, n: number): string => (n > 0 ? `${label} (${n})` : label)

/** The tab a step works in, given what the plan has to show there. */
export function tabFor(step: Step, plan: PlanState): Tab {
  switch (step) {
    case 'review':
      return plan.review.rounds.length > 0 ? 'review' : 'spec'
    case 'rule':
      return 'decisions'
    case 'implement':
    case 'verify':
      return 'tasks'
    case 'cleanup': {
      const present = presentTabs(plan)
      return present.includes('cleanup') ? 'cleanup' : present.includes('tasks') ? 'tasks' : 'spec'
    }
    default:
      return 'spec'
  }
}

/** The round being written, when it holds something to submit. */
function pendingRound(plan: PlanState) {
  const last = plan.review.rounds.at(-1)
  if (!last || last.submittedAt !== undefined) return undefined
  return last.comments.length + last.strikes.length > 0 ? last : undefined
}
