import * as vscode from 'vscode'
import { isAbsolute, join } from 'node:path'
import type { SessionManager, SessionMode, SessionRecord } from '../agent/session/session-manager'
import { atEffort, switchedTo, type ModelOffer, type ModelProfile, type Step } from '../agent/session/model-profile'
import { codePlanBuildKickoff } from '../agent/phases/code-plan'
import { addComment, editComment, removeComment, resolveComment, strikeItem, unstrikeItem } from '../agent/phases/plan-review'
import { editDiffTitle, editLine, isRunSnapshot, runsRoot } from '../agent/edits/open-edit'
import { docMigrationKickoff } from '../agent/phases/doc-migration'
import { fileDecisionsKickoff } from '../agent/phases/file-decisions'
import { linkedFilePath, withLinkedFiles } from './linked-files'
import type { FromWebview, ToWebview } from './protocol'
import type { AgentsMdOffers } from './agents-md-offers'
import { agentsMdTidyKickoff } from '../agent/instructions/agents-md-tidy'
import type { FeatureBuild } from './feature-build'
import type { FeatureCleanup } from './feature-cleanup'
import type { SessionSwitch } from './feature-runs'
import type { ChatPanel } from './panel-registry'
import type { PlanActions } from './plan-actions'
import type { SessionTracker } from './session-tracker'
import type { TabView } from './tab-view'
import type { PermissionStore, ProfileDefaultsStore } from './chat-view-provider'

/** One kind of message from the tab. */
type WebviewMessage<T extends FromWebview['type']> = Extract<FromWebview, { type: T }>

export type MessageRouterDeps = {
  workspaceRoot: string
  sessions: SessionManager
  profileFor: (step: Step, attempt?: number) => ModelProfile
  registeredModels: () => ModelOffer[]
  profileDefaults: ProfileDefaultsStore
  allowWrites: SessionSwitch
  permissions: PermissionStore
  agentsMd: AgentsMdOffers
  tracker: SessionTracker
  tabView: TabView
  planActions: PlanActions
  cleanup: FeatureCleanup
  build: FeatureBuild
  newSession: (mode: SessionMode, feature?: string, prompt?: string, into?: ChatPanel, label?: string) => Promise<SessionRecord | undefined>
  open: (sessionId: string, into?: ChatPanel) => Promise<void>
  resumePlan: (feature: string, into?: ChatPanel) => Promise<void>
  sendState: () => Promise<void>
  sendTranscript: (sessionId: string) => Promise<void>
}

/** Every message a tab sends, routed to whichever collaborator answers it. */
export class MessageRouter {
  constructor(private readonly deps: MessageRouterDeps) {}

  async handle(message: FromWebview, entry: ChatPanel): Promise<void> {
    const shown = this.shownBy(entry)
    if (await this.handleTabMessage(message, shown, entry)) return
    if (await this.handleRunMessage(message, shown)) return
    if (await this.handlePlanMessage(message, shown)) return
    await this.handleBuildMessage(message, shown, entry)
  }

  /** The session the tab shows, or nothing while it shows the new-session screen. */
  private shownBy(entry: ChatPanel): SessionRecord | undefined {
    return entry.tabId ? this.deps.sessions.get(entry.tabId) : undefined
  }

  /** Messages about the tab itself: its own screen, a session started or switched to, a file opened from it. */
  private async handleTabMessage(message: FromWebview, shown: SessionRecord | undefined, entry: ChatPanel): Promise<boolean> {
    const { sendState, sendTranscript, agentsMd } = this.deps
    switch (message.type) {
      case 'ready':
        await sendState()
        if (entry.tabId) await sendTranscript(entry.tabId)
        return true
      case 'send':
        await this.sendFromTab(message, shown, entry)
        return true
      case 'link_open_file':
        this.linkOpenFile(entry)
        return true
      case 'agents_md_answer': {
        const tidy = await agentsMd.answer(message.scope, message.answer)
        // A tab on the new-session screen takes the tidy chat; one showing a session keeps it.
        if (tidy) await this.deps.newSession('chat', undefined, agentsMdTidyKickoff(tidy.scope, tidy.agentsPath, tidy.bundles), entry.tabId ? undefined : entry, `Tidying ${tidy.agentsPath}`)
        return true
      }
      case 'switch_session':
        await this.deps.open(message.sessionId, entry)
        return true
      case 'new_session':
        await this.startFromCard(message, entry)
        return true
      case 'resume_plan':
        await this.deps.resumePlan(message.feature, entry)
        return true
      case 'open_file':
        await this.openFile(message)
        return true
      case 'open_edit_diff':
        await this.openEditDiff(message)
        return true
      default:
        return false
    }
  }

