import { PLAN_DIR, featureSlug, specPath } from './blind-plan'
import {
  PLAN_TARGET,
  findItem,
  planItems,
  readReview,
  reviewFile,
  reviewPath,
  struckItems,
  submitRound,
  writeReview,
  type ReviewComment,
  type ReviewRound,
} from './plan-review'
import { readSpecState } from './spec-file'

/** How a submitted review reaches the plan session: the owning one, or a fresh one when it is gone. */
export interface ReviewCourier {
  isLive(sessionId: string): boolean
  send(sessionId: string, text: string): Promise<void>
  start(feature: string, prompt: string): Promise<void>
}

/** The plan session that wrote the spec; decisions in it are ruled on there too, the check is a run, not an owner. */
export type ReviewOwner = { sessionId: string }

/** A comment as the agent gets it: the item it names, or the text it was written against when that name is gone. */
type CarriedComment = { comment: ReviewComment; itemText: string | undefined; orphaned: boolean }

function carry(round: ReviewRound, body: string): CarriedComment[] {
  return round.comments.map((comment) => {
    if (comment.target === PLAN_TARGET) return { comment, itemText: undefined, orphaned: false }
    const item = findItem(body, comment.target)
    return {
      comment,
      itemText: item ? item.text : comment.item,
      orphaned: item === undefined,
    }
  })
}

function commentLine({ comment, itemText, orphaned }: CarriedComment): string {
  if (comment.target === PLAN_TARGET) return `- On the plan as a whole: ${comment.text}`
  if (!orphaned) return `- On "${comment.target}": ${comment.text}`
  const was = itemText ? ` It was written against: "${itemText}".` : ''
  return `- On "${comment.target}", which is no longer in the plan:${was} ${comment.text}`
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Struck items the artifact still presents as live: a strike the plan has not honoured yet. */
export function standingStrikes(body: string, struck: string[]): string[] {
  return struck.filter((name) => {
    const item = findItem(body, name)
    return item !== undefined && !item.removed
  })
}

/** Nothing is left to build: every item the artifact has is struck or already removed. */
export function emptied(body: string, struck: string[]): boolean {
  const items = planItems(body)
  return items.length > 0 && items.every((i) => i.removed || struck.some((s) => same(s, i.name)))
}

/**
 * The message a review is handed over as. It stands on its own: the session
 * reads the plan and the review from disk, so a fresh plan session can revise
 * exactly as the session that wrote the plan would.
 */
export function reviewPrompt(options: {
  feature: string
  round: ReviewRound
  body: string
  struck: string[]
}): string {
  const { feature, round, body, struck } = options
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  const review = reviewFile(feature)
  const comments = carry(round, body)
  const lines = [
    `The human reviewed the plan for "${feature}" and submitted round ${round.number} of comments.`,
    '',
    `Read the plan at \`${spec}\` and the review at \`${review}\` from disk before you change anything; everything you need is in those two files, not in this conversation.`,
    '',
  ]
  lines.push(
    round.strikes.length > 0
      ? `Struck in this round, to be removed: ${round.strikes.join(', ')}.`
      : 'Nothing was struck in this round.',
  )
  const earlier = struck.filter((s) => !round.strikes.includes(s))
  if (earlier.length > 0) lines.push(`Struck in earlier rounds and still gone: ${earlier.join(', ')}.`)
  // A strike that the plan no longer honours is named, so a resurrected item is caught rather than argued about.
  const standing = standingStrikes(body, struck)
  if (standing.length > 0) {
    lines.push(`Struck but still standing in the plan, to be marked removed: ${standing.join(', ')}.`)
  }
  if (emptied(body, struck)) {
    lines.push('', 'Every item in the plan is now struck: nothing remains.')
  }
  lines.push('', comments.length > 0 ? 'Comments:' : 'No comments in this round.')
  for (const carried of comments) lines.push(commentLine(carried))
  lines.push(
    '',
    `In the plan, \`${spec}\`:`,
    '- Mark every struck item removed by appending ` [removed]` to its line. Do not delete the line and do not rename anything: a name belongs to the rule it was given to, for good, and a comment is never answered by renaming its rule.',
    '- Repair the items that referred to a removed item, so the plan still holds together without it.',
    '- Never reintroduce a struck item, in this round or a later one. Only a new comment from the human can bring one back.',
    '- If every item is now struck, change nothing further: report that nothing remains and stop. Do not invent a replacement plan.',
    '',
    `In the review, \`${review}\`:`,
    '- Answer every comment of this round. Under its line, indented two spaces, add exactly one of:',
    '  - `  - addressed: what you changed` when you did what it asks;',
    '  - `  - disagreed: why you will not` when you will not, with the reason stated.',
    '- Never leave a comment unanswered and never remove one. The comments and the remove list are the human\u2019s; touch nothing else in that file.',
    '',
    'Then, in chat: what changed in the plan since the review was submitted, and each comment with its resolution. Then stop; the human decides what happens next.',
  )
  return lines.join('\n')
}

/**
 * Submits the pending round: marks it submitted on disk and hands plan and
 * review to the session that owns the artifact, or to a fresh plan session
 * when that session is gone. An empty review is refused.
 */
export async function submitReview(options: {
  courier: ReviewCourier
  cwd: string
  feature: string
  owner: ReviewOwner
  now?: string
}): Promise<ReviewRound> {
  const { courier, cwd, feature, owner } = options
  const spec = specPath(cwd, feature)
  const state = await readSpecState(spec)
  if (!state.exists) throw new Error('No plan to review yet.')
  if (state.status !== 'draft') throw new Error('An approved plan is not commentable: reopen or supersede it.')

  const path = reviewPath(cwd, feature)
  const review = await readReview(path)
  const round = submitRound(review, options.now ?? new Date().toISOString())
  await writeReview(path, review, `${PLAN_DIR}/${featureSlug(feature)}.spec.md`)

  const prompt = reviewPrompt({ feature, round, body: state.body, struck: struckItems(review) })
  if (courier.isLive(owner.sessionId)) await courier.send(owner.sessionId, prompt)
  else await courier.start(feature, prompt)
  return round
}
