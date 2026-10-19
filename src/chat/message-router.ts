import type { SessionManager, SessionMode, SessionRecord } from '../agent/session/session-manager'
import type { ModelOffer, ModelProfile, Step } from '../agent/session/model-profile'
import { addComment, editComment, removeComment, resolveComment, strikeItem, unstrikeItem } from '../agent/phases/plan-review'
import { withLinkedFiles } from './linked-files'
import { handleRunMessage } from './run-messages'
import { copyText, linkOpenFile, openEditDiff, openFile, startFromCard, suggestName } from './tab-messages'
import type { FromWebview } from './protocol'
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
import type { WindowLinkControl } from '../cross-window/cross-window'

/** One kind of message from the tab. */
export type WebviewMessage<T extends FromWebview['type']> = Extract<FromWebview, { type: T }>

export type MessageRouterDeps = {
  workspaceRoot: string
  sessions: SessionManager
  profileFor: (step: Step, attempt?: number) => ModelProfile
  registeredModels: () => ModelOffer[]
  profileDefaults: ProfileDefaultsStore
  allowWrites: SessionSwitch
  windowLinks: WindowLinkControl
  permissions: PermissionStore
  agentsMd: AgentsMdOffers
  tracker: SessionTracker
  tabView: TabView
  planActions: PlanActions
  cleanup: FeatureCleanup
  build: FeatureBuild
  newSession: (mode: SessionMode, feature?: string, prompt?: string, into?: ChatPanel, label?: string) => Promise<SessionRecord | undefined>
  open: (sessionId: string, into?: ChatPanel) => Promise<void>
  /** One prompt on the model new plan sessions run on, answered as text: for the small asks that are not a session. */
  ask: (prompt: string) => Promise<string>
  resumePlan: (feature: string, into?: ChatPanel, note?: string) => Promise<void>
  /** Opens the plan in a tab of its own while `stayOn` stays the tab in view. */
  resumePlanAside: (feature: string, stayOn: ChatPanel) => Promise<void>
  sendState: () => Promise<void>
  sendTranscript: (sessionId: string) => Promise<void>
}

/** Every message a tab sends, routed to whichever collaborator answers it. */
export class MessageRouter {
  constructor(private readonly deps: MessageRouterDeps) {}

  async handle(message: FromWebview, entry: ChatPanel): Promise<void> {
    const shown = this.shownBy(entry)
    if (await this.handleTabMessage(message, shown, entry)) return
    if (await handleRunMessage(this.deps, message, shown)) return
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
        linkOpenFile(this.deps, entry)
        return true
      case 'suggest_feature_name':
        await suggestName(this.deps, message, entry)
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
        await startFromCard(this.deps, message, entry)
        return true
      case 'resume_plan':
        if (message.ownTab) await this.deps.resumePlanAside(message.feature, entry)
        else await this.deps.resumePlan(message.feature, entry, message.note)
        return true
      case 'update_spec':
        await this.deps.planActions.startUpdate(message.feature, message.description, entry)
        return true
      case 'copy_text':
        await copyText(message)
        return true
      case 'open_file':
        await openFile(this.deps, message)
        return true
      case 'open_edit_diff':
        await openEditDiff(this.deps, message)
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
      case 'set_start_build':
        await planActions.setStartsOnApproval(message.on)
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
}
