import type { RunControls } from '../protocol'
import { LinkedFilesRow } from './linked-files-row'
import { post } from './vscode-api'
import type { PlanFocus, ViewTab } from './events'
import type { Step } from './plan-step'
import {
  AgentsMdAnsweredEvent,
  AllowWritesToggledEvent,
  ChangeRequestedEvent,
  ChatTargetChangedEvent,
  CleanupDecidedEvent,
  CleanupStoppedEvent,
  CompactRequestedEvent,
  DefaultProfileChangedEvent,
  ImplementRequestedEvent,
  InterruptRequestedEvent,
  LinkOpenFileRequestedEvent,
  McpReconnectRequestedEvent,
  NewSessionRequestedEvent,
  PermissionDecidedEvent,
  PlanApprovedEvent,
  PlanFocusRequestedEvent,
  PlanResumeRequestedEvent,
  PlanStepSelectedEvent,
  PlanViewSelectedEvent,
  PromptSubmittedEvent,
  QuestionAnsweredEvent,
  ReviewActionEvent,
  ReviewSubmittedEvent,
  RulingsSentEvent,
  SessionEffortChangedEvent,
  SessionModelChangedEvent,
  SessionSelectedEvent,
  SpecApprovedEvent,
  SpecCheckRequestedEvent,
  SpecCheckStoppedEvent,
  SpecRepairRequestedEvent,
  SweepRequestedEvent,
  VerifyRequestedEvent,
} from './events'

/** What `wireChatEvents` calls back into `ChatApp` for, rather than reaching into its private state itself. */
export interface ChatAppActions {
  stepPicked(step: Step): void
  focusPlan(tab: ViewTab, where?: PlanFocus): void
  show(view: ViewTab): void
  showTarget(): void
  toTarget(act: (sessionId: string) => void): void
  target(): RunControls | undefined
  setLinkTarget(target: LinkedFilesRow | undefined): void
}

/** The run a card sits in: a tab holds several conversations, and only the one that asked can be answered. */
function runOf(target: EventTarget | null): string | undefined {
  return target instanceof Element ? (target.closest<HTMLElement>('[data-session]')?.dataset.session ?? undefined) : undefined
}

/** Turns the chat UI's own events into messages for the host; the few that need the app's state go through `actions`. */
export function wireChatEvents(el: HTMLElement, actions: ChatAppActions): void {
  el.addEventListener(SpecApprovedEvent.type, () => post({ type: 'approve_spec' }))
  el.addEventListener(RulingsSentEvent.type, () => post({ type: 'send_rulings' }))
  el.addEventListener(ReviewSubmittedEvent.type, () => post({ type: 'submit_review' }))
  el.addEventListener(ReviewActionEvent.type, (e) => post(e.action))
  el.addEventListener(PlanStepSelectedEvent.type, (e) => actions.stepPicked(e.step))
  el.addEventListener(PlanFocusRequestedEvent.type, (e) => actions.focusPlan(e.tab, e.where))
  el.addEventListener(SpecCheckRequestedEvent.type, () => post({ type: 'check_spec' }))
  el.addEventListener(SpecCheckStoppedEvent.type, () => post({ type: 'stop_check' }))
  el.addEventListener(CleanupStoppedEvent.type, () => post({ type: 'stop_cleanup' }))
  el.addEventListener(CleanupDecidedEvent.type, (e) => post({ type: 'cleanup_decision', decision: e.decision, ...(e.paths ? { paths: e.paths } : {}) }))
  el.addEventListener(SweepRequestedEvent.type, () => post({ type: 'sweep_sizes' }))
  el.addEventListener(SpecRepairRequestedEvent.type, () => post({ type: 'repair_spec' }))
  el.addEventListener(ChangeRequestedEvent.type, () => post({ type: 'start_change' }))
  el.addEventListener(ImplementRequestedEvent.type, () => post({ type: 'implement_spec' }))
  el.addEventListener(VerifyRequestedEvent.type, () => post({ type: 'verify_spec' }))
  el.addEventListener(PlanViewSelectedEvent.type, (e) => actions.show(e.view))
  el.addEventListener(ChatTargetChangedEvent.type, () => actions.showTarget())

  el.addEventListener(PromptSubmittedEvent.type, (e) => {
    // A Resume button speaks for the run it sits under; the composer for the run the phase's chat talks to.
    const sessionId = runOf(e.target) ?? actions.target()?.sessionId
    post({ type: 'send', text: e.text, ...(e.files.length > 0 ? { files: e.files } : {}), ...(sessionId ? { sessionId } : {}) })
  })
  el.addEventListener(LinkOpenFileRequestedEvent.type, (e) => {
    actions.setLinkTarget(e.target instanceof LinkedFilesRow ? e.target : undefined)
    post({ type: 'link_open_file' })
  })
  el.addEventListener(InterruptRequestedEvent.type, () => actions.toTarget((sessionId) => post({ type: 'interrupt', sessionId })))
  el.addEventListener(CompactRequestedEvent.type, () => actions.toTarget((sessionId) => post({ type: 'compact', sessionId })))
  el.addEventListener(PermissionDecidedEvent.type, (e) => {
    const sessionId = runOf(e.target)
    if (sessionId) post({ type: 'permission', sessionId, requestId: e.requestId, decision: e.decision })
  })
  el.addEventListener(QuestionAnsweredEvent.type, (e) => {
    const sessionId = runOf(e.target)
    if (sessionId) post({ type: 'question', sessionId, requestId: e.requestId, outcome: e.outcome })
  })
  el.addEventListener(AllowWritesToggledEvent.type, (e) => actions.toTarget((sessionId) => post({ type: 'set_allow_writes', sessionId, enabled: e.enabled })))
  el.addEventListener(SessionModelChangedEvent.type, (e) => post({ type: 'set_session_model', name: e.name }))
  el.addEventListener(SessionEffortChangedEvent.type, (e) => post({ type: 'set_session_effort', ...(e.effort ? { effort: e.effort } : {}) }))
  el.addEventListener(PlanApprovedEvent.type, () => post({ type: 'approve_plan' }))
  el.addEventListener(McpReconnectRequestedEvent.type, (e) => actions.toTarget((sessionId) => post({ type: 'reconnect_mcp', sessionId, server: e.server })))
  el.addEventListener(SessionSelectedEvent.type, (e) => post({ type: 'switch_session', sessionId: e.sessionId }))
  el.addEventListener(PlanResumeRequestedEvent.type, (e) => post({ type: 'resume_plan', feature: e.feature }))
  el.addEventListener(DefaultProfileChangedEvent.type, (e) => post({ type: 'set_default_profile', name: e.name }))
  el.addEventListener(AgentsMdAnsweredEvent.type, (e) => post({ type: 'agents_md_answer', scope: e.scope, answer: e.answer }))
  el.addEventListener(NewSessionRequestedEvent.type, (e) =>
    post({
      type: 'new_session',
      mode: e.mode,
      ...(e.feature ? { feature: e.feature } : {}),
      ...(e.prompt ? { prompt: e.prompt } : {}),
      ...(e.files.length > 0 ? { files: e.files } : {}),
    }),
  )
}
