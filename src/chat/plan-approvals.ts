import * as vscode from 'vscode'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { SPECS_DIR, docsAfterApprovalPrompt, featureSlug, rulingsHandoffPrompt } from '../agent/phases/blind-plan'
import { assertAllRuled, assertRulingsSent, decisionsPath, pendingDecisions, readDecisions, withRuling } from '../agent/phases/decisions'
import { assertApprovable, assertCommentable, readReview, reviewPath, writeReview, type Review } from '../agent/phases/plan-review'
import { checkDue, isApprovable, planStage } from '../agent/phases/plan-stage'
import { submitReview as submitReviewHandoff, type ReviewCourier } from '../agent/phases/review-handoff'
import { readSpecState, setSpecStatus, type SpecState } from '../agent/phases/spec-file'
import { isVerified } from '../agent/phases/spec-status'
import { readTasks, tasksPath } from '../agent/phases/tasks-file'
import type { SessionMode, SessionManager, SessionRecord } from '../agent/session/session-manager'
import type { ChatPanel } from './panel-registry'
import type { FromWebview } from './protocol'

/** What the chat shows for the docs listing a spec's approval hands the planner. */
const DOCS_REVIEW_LABEL = 'Spec approved: listing the docs it touches'

/** Read when a spec is approved, so a change in settings applies to the next approval. */
const cutCoveredDocs = (): boolean => vscode.workspace.getConfiguration('kiwiAgent').get<boolean>('cutCoveredDocs', false)

export type PlanApprovalsDeps = {
  workspaceRoot: string
  sessions: SessionManager
  newSession: (mode: SessionMode, feature?: string, prompt?: string, into?: ChatPanel, label?: string) => Promise<SessionRecord | undefined>
  sendState: () => Promise<void>
  /** The check against the code an approval sets off when the board is not current with the spec. */
  startCheck: (record: SessionRecord) => Promise<void>
}

/** The rulings and the approval that follow a feature's check, and the review comments they settle. */
export class PlanApprovals {
  /** Features whose rulings were handed to the planner; Approve waits for that turn to end rather than sending them twice. */
  private readonly applying = new Set<string>()
  /** Features whose planner is listing what the docs should now say, right after approval; Implement waits for that turn. */
  private readonly reviewingDocs = new Set<string>()

  constructor(private readonly deps: PlanApprovalsDeps) {}

  isApplying(feature: string): boolean {
    return this.applying.has(feature)
  }

  isReviewingDocs(feature: string): boolean {
    return this.reviewingDocs.has(feature)
  }

  async approveSpec(record: SessionRecord, path: string): Promise<void> {
    const { workspaceRoot } = this.deps
    const feature = record.feature!
    // Agreement is reached, not assumed: every comment has to be closed first.
    const review = await readReview(reviewPath(workspaceRoot, feature))
    assertApprovable(review)
    const decisions = await readDecisions(decisionsPath(workspaceRoot, feature))
    assertRulingsSent(decisions)
    const spec = await readSpecState(path)
    const tasks = await readTasks(tasksPath(workspaceRoot, feature))
    if (!isApprovable(planStage(spec, review, tasks, decisions), spec)) throw new Error('Only a draft with every comment closed can be approved.')
    await setSpecStatus(path, 'approved')
    await this.deps.sendState()
    // Approval hands the spec to the build: the code is checked against it first, and speaks up only where it disagrees.
    if (checkDue(await readSpecState(path), tasks, decisions)) return this.deps.startCheck(record)
    // A board an earlier mapping left, current with the spec: nothing to check, the docs listing and the build follow.
    await this.sendDocsReview(record, feature)
  }

  async sendRulings(record: SessionRecord): Promise<void> {
    if (!(await this.handOverRulings(record))) throw new Error('No decision is pending; there is nothing to send.')
  }