  /** Messages about one run's own controls: permissions, questions, switches and the model it talks on. */
  private async handleRunMessage(message: FromWebview, shown: SessionRecord | undefined): Promise<boolean> {
    const { sessions, tabView, tracker, allowWrites, registeredModels, profileFor, profileDefaults, sendState } = this.deps
    switch (message.type) {
      case 'permission':
        await this.answerPermission(message)
        return true
      case 'question':
        if (sessions.get(message.sessionId)) await sessions.respondToQuestion(message.sessionId, message.requestId, message.outcome)
        return true
      case 'interrupt':
        if (shown) await sessions.interrupt(tabView.targetOf(shown, message.sessionId, false).id)
        return true
      case 'compact':
        if (shown) sessions.compact(tabView.targetOf(shown, message.sessionId, false).id)
        return true
      case 'set_allow_writes':
        if (shown) allowWrites.setEnabled(tabView.targetOf(shown, message.sessionId, false).id, message.enabled)
        void sendState()
        return true
      case 'set_session_model': {
        const offer = registeredModels().find((m) => m.profile.name === message.name)
        if (shown && offer) await tracker.switchProfile(shown.id, switchedTo(tracker.switchingFrom(shown), offer))
        void sendState()
        return true
      }
      case 'set_session_effort':
        if (shown) await tracker.switchProfile(shown.id, atEffort(tracker.switchingFrom(shown), message.effort))
        void sendState()
        return true
      case 'approve_plan':
        // The approval is the go-ahead, so the build starts at once rather than waiting on another prompt.
        if (shown?.mode === 'code-plan' && shown.access !== 'full') {
          await sessions.grantFullAccess(shown.id, profileFor('code-build'))
          await sessions.send(shown.id, codePlanBuildKickoff(), 'Plan approved: building it')
          await sendState()
        }
        return true
      case 'reconnect_mcp':
        if (shown) await sessions.reconnectMcp(tabView.targetOf(shown, message.sessionId, false).id, message.server)
        return true
      case 'set_default_profile':
        await profileDefaults.set(message.name)
        await sendState()
        return true
      default:
        return false
    }
  }

  /** Messages about the plan itself: the spec, the review and the decisions it carries. */
  private async handlePlanMessage(message: FromWebview, shown: SessionRecord | undefined): Promise<boolean> {
    const { planActions } = this.deps
    switch (message.type) {
      case 'approve_spec':
        await planActions.approveSpec(shown)
        return true
      case 'send_rulings':
        await planActions.sendRulings(shown)
        return true
      case 'rule_decision':
        await planActions.ruleDecision(shown, message)
        return true
      case 'add_comment':
        await planActions.reviewing(shown, (review) => void addComment(review, message.target, message.text))
        return true
      case 'edit_comment':
        await planActions.reviewing(shown, (review) => editComment(review, message.comment, message.text))
        return true
      case 'remove_comment':
        await planActions.reviewing(shown, (review) => removeComment(review, message.comment))
        return true
      case 'strike_item':
        await planActions.reviewing(shown, (review) => strikeItem(review, message.item))
        return true
      case 'unstrike_item':
        await planActions.reviewing(shown, (review) => unstrikeItem(review, message.item))
        return true
      case 'resolve_comment':
        // Resolving a comment, including a disagreement, is the human's own act; it needs no draft.
        await planActions.reviewing(shown, (review) => resolveComment(review, message.comment), false)
        return true
      case 'submit_review':
        await planActions.submitReview(shown)
        return true
      case 'check_spec': {
        // The way back in when a check failed or was stopped: approval started the first one.
        const record = planActions.planRecordOf(shown)
        if (record) await planActions.startCheck(record)
        return true
      }
      case 'stop_check':
        await planActions.stopCheck(shown)
        return true
      default:
        return false
    }
  }

