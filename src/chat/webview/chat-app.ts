import type { ToWebview } from '../protocol'
import { onMessage, post } from './vscode-api'
import { ChatComposer } from './chat-composer'
import { ChatTranscript } from './chat-transcript'
import { SessionList } from './session-list'
import {
  InterruptRequestedEvent,
  NewSessionRequestedEvent,
  PermissionDecidedEvent,
  PromptSubmittedEvent,
  SessionRemovedEvent,
  SessionSelectedEvent,
  VerifyToggledEvent,
} from './events'

/** Root of the chat UI. Talks to the extension host; children talk to it through events. */
export class ChatApp extends HTMLElement {
  private readonly sessions = new SessionList()
  private readonly transcript = new ChatTranscript()
  private readonly composer = new ChatComposer()
  private activeSessionId: string | undefined

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.sessions.className = 'sessions'
    this.transcript.className = 'transcript'
    this.composer.className = 'composer'
    this.append(this.sessions, this.transcript, this.composer)

    this.addEventListener(PromptSubmittedEvent.type, (e) => post({ type: 'send', text: e.text }))
    this.addEventListener(InterruptRequestedEvent.type, () => post({ type: 'interrupt' }))
    this.addEventListener(PermissionDecidedEvent.type, (e) =>
      post({ type: 'permission', requestId: e.requestId, decision: e.decision }),
    )
    this.addEventListener(NewSessionRequestedEvent.type, (e) => post({ type: 'new_session', profileName: e.profileName }))
    this.addEventListener(SessionSelectedEvent.type, (e) => post({ type: 'switch_session', sessionId: e.sessionId }))
    this.addEventListener(SessionRemovedEvent.type, (e) => post({ type: 'remove_session', sessionId: e.sessionId }))
    this.addEventListener(VerifyToggledEvent.type, (e) => post({ type: 'set_verify', enabled: e.enabled }))

    onMessage((message) => this.receive(message))
    post({ type: 'ready' })
  }

  private receive(message: ToWebview): void {
    switch (message.type) {
      case 'state':
        this.activeSessionId = message.activeSessionId
        this.sessions.update(message.sessions, message.activeSessionId, message.profiles)
        this.composer.setVerify(message.verify)
        break
      case 'transcript':
        if (message.sessionId !== this.activeSessionId) return
        this.transcript.reset(message.events)
        this.composer.focusInput()
        break
      case 'event':
        if (message.sessionId !== this.activeSessionId) return
        this.transcript.apply(message.event)
        break
    }
  }
}

customElements.define('chat-app', ChatApp)