  async ruleDecision(path: string, feature: string, message: Extract<FromWebview, { type: 'rule_decision' }>): Promise<void> {
    // Decisions come after approval, so a spec still being built takes a ruling; a verified one is settled.
    const spec = await readSpecState(path)
    if (!spec.exists || isVerified(spec.status)) throw new Error('The feature is verified: there is nothing left to rule on.')
    const decisions = decisionsPath(this.deps.workspaceRoot, feature)
    await writeFile(decisions, withRuling(await readFile(decisions, 'utf8'), message.decision, message.ruling), 'utf8')
    await this.deps.sendState()
  }

  async submitReview(record: SessionRecord): Promise<void> {
    await submitReviewHandoff({
      courier: this.courier(),
      cwd: this.deps.workspaceRoot,
      feature: record.feature!,
      owner: { sessionId: record.id },
    })
    await this.deps.sendState()
  }

  /**
   * One review edit: read the plan and the review from disk, change the
   * review, write it back. The file is the only state, so a reload loses
   * nothing and the agent sees the same thing the human does.
   */
  async reviewing(feature: string, path: string, change: (review: Review, state: SpecState) => void, draftOnly: boolean): Promise<void> {
    const state = await readSpecState(path)
    if (draftOnly) assertCommentable(state)
    const file = reviewPath(this.deps.workspaceRoot, feature)
    const review = await readReview(file)
    change(review, state)
    await mkdir(dirname(file), { recursive: true })
    await writeReview(file, review, `${SPECS_DIR}/${featureSlug(feature)}.spec.md`)
    await this.deps.sendState()
  }

  /** Nothing stands between the approved spec and the code: the docs listing goes to the planner before the build starts. */
  async sendDocsReview(record: SessionRecord, feature: string): Promise<void> {
    this.reviewingDocs.add(feature)
    await this.sendToPlanner(record, docsAfterApprovalPrompt(feature, cutCoveredDocs()), DOCS_REVIEW_LABEL)
  }

  /** A plan turn ended: the rulings and the docs review it may have been carrying are no longer in flight. */
  clearAfterTurn(feature: string): { applied: boolean; reviewed: boolean } {
    return { applied: this.applying.delete(feature), reviewed: this.reviewingDocs.delete(feature) }
  }

  /**
   * Send rulings: every pending decision is ruled by the user, and the rulings
   * go to the plan session to apply. Approval waits for the revised spec, so
   * the user approves what the planner actually wrote, not what it proposed.
   * False when nothing was pending.
   */
  private async handOverRulings(record: SessionRecord): Promise<boolean> {
    const feature = record.feature!
    const decisions = await readDecisions(decisionsPath(this.deps.workspaceRoot, feature))
    const pending = pendingDecisions(decisions)
    if (pending.length === 0) return false
    assertAllRuled(decisions)
    const rulings = pending.map((d) => ({ title: d.title, ruling: d.ruling ?? '' }))
    this.applying.add(feature)
    await this.sendToPlanner(record, rulingsHandoffPrompt(feature, rulings), `${rulings.length} ruling${rulings.length === 1 ? '' : 's'} sent`)
    return true
  }

  /** A prompt for the plan session that owns the feature, or a fresh plan session when it is gone. */
  private async sendToPlanner(record: SessionRecord, prompt: string, label: string): Promise<void> {
    const courier = this.courier()
    if (courier.isLive(record.id)) await courier.send(record.id, prompt, label)
    else await courier.start(record.feature!, prompt, label)
    await this.deps.sendState()
  }

  /** A submitted review goes to the plan session that wrote the spec, or a fresh plan session when it is gone. */
  private courier(): ReviewCourier {
    const { sessions, newSession } = this.deps
    return {
      isLive: (sessionId) => sessions.isLive(sessionId),
      send: (sessionId, text, label) => sessions.send(sessionId, text, label),
      start: async (feature, prompt, label) => {
        await newSession('plan', feature, prompt, undefined, label)
      },
    }
  }
}
