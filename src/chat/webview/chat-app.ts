import type { PlanState, ToWebview } from '../protocol'
import type { SessionEvent } from '../../agent/session/code-session'
import { onMessage, post } from './vscode-api'
import { ChatComposer } from './chat-composer'
import { ChatTranscript } from './chat-transcript'
import { NewSessionView } from './new-session-view'
import { PlanBar } from './plan-bar'
import { PlanView } from './plan-view'
import { SessionTabs } from './session-tabs'
import {
  AllowWritesToggledEvent,
  ImplementRequestedEvent,
  IntentUpdateRequestedEvent,
  InterruptRequestedEvent,
  NewSessionRequestedEvent,
  NewSessionViewRequestedEvent,
  PermissionDecidedEvent,
  PlanResumeRequestedEvent,
  PlanViewSelectedEvent,
  PromptSubmittedEvent,
  ReviewActionEvent,
  SessionClosedEvent,
  SessionSelectedEvent,
  SpecApprovedEvent,
  SpecMapRequestedEvent,
  SpecMapStoppedEvent,
  VerifyRequestedEvent,
  type PlanView as PlanViewName,
} from './events'

/**
 * Root of the chat UI. Talks to the extension host; children talk to it
 * through events. Shows the new-session screen, or the active session: its
 * transcript, or in a plan session either the transcript or the spec.
 */
export class ChatApp extends HTMLElement {
  private readonly tabs = new SessionTabs()
  private readonly planBar = new PlanBar()
  private readonly planView = new PlanView()
  private readonly newSession = new NewSessionView()
  private readonly transcript = new ChatTranscript()
  private readonly composer = new ChatComposer()
  private activeSessionId: string | undefined
  private creating = false
  private plan: PlanState | undefined
  private view: PlanViewName = 'chat'

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.tabs.className = 'tabs'
    this.planBar.className = 'plan-bar'
    this.planBar.hidden = true
    this.planView.className = 'plan-view'
    this.planView.hidden = true
    this.newSession.className = 'new-session'
    this.transcript.className = 'transcript'
    this.composer.className = 'composer'
    this.append(this.tabs, this.planBar, this.newSession, this.planView, this.transcript, this.composer)

    this.addEventListener(SpecApprovedEvent.type, () => post({ type: 'approve_spec' }))
    this.addEventListener(ReviewActionEvent.type, (e) => post(e.action))
    this.addEventListener(SpecMapRequestedEvent.type, () => post({ type: 'map_spec' }))
    this.addEventListener(SpecMapStoppedEvent.type, () => post({ type: 'stop_map' }))
    this.addEventListener(ImplementRequestedEvent.type, () => post({ type: 'implement_spec' }))
    this.addEventListener(VerifyRequestedEvent.type, () => post({ type: 'verify_spec' }))
    this.addEventListener(IntentUpdateRequestedEvent.type, () => post({ type: 'update_intent' }))
    this.addEventListener(PlanViewSelectedEvent.type, (e) => this.show(e.view))

    this.addEventListener(PromptSubmittedEvent.type, (e) => post({ type: 'send', text: e.text }))
    this.addEventListener(InterruptRequestedEvent.type, () => post({ type: 'interrupt' }))
    this.addEventListener(PermissionDecidedEvent.type, (e) =>
      post({ type: 'permission', requestId: e.requestId, decision: e.decision }),
    )
    this.addEventListener(AllowWritesToggledEvent.type, (e) => post({ type: 'set_allow_writes', enabled: e.enabled }))
    this.addEventListener(SessionSelectedEvent.type, (e) => {
      this.showCreating(false)
      post({ type: 'switch_session', sessionId: e.sessionId })
    })
    this.addEventListener(SessionClosedEvent.type, (e) => post({ type: 'close_session', sessionId: e.sessionId }))
    this.addEventListener(NewSessionViewRequestedEvent.type, () => this.showCreating(true))
    this.addEventListener(PlanResumeRequestedEvent.type, (e) => post({ type: 'resume_plan', feature: e.feature }))
    this.addEventListener(NewSessionRequestedEvent.type, (e) =>
      post({
        type: 'new_session',
        mode: e.mode,
        ...(e.feature ? { feature: e.feature } : {}),
        ...(e.prompt ? { prompt: e.prompt } : {}),
      }),
    )

    onMessage((message) => this.receive(message))
    post({ type: 'ready' })
  }

  private receive(message: ToWebview): void {
    switch (message.type) {
      case 'state': {
        const active = message.tabs.find((t) => t.active)
        this.activeSessionId = active?.id
        if (!active && !this.creating) this.showCreating(true)
        this.tabs.update(message.tabs, this.creating)
        this.newSession.update(message.plans)
        this.composer.setSwitches({ allowWrites: message.allowWrites })
        this.plan = message.plan
        this.planView.update(this.plan)
        this.layout()
        break
      }
      case 'transcript':
        if (message.sessionId !== this.activeSessionId) return
        this.showCreating(false)
        this.transcript.reset(message.events)
        // A spec that exists is what the session is about; the conversation is one click away.
        this.show(this.plan?.body ? 'plan' : 'chat')
        this.composer.focusInput()
        break
      case 'event':
        if (message.sessionId !== this.activeSessionId) return
        this.transcript.apply(message.event)
        this.follow(message.event)
        break
      case 'show_new_session':
        this.showCreating(true)
        break
    }
  }

  /** The chat shows while the planner works; its finished spec takes over when the turn ends. */
  private follow(event: SessionEvent): void {
    if (!this.plan) return
    switch (event.type) {
      case 'assistant_text':
      case 'assistant_thinking':
      case 'assistant_message':
      case 'tool_call':
      case 'permission_request':
      case 'error':
        this.show('chat')
        break
      case 'status':
        if (event.status !== 'idle') this.show('chat')
        break
      case 'turn_done':
        if (!event.isError) this.show('plan')
        break
    }
  }

  private show(view: PlanViewName): void {
    this.view = view
    this.layout()
  }

  private layout(): void {
    const plan = this.creating ? undefined : this.plan
    const planShown = this.view === 'plan' && plan?.body !== undefined
    this.planView.hidden = !planShown
    this.transcript.hidden = this.creating || planShown
    this.planBar.update(plan, planShown ? 'plan' : 'chat')
  }

  private showCreating(creating: boolean): void {
    this.creating = creating
    this.newSession.hidden = !creating
    this.composer.hidden = creating
    if (creating) this.newSession.reset()
    this.layout()
  }
}

customElements.define('chat-app', ChatApp)
