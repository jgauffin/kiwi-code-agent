import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PLAN_DIR, featureSlug } from './blind-plan'
import type { SpecState } from './spec-file'
import { parseSpec, specItems } from './spec-model'

/**
 * A review of a draft plan artifact: the human's comments and strikes, the
 * agent's resolutions. It lives next to the spec as markdown so it survives a
 * reload, stays readable after approval, and can be written to by the agent
 * with the same tools it uses on the spec.
 */

export type ResolutionKind = 'addressed' | 'disagreed'

export type Resolution = { kind: ResolutionKind; text: string }

/** Target of a comment on the artifact as a whole rather than on an item. */
export const PLAN_TARGET = 'plan'

export type ReviewComment = {
  /** C1, C2, ... stable once the round is submitted. */
  id: string
  /** An item id (B3, T1, F2) or `plan` for the artifact as a whole. */
  target: string
  text: string
  /** The item's text when the comment was written; carried to the agent when the id is gone (E5). */
  item?: string
  /** Written by the agent when it revises; every comment gets one (B6). */
  resolution?: Resolution
  /** The human accepted the resolution. An unaccepted comment is open and blocks approval (B8, B10). */
  closed?: boolean
}

export type ReviewRound = {
  number: number
  /** ISO timestamp of submission; absent while the round is still being written. */
  submittedAt?: string
  comments: ReviewComment[]
  /** Ids of items the human wants gone (B2). */
  strikes: string[]
}

export type Review = { rounds: ReviewRound[] }

/** One item of the artifact, addressed by its id. */
export type PlanItem = {
  id: string
  /** The line's text after the id, as written. */
  text: string
  /** The scenario the item sits in, or `Open questions` / `Findings`. */
  section: string
  /** The artifact says the item is gone (B5). */
  removed: boolean
}

export const emptyReview = (): Review => ({ rounds: [] })

export function reviewPath(cwd: string, feature: string): string {
  return join(cwd, PLAN_DIR, `${featureSlug(feature)}.review.md`)
}

/** Workspace-relative path of the review file, the form used in prompts and scopes. */
export function reviewFile(feature: string): string {
  return `${PLAN_DIR}/${featureSlug(feature)}.review.md`
}

/** The artifact's items, in file order, with the scenario or section they sit under. */
export function planItems(body: string): PlanItem[] {
  return specItems(parseSpec(body))
}

export function findItem(body: string, id: string): PlanItem | undefined {
  return planItems(body).find((i) => i.id === id)
}

/** Commenting is offered on a draft only; an approved plan is reopened or superseded (B12). */
export function isCommentable(state: SpecState): boolean {
  return state.exists && state.status === 'draft'
}

export function assertCommentable(state: SpecState): void {
  if (!state.exists) throw new Error('No plan to comment on yet.')
  if (state.status !== 'draft') throw new Error('An approved plan is not commentable: reopen or supersede it.')
}

// --- reading and writing -----------------------------------------------------

const ROUND = /^##\s+Round\s+(\d+)\b(.*)$/
const SUBMITTED = /submitted\s+(\S+)/i
const COMMENT = /^-\s+(C\d+)\s*\(([^)]*)\)\s*:\s*(.*)$/
const STRUCK = /^-\s+struck\s*:\s*(.*)$/i
const CHILD = /^\s+-\s+(.*)$/
const RESOLUTION = /^(?:resolution\s*)?\(?(addressed|disagreed)\)?\s*:\s*(.*)$/i
const ITEM_TEXT = /^item\s*:\s*(.*)$/i
const ACCEPTED = /^accepted\b/i

export function parseReview(text: string): Review {
  const review: Review = { rounds: [] }
  let round: ReviewRound | undefined
  let comment: ReviewComment | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const roundMatch = ROUND.exec(line.trim())
    if (roundMatch) {
      const submitted = SUBMITTED.exec(roundMatch[2] ?? '')
      round = {
        number: Number(roundMatch[1]),
        ...(submitted ? { submittedAt: submitted[1]! } : {}),
        comments: [],
        strikes: [],
      }
      comment = undefined
      review.rounds.push(round)
      continue
    }
    if (!round) continue
    const child = CHILD.exec(line)
    if (child && comment) {
      const body = child[1]!.trim()
      const resolution = RESOLUTION.exec(body)
      if (resolution) {
        comment.resolution = { kind: resolution[1]!.toLowerCase() as ResolutionKind, text: resolution[2]!.trim() }
        continue
      }
      const item = ITEM_TEXT.exec(body)
      if (item) {
        comment.item = item[1]!.trim()
        continue
      }
      if (ACCEPTED.test(body)) comment.closed = true
      continue
    }
    const trimmed = line.trim()
    const struck = STRUCK.exec(trimmed)
    if (struck) {
      round.strikes = struck[1]!
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      comment = undefined
      continue
    }
    const commentMatch = COMMENT.exec(trimmed)
    if (commentMatch) {
      comment = { id: commentMatch[1]!, target: commentMatch[2]!.trim(), text: commentMatch[3]!.trim() }
      round.comments.push(comment)
      continue
    }
    if (trimmed.length > 0) comment = undefined
  }
  return review
}

