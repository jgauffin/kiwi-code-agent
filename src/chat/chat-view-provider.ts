import * as vscode from 'vscode'
import type { SessionManager, SessionMode, SessionRecord } from '../agent/session/session-manager'
import type { ModelProfile } from '../agent/session/model-profile'
import type { SessionEvent } from '../agent/session/code-session'
import { nextStatus, type SessionStatus } from '../agent/session/session-status'
import { readSpecState, setSpecStatus, type SpecState } from '../agent/phases/spec-file'
import { PLAN_DIR, featureSlug, findingsHandoffPrompt, specPath } from '../agent/phases/blind-plan'
import { RECONCILE_KICKOFF, openFindings, progressLine } from '../agent/phases/reconcile'
import { IMPLEMENT_KICKOFF, assertImplementable } from '../agent/phases/implement'
import {
  acceptResolution,
  addComment,
  assertApprovable,
  assertCommentable,
  editComment,
  emptyReview,
  findItem,
  isCommentable,
  openComments,
  planItems,
  readReview,
  removeComment,
  reviewPath,
  strikeItem,
  unstrikeItem,
  writeReview,
  type Review,
} from '../agent/phases/plan-review'
import { submitReview, type ReviewCourier } from '../agent/phases/review-handoff'
import { assertAmendable, intentPath, pending, readAmendments, writeBackIntent } from '../agent/phases/intent-writeback'
import { mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { CheckState, FromWebview, PlanState, SessionTab, ToWebview } from './protocol'

/** Per-session verify-on-stop switch; `available` is false when no rules are configured. */
export interface VerifyControl {
  readonly available: boolean
  isEnabled(sessionId: string): boolean
  setEnabled(sessionId: string, enabled: boolean): void
}

/** Where "Allow for project" writes its rules: the workspace's permission allow list. */
export interface PermissionStore {
  allowForProject(rules: string[]): Promise<void>
}

/**
 * Hosts the chat UI, in the sidebar view and in editor panels. Every attached
 * webview shows the same active session; the provider fans events out and
 * tracks each session's status for the tabs and the Sessions view.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  private readonly webviews = new Set<vscode.Webview>()
  private readonly statuses = new Map<string, SessionStatus>()
  /** The check under each plan session, by the plan session's id: the current step, or how the last run ended. */
  private readonly checks = new Map<string, CheckState>()
  private readonly changed = new vscode.EventEmitter<void>()
  /** Fires when the active session, a status or the session list changed. */
  readonly onDidChange = this.changed.event
  private activeSessionId: string | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionManager,
    private readonly profileFor: (mode: SessionMode) => ModelProfile,
    private readonly verify: VerifyControl,
    private readonly permissions: PermissionStore,
    private readonly workspaceRoot: string,
    private readonly memento: vscode.Memento,
  ) {
    // The open session survives a window reload; its engine resumes on the next prompt.
    const remembered = memento.get<string>('activeSessionId')
    if (remembered && sessions.get(remembered)) this.activeSessionId = remembered
  }

  get activeId(): string | undefined {
    return this.activeSessionId
  }

  private setActive(id: string | undefined): void {
    this.activeSessionId = id
    void this.memento.update('activeSessionId', id)
  }

  /** A session's status, or its running check's: the check has no tab, so its state shows on the plan's. */
  statusOf(sessionId: string): SessionStatus {
    const child = this.sessions.liveChildOf(sessionId)
    return this.statuses.get(child?.id ?? sessionId) ?? 'idle'
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.attach(view.webview)
    view.onDidDispose(() => this.webviews.delete(view.webview))
  }

  openInEditor(): void {
    const panel = vscode.window.createWebviewPanel('kiwiAgent.chatPanel', 'KiwiAgent', vscode.ViewColumn.Beside, {
      retainContextWhenHidden: true,
    })
    this.attach(panel.webview)
    panel.onDidDispose(() => this.webviews.delete(panel.webview))
  }

  async newSession(mode: SessionMode, feature?: string, prompt?: string): Promise<void> {
    if (mode !== 'chat' && !feature) throw new Error(`A ${mode} session needs a feature name`)
    const record = await this.sessions.create(this.profileFor(mode), mode, feature)
    this.setActive(record.id)
    await this.sendState()
    this.broadcast({ type: 'transcript', sessionId: record.id, events: [] })
    this.changed.fire()
    if (prompt) await this.sessions.send(record.id, prompt)
  }

  showNewSession(): void {
    this.broadcast({ type: 'show_new_session' })
  }

  async open(sessionId: string): Promise<void> {
    if (!this.sessions.get(sessionId)) return
    this.setActive(sessionId)
    await this.sendState()
    await this.sendTranscript(sessionId)
    this.changed.fire()
  }

  async close(sessionId: string): Promise<void> {
    await this.sessions.close(sessionId)
    if (this.activeSessionId === sessionId) this.setActive(undefined)
    void this.sendState()
    this.changed.fire()
  }

  async remove(sessionId: string): Promise<void> {
    await this.sessions.remove(sessionId)
    this.statuses.delete(sessionId)
    if (this.activeSessionId === sessionId) this.setActive(undefined)
    void this.sendState()
    this.changed.fire()
  }

  /** Called by the session manager for every event of every session. */
  onSessionEvent(sessionId: string, event: SessionEvent): void {
    const record = this.sessions.get(sessionId)
    if (record) {
      const before = this.statuses.get(sessionId) ?? 'idle'
      const after = nextStatus(before, record.mode, event)
      if (after !== before) {
        this.statuses.set(sessionId, after)
        void this.sendState()
        this.changed.fire()
      }
    }
    if (record?.parentId) {
      this.followCheck(record, event)
      return
    }
    if (sessionId === this.activeSessionId) this.broadcast({ type: 'event', sessionId, event })
    if (event.type === 'session_started' || event.type === 'ended') {
      void this.sendState()
      this.changed.fire()
    }
    // The session just wrote the spec (a revision, findings, a task marker); the plan bar and view must follow.
    if (event.type === 'tool_result' && record?.feature && sessionId === this.activeSessionId) void this.sendState()
  }

  /** A check has no transcript in the UI: its events become the one line the plan bar shows. */
  private followCheck(child: SessionRecord, event: SessionEvent): void {
    const parentId = child.parentId!
    const check = this.checks.get(parentId)
    if (!check?.live) return
    if (event.type === 'turn_done') {
      void this.finishCheck(child, event.isError ? (event.errors.length > 0 ? event.errors : ['the run ended with an error']) : [])
      return
    }
    if (event.type === 'error' && event.fatal) {
      void this.finishCheck(child, [event.message])
      return
    }
    const line = progressLine(event)
    if (line === undefined || line === check.text) return
    this.checks.set(parentId, { live: true, text: line })
    void this.sendState()
  }

  /**
   * The run is over: stop its engine, count what it left in the spec and, when
   * there are findings without a proposal, hand them to the planner to propose on.
   */
  private async finishCheck(child: SessionRecord, errors: string[]): Promise<void> {
    const parentId = child.parentId!
    // Marked over before the first await, so a late event from the dying engine cannot finish it twice.
    this.checks.set(parentId, { live: false, text: this.checks.get(parentId)?.text ?? '' })
    await this.sessions.close(child.id)
    let text: string
    if (errors.length > 0) {
      text = `Check failed: ${errors.join('; ')}`
    } else {
      const state = await readSpecState(specPath(this.workspaceRoot, child.feature!))
      const open = state.exists ? openFindings(state.body) : []
      text = open.length === 0 ? 'Checked: the code is clear' : `Checked: ${open.length} finding${open.length === 1 ? '' : 's'}`
      const unproposed = open.filter((f) => f.proposal.length === 0).map((f) => f.id)
      if (unproposed.length > 0 && this.sessions.get(parentId)) {
        await this.sessions.send(parentId, findingsHandoffPrompt(child.feature!, unproposed))
      }
    }
    this.checks.set(parentId, { live: false, text })
    await this.sendState()
    this.changed.fire()
  }

  private attach(webview: vscode.Webview): void {
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')] }
    webview.html = this.html(webview)
    webview.onDidReceiveMessage((message: FromWebview) => {
      this.handle(message).catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error)
        void vscode.window.showErrorMessage(`KiwiAgent: ${text}`)
      })
    })
    this.webviews.add(webview)
  }

  private async handle(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.sendState()
        if (this.activeSessionId) await this.sendTranscript(this.activeSessionId)
        return
      case 'send':
        if (!this.activeSessionId) await this.newSession('chat')
        await this.sessions.send(this.activeSessionId!, message.text)
        return
      case 'permission': {
        if (!this.activeSessionId) return
        // The rule is written before the call runs, so a second identical call in the same turn already passes.
        if (message.decision.kind === 'allow_project') await this.permissions.allowForProject(message.decision.rules)
        const decision = message.decision.kind === 'allow_project' ? { kind: 'allow' as const } : message.decision
        this.sessions.respondToPermission(this.activeSessionId, message.requestId, decision)
        return
      }
      case 'interrupt':
        if (this.activeSessionId) await this.sessions.interrupt(this.activeSessionId)
        return
      case 'set_verify':
        if (this.activeSessionId) this.verify.setEnabled(this.activeSessionId, message.enabled)
        void this.sendState()
        return
      case 'switch_session':
        await this.open(message.sessionId)
        return
      case 'close_session':
        await this.close(message.sessionId)
        return
      case 'new_session':
        await this.newSession(message.mode, message.feature, message.prompt)
        return
      case 'approve_spec': {
        const path = this.activeSpecPath()
        const feature = this.activeRecord()?.feature
        if (!path || !feature) return
        // Agreement is reached, not assumed: every comment has to be closed first.
        assertApprovable(await readReview(reviewPath(this.workspaceRoot, feature)))
        await setSpecStatus(path, 'approved')
        await this.sendState()
        return
      }
      case 'add_comment':
        await this.reviewing(async (review, state) => {
          const item = message.target === 'plan' ? undefined : findItem(state.exists ? state.body : '', message.target)
          addComment(review, message.target, message.text, item ? `${item.id}: ${item.text}` : undefined)
        })
        return
      case 'edit_comment':
        await this.reviewing((review) => editComment(review, message.commentId, message.text))
        return
      case 'remove_comment':
        await this.reviewing((review) => removeComment(review, message.commentId))
        return
      case 'strike_item':
        await this.reviewing((review) => strikeItem(review, message.itemId))
        return
      case 'unstrike_item':
        await this.reviewing((review) => unstrikeItem(review, message.itemId))
        return
      case 'accept_resolution':
        // Accepting a resolution, including a disagreement, is the human's own act; it needs no draft.
        await this.reviewing((review) => acceptResolution(review, message.commentId), false)
        return
      case 'submit_review': {
        const record = this.activeRecord()
        if (!record?.feature) return
        await submitReview({
          courier: this.courier(),
          cwd: this.workspaceRoot,
          feature: record.feature,
          owner: { sessionId: record.id },
        })
        await this.sendState()
        return
      }
      case 'check_spec': {
        const record = this.activeRecord()
        if (record?.mode !== 'plan' || !record.feature || this.sessions.liveChildOf(record.id)) return
        const child = await this.sessions.create(this.profileFor('reconcile'), 'reconcile', record.feature, record.id)
        this.checks.set(record.id, { live: true, text: 'Checking the spec against the code…' })
        await this.sendState()
        await this.sessions.send(child.id, RECONCILE_KICKOFF)
        return
      }
      case 'stop_check': {
        const record = this.activeRecord()
        const child = record ? this.sessions.liveChildOf(record.id) : undefined
        if (!record || !child) return
        this.checks.set(record.id, { live: false, text: 'Check stopped' })
        await this.sessions.close(child.id)
        await this.sendState()
        this.changed.fire()
        return
      }
      case 'implement_spec': {
        const record = this.activeRecord()
        const path = this.activeSpecPath()
        if (record?.mode !== 'plan' || !record.feature || !path) return
        assertImplementable(await readSpecState(path))
        await this.newSession('implement', record.feature, IMPLEMENT_KICKOFF)
        return
      }
      case 'update_intent': {
        const feature = this.activeRecord()?.feature
        const path = this.activeSpecPath()
        if (!feature || !path) return
        assertAmendable(await readSpecState(path))
        const result = await writeBackIntent({ cwd: this.workspaceRoot, feature })
        await this.sendState()
        await this.reportWriteBack(result.docs, result.failed)
        return
      }
    }
  }

  /** What landed in `docs/` and what did not: the user is applying these, so nothing happens silently. */
  private async reportWriteBack(
    docs: string[],
    failed: { amendment: { id: string }; reason: string }[],
  ): Promise<void> {
    if (failed.length > 0) {
      const detail = failed.map((f) => `${f.amendment.id}: ${f.reason}`).join('; ')
      void vscode.window.showWarningMessage(
        `KiwiAgent: ${docs.length > 0 ? `updated ${docs.join(', ')}. ` : ''}${failed.length} amendment${failed.length === 1 ? '' : 's'} could not be applied — ${detail}`,
      )
      return
    }
    if (docs.length === 0) {
      void vscode.window.showInformationMessage('KiwiAgent: no intent amendments are waiting to be applied.')
      return
    }
    const open = 'Open'
    const choice = await vscode.window.showInformationMessage(`KiwiAgent: intent updated in ${docs.join(', ')}.`, open)
    if (choice !== open) return
    const file = vscode.Uri.file(join(this.workspaceRoot, docs[0]!))
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file))
  }

  private activeRecord(): SessionRecord | undefined {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined
  }

  private activeSpecPath(): string | undefined {
    const feature = this.activeRecord()?.feature
    return feature ? specPath(this.workspaceRoot, feature) : undefined
  }

  /**
   * One review edit: read the plan and the review from disk, change the
   * review, write it back. The file is the only state, so a reload loses
   * nothing and the agent sees the same thing the human does.
   */
  private async reviewing(change: (review: Review, state: SpecState) => void, draftOnly = true): Promise<void> {
    const feature = this.activeRecord()?.feature
    const path = this.activeSpecPath()
    if (!feature || !path) return
    const state = await readSpecState(path)
    if (draftOnly) assertCommentable(state)
    const file = reviewPath(this.workspaceRoot, feature)
    const review = await readReview(file)
    change(review, state)
    await mkdir(dirname(file), { recursive: true })
    await writeReview(file, review, `${PLAN_DIR}/${featureSlug(feature)}.spec.md`)
    await this.sendState()
  }

  /** A submitted review goes to the plan session that wrote the spec, or a fresh plan session when it is gone. */
  private courier(): ReviewCourier {
    return {
      isLive: (sessionId) => this.sessions.isLive(sessionId),
      send: (sessionId, text) => this.sessions.send(sessionId, text),
      start: (feature, prompt) => this.newSession('plan', feature, prompt),
    }
  }

  private async planState(): Promise<PlanState | undefined> {
    const path = this.activeSpecPath()
    const record = this.activeRecord()
    const feature = record?.feature
    if (!path || !record || !feature) return undefined
    const state = await readSpecState(path)
    const fromPlan = record.mode === 'plan' && state.exists
    const check = this.checks.get(record.id)
    const review = await readReview(reviewPath(this.workspaceRoot, feature)).catch(() => emptyReview())
    const amendments = await readAmendments(intentPath(this.workspaceRoot, feature)).catch(() => [])
    const waiting = pending(amendments).length
    return {
      specPath: relative(this.workspaceRoot, path).split('\\').join('/'),
      status: state.exists ? state.status : 'missing',
      ...(state.exists ? { body: state.body } : {}),
      checkable: fromPlan && state.status === 'draft' && check?.live !== true,
      ...(check ? { check } : {}),
      implementable: fromPlan && state.status === 'approved',
      items: state.exists ? planItems(state.body) : [],
      review,
      commentable: isCommentable(state),
      approvable: openComments(review).length === 0,
      ...(amendments.length > 0
        ? {
            intent: {
              path: relative(this.workspaceRoot, intentPath(this.workspaceRoot, feature)).split('\\').join('/'),
              pending: waiting,
              applied: amendments.length - waiting,
              // Offered after approval, and still offered once the feature is built: intent owes the same debt either way.
              applicable: state.exists && state.status === 'approved' && waiting > 0,
            },
          }
        : {}),
    }
  }

  /** Tabs: live sessions plus the active one, in creation order (list is newest first). A run under a session has no tab. */
  private tabs(): SessionTab[] {
    return this.sessions
      .list()
      .filter((r) => !r.parentId && (this.sessions.isLive(r.id) || r.id === this.activeSessionId))
      .reverse()
      .map((r) => this.tab(r))
  }

  private tab(record: SessionRecord): SessionTab {
    return {
      id: record.id,
      title: record.title,
      mode: record.mode,
      profileName: record.profile.name,
      status: this.statusOf(record.id),
      active: record.id === this.activeSessionId,
    }
  }

  private async sendState(): Promise<void> {
    const active = this.activeSessionId
    const plan = await this.planState().catch((error: unknown) => {
      void vscode.window.showErrorMessage(`KiwiAgent: cannot read spec: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    })
    this.broadcast({
      type: 'state',
      tabs: this.tabs(),
      ...(active && this.verify.available ? { verify: this.verify.isEnabled(active) } : {}),
      ...(plan ? { plan } : {}),
    })
  }

  private async sendTranscript(sessionId: string): Promise<void> {
    const events = await this.sessions.transcript(sessionId)
    this.broadcast({ type: 'transcript', sessionId, events })
  }

  private broadcast(message: ToWebview): void {
    for (const webview of this.webviews) void webview.postMessage(message)
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'))
    const nonce = crypto.randomUUID().replace(/-/g, '')
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data:; font-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>KiwiAgent</title>
</head>
<body>
<chat-app></chat-app>
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`
  }
}
