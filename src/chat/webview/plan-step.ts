import type { CleanupUnit, PlanState, RunFailure } from '../protocol'
import { isVerified } from '../../agent/phases/spec-status'
import type { SessionMode } from '../../agent/session/session-manager'
import type { RunBlock } from '../../agent/session/session-status'

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
  /** A button in the bar: the act moves the plan on. */
  | { kind: 'action'; action: NextAction; label: string; hint: string }
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

type Derived = Omit<PlanStep, 'reached' | 'yours' | 'complete'>

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

const RUN_NOUN: Record<SessionMode, string> = {
  chat: 'the session',
  plan: 'the planner',
  reconcile: 'the check',
  implement: 'the implementer',
  cleanup: 'the cleanup',
  'code-plan': 'the planner',
  docs: 'the docs session',
  'docs-map': 'the docs map',
  'file-decisions': 'the filing session',
  'doc-migration': 'the migration session',
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
  const complete = plan.stage === 'verified' && !plan.blocked && !plan.cleanup?.live && !plan.verification?.live
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

/** A failed turn is retried by the same act that starts the build; the reason rides along so the dev fixes it first. */
function tryAgain(failure: RunFailure): NextStep {
  return { kind: 'action', action: 'implement', label: 'Try again', hint: `${failureText(failure)}. Fix the cause, then hand the board back to the implementer.` }
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** What the bar says about a run whose last turn failed. */
export const failureText = (failure: RunFailure): string => `${capitalized(RUN_NOUN[failure.mode])} failed: ${failure.message}`

function derive(plan: PlanState): Derived {
  if (plan.status === 'missing') return { current: 'plan', next: { kind: 'waiting', text: 'the planner is writing the spec' } }
  // A swept feature stands on its spec alone: no board is left to offer a cleanup from.
  if (isVerified(plan.status) && plan.tasks.length === 0) return { current: 'cleanup', next: { kind: 'done', text: 'verified' } }

  const pending = pendingRound(plan)
  if (pending) {
    const n = pending.comments.length + pending.strikes.length
    return {
      current: 'review',
      next: {
        kind: 'action',
        action: 'submit_review',
        label: `Submit review (${n})`,
        hint: 'Hand the plan and this review to the session that owns it.',
      },
    }
  }

  if (plan.stage === 'under_review') {
    const unanswered = plan.review.rounds.flatMap((r) => r.comments).filter((c) => !c.resolution).length
    return { current: 'review', next: { kind: 'waiting', text: `the planner is answering ${plural(unanswered, 'comment')}` } }
  }

  if (plan.stage === 'final_draft') {
    const open = plan.review.rounds.flatMap((r) => r.comments).filter((c) => !c.closed).length
    return {
      current: 'review',
      next: { kind: 'goto', tab: 'review', label: `${plural(open, 'answer')} to read`, hint: 'Read what the planner answered and resolve each comment; then the spec can be approved.' },
    }
  }

  if (plan.stage === 'created') {
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
      },
    }
  }

  if (plan.stage === 'checking') {
    if (plan.check?.live) return { current: 'approve', next: { kind: 'waiting', text: plan.check.text } }
    if (plan.applyingRulings) return { current: 'rule', next: { kind: 'waiting', text: `the planner is applying ${plural(plan.pendingDecisions, 'ruling')}` } }
    return { current: 'approve', next: { kind: 'waiting', text: 'the spec is checked against the code' } }
  }

  if (plan.stage === 'ruling') return ruling(plan)

  if (plan.stage === 'under_development') {
    if (plan.reviewingDocs) return { current: 'approve', next: { kind: 'waiting', text: 'the planner is listing what the docs should now say; the implementation starts after it' } }
    const live = plan.tasks.filter((t) => !t.removed)
    if (plan.implementable && !live.some((t) => t.state !== 'open')) {
      // The clean check starts the build: this is the way back in when nothing is building the tasks.
      if (plan.failure) return { current: 'implement', next: tryAgain(plan.failure) }
      return { current: 'implement', next: { kind: 'action', action: 'implement', label: 'Implement', hint: 'Nothing is building the tasks: pick the board up in a session that builds them one by one.' } }
    }
    const tested = live.filter((t) => t.state === 'tested').length
    const blocked = live.filter((t) => t.state === 'blocked').length
    // The scenario under way is what the person wants to know; the count is how far along it is.
    const current = live.find((t) => t.state === 'in_progress')
    const where = current ? `${current.group ?? current.name}, ` : ''
    const progress = `${where}${tested} of ${live.length} tested${blocked > 0 ? `, ${blocked} blocked` : ''}`
    return { current: 'implement', next: { kind: 'waiting', text: progress } }
  }

  if (plan.stage === 'verification') {
    if (plan.verification?.live) return { current: 'verify', next: { kind: 'waiting', text: plan.verification.text } }
    // A failed run goes to a fix run, which starts the tests again when its turn ends: running them under it would test half-made fixes.
    if (plan.atWork) return { current: 'verify', next: { kind: 'waiting', text: 'the implementer is fixing the failed tests' } }
    return {
      current: 'verify',
      next: { kind: 'action', action: 'verify', label: plan.lastVerification ? 'Verify again' : 'Verify', hint: 'Run the test commands over the files the tasks name.' },
    }
  }

  // verified
  return { current: 'cleanup', next: cleanupNext(plan) }
}

/**
 * The cleanup step: the split is offered, never taken on the user's behalf.
 * A run in flight speaks for itself; an offer and a postponement point at the
 * list on the Cleanup tab, where the choices are; a feature with no sweep
 * to show can ask for one.
 */
function cleanupNext(plan: PlanState): NextStep {
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

/** The check found what the person rules on: proposals first, then the rulings, then the planner applies them. */
function ruling(plan: PlanState): Derived {
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

/** Every step up to the current one; a draft can always take a comment, so Review stays open on one. */
function reached(current: Step, plan: PlanState): Step[] {
  const steps = shownSteps(plan).slice(0, shownSteps(plan).indexOf(current) + 1)
  if (plan.status === 'draft' && !steps.includes('review')) steps.push('review')
  return steps
}

/** The steps the stepper shows: Rule only once the check found something, since a clean check asks nothing of the person. */
export function shownSteps(plan: PlanState): Step[] {
  return STEPS.filter((step) => step !== 'rule' || plan.decisions.length > 0)
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
        return (plan.cleanupSweep?.units.length ?? 0) > 0 || plan.cleanup !== undefined || plan.cleanupDecision !== undefined || plan.cleanupProgress !== undefined
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
