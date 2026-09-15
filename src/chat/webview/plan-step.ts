import type { PlanState } from '../protocol'

/**
 * The plan flow as the person walks it, read off the plan state: which step
 * they are at, which they may go back to, and the one thing to do next. The
 * stage says where the files stand; the step says what that asks of the
 * person, which is what the stepper and the bar's next-step slot show.
 */

export type Step = 'plan' | 'review' | 'map' | 'rule' | 'approve' | 'implement' | 'verify' | 'intent'

export const STEPS: Step[] = ['plan', 'review', 'map', 'rule', 'approve', 'implement', 'verify', 'intent']

export const STEP_LABEL: Record<Step, string> = {
  plan: 'Plan',
  review: 'Review',
  map: 'Map',
  rule: 'Rule',
  approve: 'Approve',
  implement: 'Implement',
  verify: 'Verify',
  intent: 'Intent',
}

/** A tab of the plan view; each step works in one of them. */
export type Tab = 'spec' | 'review' | 'decisions' | 'tasks' | 'intent'

export type NextAction = 'map' | 'submit_review' | 'send_rulings' | 'approve' | 'implement' | 'verify' | 'update_intent'

export type NextStep =
  /** A button in the bar: the act moves the plan on. */
  | { kind: 'action'; action: NextAction; label: string; hint: string }
  /** A link in the bar: the act is on a row of the named tab. */
  | { kind: 'goto'; tab: Tab; label: string; hint: string }
  /** Nothing to do; the text says who is at work. */
  | { kind: 'waiting'; text: string }
  | { kind: 'done'; text: string }

export type PlanStep = {
  current: Step
  /** Steps the person may open from the stepper: the ones passed, and Review on any draft. */
  reached: Step[]
  next: NextStep
  /** Rows to act on beside a bar action, when there are some. */
  goto?: { tab: Tab; label: string }
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function planStep(plan: PlanState): PlanStep {
  const step = derive(plan)
  return { ...step, reached: reached(step.current, plan) }
}

function derive(plan: PlanState): Omit<PlanStep, 'reached'> {
  if (plan.status === 'missing') return { current: 'plan', next: { kind: 'waiting', text: 'the planner is writing the spec' } }

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
      next: { kind: 'goto', tab: 'review', label: `${plural(open, 'answer')} to read`, hint: 'Read what the planner answered and resolve each comment; the last one maps the spec against the code.' },
    }
  }

  if (plan.stage === 'created') {
    if (plan.mapping?.live) return { current: 'map', next: { kind: 'waiting', text: plan.mapping.text } }
    return {
      current: 'review',
      next: {
        kind: 'action',
        action: 'map',
        label: 'Map against code',
        hint: 'Comment on the spec first, or map it as it stands: the mapping reads the code and writes what contradicts the spec as decisions, and the tasks with the files they touch.',
      },
    }
  }

  if (plan.stage === 'mapped' && plan.status === 'draft') return mappedDraft(plan)

  if (plan.stage === 'mapped') {
    if (plan.implementable) {
      return { current: 'implement', next: { kind: 'action', action: 'implement', label: 'Implement', hint: 'Start a fresh session that builds the tasks one by one.' } }
    }
    return { current: 'implement', next: { kind: 'waiting', text: 'start the implementation from the plan session' } }
  }

  if (plan.stage === 'under_development') {
    const live = plan.tasks.filter((t) => !t.removed)
    const tested = live.filter((t) => t.state === 'tested').length
    const blocked = live.filter((t) => t.state === 'blocked').length
    const progress = `${tested} of ${live.length} tested${blocked > 0 ? `, ${blocked} blocked` : ''}`
    return { current: 'implement', next: { kind: 'waiting', text: progress } }
  }

  if (plan.stage === 'verification') {
    if (plan.verification?.live) return { current: 'verify', next: { kind: 'waiting', text: plan.verification.text } }
    return {
      current: 'verify',
      next: { kind: 'action', action: 'verify', label: plan.lastVerification ? 'Verify again' : 'Verify', hint: 'Run the test commands over the files the tasks name.' },
    }
  }

  // verified
  if (plan.cleanup?.live) return { current: 'verify', next: { kind: 'waiting', text: plan.cleanup.text } }
  if (plan.intent?.applicable) {
    const n = plan.intent.pending
    return {
      current: 'intent',
      next: {
        kind: 'action',
        action: 'update_intent',
        label: `Update intent (${n})`,
        hint: `Write the ${plural(n, 'amendment')} in ${plan.intent.path} into the intent docs, so the next feature is planned from what this one settled.`,
      },
    }
  }
  return { current: 'intent', next: { kind: 'done', text: 'verified' } }
}

function mappedDraft(plan: PlanState): Omit<PlanStep, 'reached'> {
  const decisions = plan.spec?.decisions ?? []
  const unproposed = decisions.filter((d) => d.state === 'open' && !d.proposal).length
  if (unproposed > 0) return { current: 'rule', next: { kind: 'waiting', text: `the planner is proposing on ${plural(unproposed, 'decision')}` } }
  if (plan.applyingRulings) return { current: 'rule', next: { kind: 'waiting', text: `the planner is applying ${plural(plan.pendingDecisions, 'ruling')}` } }
  if (plan.pendingDecisions > 0) {
    const open = decisions.filter((d) => d.state === 'open').length
    return {
      current: 'rule',
      next: {
        kind: 'action',
        action: 'send_rulings',
        label: `Send rulings (${plan.pendingDecisions})`,
        hint: 'Hand the rulings to the planner; a proposal not ruled on counts as accepted. The planner revises the rules, then the plan can be approved.',
      },
      ...(open > 0 ? { goto: { tab: 'decisions', label: `${open} to rule on` } } : {}),
    }
  }
  if (plan.stale) {
    return { current: 'map', next: { kind: 'waiting', text: plan.mapping?.live ? plan.mapping.text : "re-mapped when the planner's turn ends" } }
  }
  return { current: 'approve', next: { kind: 'action', action: 'approve', label: 'Approve', hint: 'Approve this plan: the spec and its tasks.' } }
}

/** Every step up to the current one; a draft can always take a comment, so Review stays open on one. */
function reached(current: Step, plan: PlanState): Step[] {
  const steps = STEPS.slice(0, STEPS.indexOf(current) + 1)
  if (plan.status === 'draft' && !steps.includes('review')) steps.push('review')
  return steps
}

/** The tab a step works in, given what the plan has to show there. */
export function tabFor(step: Step, plan: PlanState): Tab {
  switch (step) {
    case 'review':
      return plan.review.rounds.length > 0 ? 'review' : 'spec'
    case 'map':
      return plan.tasks.length > 0 ? 'tasks' : 'spec'
    case 'rule':
      return 'decisions'
    case 'implement':
    case 'verify':
      return 'tasks'
    case 'intent':
      return plan.intent ? 'intent' : 'tasks'
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
