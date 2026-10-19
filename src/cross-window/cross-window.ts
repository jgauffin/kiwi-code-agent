import type { SessionEvent } from '../agent/session/code-session'
import type { PersonsWord } from '../agent/session/session-manager'
import { CODE_TTL_MS, systemClock, type ClockPort } from '../remote-control/pairing'
import { AgentExchange, type Envelope, type MessageTransport } from './agent-exchange'
import { WindowLinks, type LinkStore } from './window-links'

/** What the person can do with a chat session's link from its composer. */
export type LinkAct = 'link' | 'unlink' | 'pause' | 'resume'

/** A chat session's link as the composer shows it, the other side named by its workspace. */
export type WindowLinkState = { state: 'none' } | { state: 'linked' | 'disconnected' | 'ended'; workspace: string; paused: boolean }

/** What the chat shows of a session's link, and lets the person do with it. */
export interface WindowLinkControl {
  /** Nothing for a session that is not a chat: only a chat is linked. */
  viewOf(sessionId: string): WindowLinkState | undefined
  act(sessionId: string, act: LinkAct): Promise<void>
}

export interface Mailbox extends MessageTransport {
  take(workspaceId: string): Envelope[]
}

/** What the link needs of this window's sessions. */
export interface LinkedSessions {
  get(id: string): { mode: string } | undefined
  list(): Array<{ id: string; mode: string }>
  record(id: string, event: SessionEvent): Promise<void>
  isInTurn(id: string): boolean
  startTurnFromAgent(id: string, text: string): Promise<void>
  endTurn(id: string): Promise<void>
  attachExchange(exchange: PersonsWord): void
  onRemoved(listener: (id: string) => void): void
}

/** The person's side of linking: how a code is made or entered. */
export interface LinkPrompts {
  /** Whether to produce a code here or enter one from the other window; nothing when the person backed out. */
  pickWay(): Promise<'create' | 'enter' | undefined>
  showCode(code: string, validMinutes: number): Promise<void>
  askCode(): Promise<string | undefined>
}

export type CrossWindowDeps = {
  store: LinkStore
  mailbox: Mailbox
  self: { workspaceId: string; workspaceName: string }
  sessions: LinkedSessions
  onLocalMachine: () => boolean
  limit: () => number
  prompts: LinkPrompts
  /** A link changed, here or in the other window: the composer shows it again. */
  changed: () => void
  clock?: ClockPort
}

/**
 * This window's end of cross-window chat: its chat sessions' links, the
 * messages their agents exchange, and the mailbox those travel through.
 */
export class CrossWindow implements WindowLinkControl {
  readonly exchange: AgentExchange
  private readonly links: WindowLinks
  /** The links as last shown, so a change made in the other window is noticed. */
  private shown = ''

  constructor(private readonly deps: CrossWindowDeps) {
    const { store, self, sessions, mailbox, limit } = deps
    this.links = new WindowLinks(store, self, { modeOf: (id) => sessions.get(id)?.mode, onLocalMachine: deps.onLocalMachine }, deps.clock ?? systemClock)
    this.exchange = new AgentExchange(
      self,
      this.links,
      mailbox,
      {
        record: (id, event) => sessions.record(id, event),
        inTurn: (id) => sessions.isInTurn(id),
        startTurn: (id, text) => sessions.startTurnFromAgent(id, text),
        // A pause ends the turn without counting as the person's Stop, which would hold the other agent's messages after the resume.
        interrupt: (id) => sessions.endTurn(id),
      },
      limit,
    )
    sessions.attachExchange(this.exchange)
    sessions.onRemoved((id) => this.links.sessionRemoved(id))
  }

  viewOf(sessionId: string): WindowLinkState | undefined {
    if (this.deps.sessions.get(sessionId)?.mode !== 'chat') return undefined
    const view = this.links.viewOf(sessionId)
    return view.state === 'none' ? view : { state: view.state, workspace: view.other.workspaceName, paused: view.paused === true }
  }

  async act(sessionId: string, act: LinkAct): Promise<void> {
    switch (act) {
      case 'link':
        await this.link(sessionId)
        break
      case 'unlink':
        this.links.unlink(sessionId)
        break
      case 'pause':
        await this.exchange.pause(sessionId)
        break
      case 'resume':
        this.exchange.resume(sessionId)
        break
    }
    this.noticeChanges()
  }

  /** Marks this window as open for the other side. */
  heartbeat(): void {
    this.links.heartbeat()
  }

  /** The window is going away: the other side shows the link as disconnected at once. */
  leave(): void {
    this.links.leave()
  }

  /** Takes what the other windows sent, and notices a link they changed. */
  async poll(): Promise<void> {
    for (const envelope of this.deps.mailbox.take(this.deps.self.workspaceId)) await this.exchange.receive(envelope)
    this.noticeChanges()
  }

  /** What arrived during a turn that ended without a tool result to carry it starts the next one. */
  async sessionEvent(sessionId: string, event: SessionEvent): Promise<void> {
    if (event.type === 'turn_done') await this.exchange.turnEnded(sessionId)
  }

  private async link(sessionId: string): Promise<void> {
    const { prompts } = this.deps
    const way = await prompts.pickWay()
    if (way === 'create') {
      const { code } = this.links.requestCode(sessionId)
      await prompts.showCode(code, Math.round(CODE_TTL_MS / 60_000))
    } else if (way === 'enter') {
      const code = await prompts.askCode()
      if (code?.trim()) this.links.enterCode(sessionId, code)
    }
  }

  private noticeChanges(): void {
    const views = JSON.stringify(
      this.deps.sessions
        .list()
        .filter((r) => r.mode === 'chat')
        .map((r) => [r.id, this.viewOf(r.id)]),
    )
    if (views === this.shown) return
    this.shown = views
    this.deps.changed()
  }
}
