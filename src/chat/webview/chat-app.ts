import type { ToWebview } from '../protocol'
import { onMessage, post } from './vscode-api'
import { ChatComposer } from './chat-composer'
import { ChatTranscript } from './chat-transcript'
import { NewSessionView } from './new-session-view'
import { PlanBar } from './plan-bar'
import { SessionTabs } from './session-tabs'
import {
  InterruptRequestedEvent,
  NewSessionRequestedEvent,
  NewSessionViewRequestedEvent,
  PermissionDecidedEvent,
  PromptSubmittedEvent,
  SessionClosedEvent,
  SessionSelectedEvent,
  SpecApprovedEvent,
  SpecOpenRequestedEvent,
  VerifyToggledEvent,
} from './events'

/**
 * Root of the chat UI. Talks to the extension host; children talk to it
 * through events. Shows either the active session's transcript or the
 * new-session screen.
 */
export class ChatApp extends HTMLElement {
  private readonly tabs = new SessionTabs()
  private readonly planBar = new PlanBar()
  private readonly newSession = new NewSessionView()
  private readonly transcript = new ChatTranscript()
  private readonly composer = new ChatComposer()
  private activeSessionId: string | undefined
  private creating = false

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.tabs.className = 'tabs'
    this.planBar.className = 'plan-bar'
    this.planBar.hidden = true
    this.newSession.className = 'new-session'
    this.transcript.className = 'transcript'
    this.composer.className = 'composer'
    this.append(this.tabs, this.planBar, this.newSession, this.transcript, this.composer)

    this.addEventListener(SpecApprovedEvent.type, () => post({ type: 'approve_spec' }))
    this.addEventListener(SpecOpenRequestedEvent.type, () => post({ type: 'open_spec' }))

    this.addEventListener(PromptSubmittedEvent.type, (e) => post({ type: 'send', text: e.text }))
    this.addEventListener(InterruptRequestedEvent.type, () => post({ type: 'interrupt' }))
    this.addEventListener(PermissionDecidedEvent.type, (e) =>
      post({ type: 'permission', requestId: e.requestId, decision: e.decision }),
    )
    this.addEventListener(VerifyToggledEvent.type, (e) => post({ type: 'set_verify', enabled: e.enabled }))
    this.addEventListener(SessionSelectedEvent.type, (e) => {
      this.showCreating(false)
      post({ type: 'switch_session', sessionId: e.sessionId })
    })
    this.addEventListener(SessionClosedEvent.type, (e) => post({ type: 'close_session', sessionId: e.sessionId }))
    this.addEventListener(NewSessionViewRequestedEvent.type, () => this.showCreating(true))
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
        this.composer.setVerify(message.verify)
        this.planBar.update(this.creating ? undefined : message.plan)
        break
      }
      case 'transcript':
        if (message.sessionId !== this.activeSessionId) return
        this.showCreating(false)
        this.transcript.reset(message.events)
        this.composer.focusInput()
        break
      case 'event':
        if (message.sessionId !== this.activeSessionId) return
        this.transcript.apply(message.event)
        break
      case 'show_new_session':
        this.showCreating(true)
        break
    }
  }

  private showCreating(creating: boolean): void {
    this.creating = creating
    this.newSession.hidden = !creating
    this.transcript.hidden = creating
    this.composer.hidden = creating
    if (creating) {
      this.planBar.hidden = true
      this.newSession.reset()
    }
  }
}

customElements.define('chat-app', ChatApp)