  /** Messages about the build: the cleanup, the implementer and the test run. */
  private async handleBuildMessage(message: FromWebview, shown: SessionRecord | undefined, entry: ChatPanel): Promise<boolean> {
    const { planActions, cleanup, build } = this.deps
    switch (message.type) {
      case 'stop_cleanup':
        if (shown?.feature) await cleanup.stop(shown.feature)
        return true
      case 'cleanup_decision':
        if (shown?.feature) await cleanup.decide(shown.feature, message.decision, message.paths)
        return true
      case 'sweep_sizes':
        if (shown?.feature) await cleanup.sweep(shown.feature)
        return true
      case 'repair_spec':
        if (shown?.feature) planActions.reportMigration(await planActions.repairPlan(shown.feature), true)
        return true
      case 'start_change':
        await planActions.startChange(shown, entry)
        return true
      case 'implement_spec':
        await planActions.implementSpec(shown)
        return true
      case 'verify_spec':
        if (shown?.feature) await build.verify(shown.feature, true)
        return true
      case 'hand_back_task':
        await planActions.implementSpec(shown, message.task)
        return true
      case 'accept_task':
        if (shown?.feature) await build.acceptTask(shown.feature, message.task)
        return true
      default:
        return false
    }
  }

  private async sendFromTab(message: WebviewMessage<'send'>, shown: SessionRecord | undefined, entry: ChatPanel): Promise<void> {
    const { sessions, tabView, tracker, cleanup } = this.deps
    const text = withLinkedFiles(message.text, message.files ?? [])
    if (!shown) {
      await this.deps.newSession('chat', undefined, text, entry)
      return
    }
    // The phase the person picked names the run they talk to; nothing here guesses another.
    if (!message.sessionId) throw new Error('The message names no conversation to go to.')
    const run = tabView.targetOf(shown, message.sessionId, true)
    if (run.mode === 'cleanup') await cleanup.reengage(run)
    await tracker.followProfile(run)
    // A model switch picked while a turn of this chat session was in flight takes effect now (B10).
    await tracker.applyPendingProfileSwitch(run)
    await sessions.send(run.id, text)
  }

  private linkOpenFile(entry: ChatPanel): void {
    // With focus in the view there may be no active text editor, so the file on screen is the one meant.
    const editor = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0]
    if (!editor) {
      void vscode.window.showWarningMessage('Kiwipow Agent: no file is open in the editor to link.')
      return
    }
    void entry.panel.webview.postMessage({
      type: 'linked_file',
      path: linkedFilePath(this.deps.workspaceRoot, editor.document.uri.fsPath),
    } satisfies ToWebview)
  }

  private async answerPermission(message: WebviewMessage<'permission'>): Promise<void> {
    const { sessions, permissions } = this.deps
    if (!sessions.get(message.sessionId)) return
    // The rules are in place before the call runs, so a second call they cover in the same turn already passes.
    const { remember, ...decision } = message.decision
    if (remember?.project.length) await permissions.allowForProject(remember.project)
    if (remember?.session.length) await permissions.allowForSession(message.sessionId, remember.session)
    await sessions.respondToPermission(message.sessionId, message.requestId, decision)
  }

  private async startFromCard(message: WebviewMessage<'new_session'>, entry: ChatPanel): Promise<void> {
    const { sessions, newSession, open } = this.deps
    // One filing at a time: a second would propose the same entries again.
    const filing = message.mode === 'file-decisions' ? sessions.list().find((r) => r.mode === 'file-decisions' && sessions.isLive(r.id)) : undefined
    if (filing) return open(filing.id, entry)
    const prompt = withLinkedFiles(message.prompt ?? '', message.files ?? [])
    // The filing and the docs cleanup have nothing to fill in, so their sessions start on the job rather than waiting for a prompt.
    const kickoff =
      message.mode === 'file-decisions'
        ? { text: fileDecisionsKickoff(), label: 'Filing the decisions' }
        : message.mode === 'doc-migration'
          ? { text: docMigrationKickoff(), label: 'Cleaning up the docs' }
          : undefined
    if (prompt !== '' || !kickoff) await newSession(message.mode, message.feature, prompt, entry)
    else await newSession(message.mode, message.feature, kickoff.text, entry, kickoff.label)
  }

  private async openFile(message: WebviewMessage<'open_file'>): Promise<void> {
    // An edit names its file absolutely; a task names it relative to the workspace.
    const path = isAbsolute(message.path) ? message.path : join(this.deps.workspaceRoot, message.path)
    const file = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
    const at = new vscode.Position(editLine(message.line, file.lineCount), 0)
    await vscode.window.showTextDocument(file, { selection: new vscode.Range(at, at) })
  }

  private async openEditDiff(message: WebviewMessage<'open_edit_diff'>): Promise<void> {
    // The path comes back from the webview, so only a snapshot this extension wrote is opened.
    if (!isRunSnapshot(runsRoot(this.deps.workspaceRoot), message.snapshot)) return
    await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(message.snapshot), vscode.Uri.file(message.path), editDiffTitle(message.label))
  }
}