export function renderReview(review: Review, title: string): string {
  const lines = [
    `# Review of ${title}`,
    '',
    'Comments and strikes are the human\u2019s; resolutions are the agent\u2019s. A submitted comment keeps its id.',
  ]
  for (const round of review.rounds) {
    lines.push('', `## Round ${round.number}${round.submittedAt ? ` — submitted ${round.submittedAt}` : ' — pending'}`)
    for (const comment of round.comments) {
      lines.push(`- ${comment.id} (${comment.target}): ${comment.text}`)
      if (comment.item) lines.push(`  - item: ${comment.item}`)
      if (comment.resolution) lines.push(`  - ${comment.resolution.kind}: ${comment.resolution.text}`)
      if (comment.closed) lines.push('  - accepted')
    }
    if (round.strikes.length > 0) lines.push(`- struck: ${round.strikes.join(', ')}`)
  }
  return lines.join('\n') + '\n'
}

export async function readReview(path: string): Promise<Review> {
  try {
    return parseReview(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyReview()
    throw error
  }
}

export async function writeReview(path: string, review: Review, title: string): Promise<void> {
  await writeFile(path, renderReview(review, title), 'utf8')
}

// --- authoring ---------------------------------------------------------------

/** The round being written, if any; a submitted review has none until the human comments again. */
export function pendingRound(review: Review): ReviewRound | undefined {
  const last = review.rounds.at(-1)
  return last && last.submittedAt === undefined ? last : undefined
}

function openRound(review: Review): ReviewRound {
  const existing = pendingRound(review)
  if (existing) return existing
  const round: ReviewRound = { number: (review.rounds.at(-1)?.number ?? 0) + 1, comments: [], strikes: [] }
  review.rounds.push(round)
  return round
}

function allComments(review: Review): ReviewComment[] {
  return review.rounds.flatMap((r) => r.comments)
}

/** Past the highest id in the file, so a submitted comment's id is never handed out twice. */
function nextCommentId(review: Review): string {
  const highest = allComments(review).reduce((max, c) => Math.max(max, Number(c.id.slice(1)) || 0), 0)
  return `C${highest + 1}`
}

/** Comments are one line in the file; a pasted paragraph keeps its words, not its line breaks. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

export function addComment(review: Review, target: string, text: string, itemText?: string): ReviewComment {
  const body = oneLine(text)
  if (!body) throw new Error('A comment needs text.')
  const comment: ReviewComment = {
    id: nextCommentId(review),
    target,
    text: body,
    ...(itemText ? { item: oneLine(itemText) } : {}),
  }
  openRound(review).comments.push(comment)
  return comment
}

function requirePending(review: Review, id: string): { round: ReviewRound; index: number } {
  const round = pendingRound(review)
  const index = round?.comments.findIndex((c) => c.id === id) ?? -1
  if (!round || index === -1) throw new Error(`Comment ${id} is submitted and cannot be changed.`)
  return { round, index }
}

export function editComment(review: Review, id: string, text: string): void {
  const body = oneLine(text)
  if (!body) throw new Error('A comment needs text.')
  const { round, index } = requirePending(review, id)
  round.comments[index]!.text = body
}

export function removeComment(review: Review, id: string): void {
  const { round, index } = requirePending(review, id)
  round.comments.splice(index, 1)
  prune(review)
}

/** A round with nothing in it is not a round; it appears again on the next comment. */
function prune(review: Review): void {
  const round = pendingRound(review)
  if (round && round.comments.length === 0 && round.strikes.length === 0) review.rounds.pop()
}

export function strikeItem(review: Review, itemId: string): void {
  if (struckItems(review).includes(itemId)) return
  openRound(review).strikes.push(itemId)
}

/** Only an unsubmitted strike can be taken back; a struck item stays removed (B2, B9). */
export function unstrikeItem(review: Review, itemId: string): void {
  const round = pendingRound(review)
  if (!round?.strikes.includes(itemId)) throw new Error(`${itemId} is already struck in a submitted round.`)
  round.strikes = round.strikes.filter((s) => s !== itemId)
  prune(review)
}

/** Every item ever struck, submitted or not. */
export function struckItems(review: Review): string[] {
  return [...new Set(review.rounds.flatMap((r) => r.strikes))]
}

export function commentsFor(review: Review, target: string): ReviewComment[] {
  return allComments(review).filter((c) => c.target === target)
}

/** A review with nothing in it is refused rather than sent; no turn is spent on it (E2). */
export function submitRound(review: Review, at: string = new Date().toISOString()): ReviewRound {
  const round = pendingRound(review)
  if (!round || (round.comments.length === 0 && round.strikes.length === 0)) {
    throw new Error('The review is empty: comment on something or strike an item first.')
  }
  round.submittedAt = at
  return round
}

/** Accepting is an explicit act, including when the agent disagreed (B8). */
export function acceptResolution(review: Review, commentId: string): void {
  const comment = allComments(review).find((c) => c.id === commentId)
  if (!comment) throw new Error(`Unknown comment ${commentId}.`)
  if (!comment.resolution) throw new Error(`Comment ${commentId} has no resolution yet.`)
  comment.closed = true
}

/** Every comment the human has not closed, submitted or still being written. */
export function openComments(review: Review): ReviewComment[] {
  return allComments(review).filter((c) => !c.closed)
}

/** A plan cannot be approved while any comment is open (B10). */
export function assertApprovable(review: Review): void {
  const open = openComments(review)
  if (open.length === 0) return
  throw new Error(`The review is not closed: ${open.map((c) => c.id).join(', ')} still open.`)
}
