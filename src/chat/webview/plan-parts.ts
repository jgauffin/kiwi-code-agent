import type { PlanState } from '../protocol'
import type { Decision } from '../../agent/phases/decisions'
import { KEEP_RULING } from '../../agent/phases/ruling'
import type { CommentRef, Review, ReviewComment } from '../../agent/phases/plan-review'
import type { Item, Spec } from '../../agent/phases/spec-model'
import type { Task, TaskState } from '../../agent/phases/tasks-file'
import { el } from './dom'

/** The comment target that stands for the artifact rather than one of its rules. */
export const PLAN_TARGET = 'plan'

/** The state a task or decision line carries in the file; the board says it as a badge instead. */
export const MARKER = /\s*\[(?:in progress|done|tested|removed|applied|withdrawn|blocked[^\]]*)\]/gi

export const TASK_STATE: Record<TaskState, string> = {
  open: 'open',
  in_progress: 'in progress',
  done: 'done',
  tested: 'tested',
  blocked: 'blocked',
}

export const DECISION_STATE: Record<Decision['state'], string> = {
  open: 'to rule on',
  ruled: 'ruled',
  applied: 'applied',
  withdrawn: 'withdrawn',
}

/** A comment box on a rule or the plan, an edit of a pending comment, or a ruling being written on a decision. */
export type Editor = { kind: 'comment'; target: string; comment?: CommentRef; text: string } | { kind: 'ruling'; target: string; text: string }

/** A comment with its place in the review, which is how the host addresses it. */
export type PlacedComment = { ref: CommentRef; comment: ReviewComment; pending: boolean }

export const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export const sameRef = (a: CommentRef, b: CommentRef): boolean => a.round === b.round && a.index === b.index

export function pendingRound(review: Review) {
  const last = review.rounds.at(-1)
  return last && last.submittedAt === undefined ? last : undefined
}

/** Decisions still in play: open, or ruled and with the planner. */
export function pendingDecisions(plan: PlanState): Decision[] {
  return plan.decisions.filter((d) => d.state === 'open' || d.state === 'ruled')
}

/**
 * The rule, edge case or question of that name; undefined once the spec no
 * longer has it. Here rather than in the spec model, which the webview cannot
 * import: it reads files.
 */
export function itemNamed(spec: Spec, name: string): Item | undefined {
  for (const scenario of spec.scenarios) {
    for (const behaviour of scenario.behaviours) {
      if (same(behaviour.name, name)) return behaviour
      const edge = behaviour.edges.find((e) => same(e.name, name))
      if (edge) return edge
    }
  }
  return spec.questions.find((q) => same(q.name, name))
}

/** A proposal is a rule's new text, written with the `**Name**:` lead-in the spec line has; the card names the rule itself. */
export function rewrittenRule(proposal: string, decision: Decision, plan: PlanState): { name: string; text: string } | undefined {
  const lead = /^\*\*([^*]+?)\*\*\s*:?\s*([\s\S]*)$/.exec(proposal.trim())
  if (!lead) return undefined
  const name = lead[1]!.trim().replace(/:$/, '').trim()
  const known = decision.on.some((n) => same(n, name)) || (plan.spec !== undefined && itemNamed(plan.spec, name) !== undefined)
  return known ? { name, text: lead[2]!.trim() } : undefined
}

/** The ruling as the reader should see it: `keep` says what it means, anything else is the text as written. */
export function rulingText(decision: Decision): string {
  return decision.ruling !== undefined && same(decision.ruling, KEEP_RULING) ? 'keep the spec; the code changes' : (decision.ruling ?? '')
}

export function struckItems(review: Review): string[] {
  return review.rounds.flatMap((r) => r.strikes)
}

/** Every comment on a target with where it sits, since the file gives a comment no id of its own. */
export function commentsOn(review: Review, target: string): PlacedComment[] {
  const placed: PlacedComment[] = []
  for (const round of review.rounds) {
    round.comments.forEach((comment, index) => {
      if (same(comment.target, target)) placed.push({ ref: { round: round.number, index }, comment, pending: round.submittedAt === undefined })
    })
  }
  return placed
}

export function note(text: string): HTMLElement {
  return el('p', 'note', text)
}

/** The re-map waits for the rulings to be applied: a board mapped under a pending decision would go stale on the revision. */
export function staleNote(pending: string[]): string {
  if (pending.length === 0) return 'The tasks predate the last change to the spec; they are re-mapped when the plan session’s turn ends.'
  return `The tasks predate the last change to the spec; they are re-mapped once ${pending.map((t) => `"${t}"`).join(', ')} ${pending.length === 1 ? 'is' : 'are'} ruled on and applied.`
}

/** The reason is what the badge should say. */
export function blockedReason(task: Task): string | undefined {
  if (task.state !== 'blocked') return undefined
  return task.blockedReason ? `blocked: ${task.blockedReason}` : 'blocked'
}

export function button(label: string, onClick: () => void, options: { title?: string } = {}): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  if (options.title) node.title = options.title
  node.addEventListener('click', onClick)
  return node
}
