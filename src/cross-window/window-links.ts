import { randomInt } from 'node:crypto'
import { CODE_TTL_MS, systemClock, type ClockPort } from '../remote-control/pairing'

/** One side of a link: a chat session, and the workspace whose window it lives in. */
export type LinkEnd = { workspaceId: string; workspaceName: string; sessionId: string }

/** A link joins exactly two sessions; an ended one stays on record so the other side can show it as ended. */
export type LinkRecord = { id: string; a: LinkEnd; b: LinkEnd; endedAt?: number; paused?: true }

export type PendingLinkCode = { code: string; end: LinkEnd; expiresAt: number }

/** What every window of this user on this machine shares: pending codes, links, and when each workspace's window was last seen. */
export type SharedLinkState = { codes: PendingLinkCode[]; links: LinkRecord[]; presence: Record<string, number> }

export const emptyLinkState = (): SharedLinkState => ({ codes: [], links: [], presence: {} })

export interface LinkStore {
  read(): SharedLinkState
  write(state: SharedLinkState): void
}

/** A window not heard from for this long shows as disconnected to the other side. */
export const PRESENCE_TTL_MS = 30 * 1000

export type LinkView = { state: 'none' } | { state: 'linked' | 'disconnected' | 'ended'; other: LinkEnd; paused?: true }

export type LinkEnvironment = {
  /** The mode of a session of this window, or nothing when there is no such session. */
  modeOf(sessionId: string): string | undefined
  /** False in a remote, container or WSL extension host: its user and files are not the ones the other windows share. */
  onLocalMachine(): boolean
}

export type SendCheck = { ok: true; target: LinkEnd } | { ok: false; reason: string }

const randomCode = (): string => Array.from({ length: 6 }, () => randomInt(10)).join('')

/** How this window's chat sessions are linked to chat sessions of other windows on the same machine. */
export class WindowLinks {
  constructor(
    private readonly store: LinkStore,
    private readonly self: { workspaceId: string; workspaceName: string },
    private readonly env: LinkEnvironment,
    private readonly clock: ClockPort = systemClock,
    private readonly makeCode: () => string = randomCode,
  ) {}

  /** Marks this window as open; called on a timer for as long as it is. */
  heartbeat(): void {
    const state = this.store.read()
    state.presence[this.self.workspaceId] = this.clock.now()
    this.store.write(state)
  }

  /** The window is going away: the other side shows the link as disconnected at once. */
  leave(): void {
    const state = this.store.read()
    delete state.presence[this.self.workspaceId]
    this.store.write(state)
  }

  /** A fresh code for the session, replacing any code it had pending. */
  requestCode(sessionId: string): { code: string; expiresAt: number } {
    this.assertMayLink(sessionId)
    const state = this.store.read()
    this.dropExpired(state)
    state.codes = state.codes.filter((c) => !(c.end.workspaceId === this.self.workspaceId && c.end.sessionId === sessionId))
    let code = this.makeCode()
    while (state.codes.some((c) => c.code === code)) code = this.makeCode()
    const pending = { code, end: this.endOf(sessionId), expiresAt: this.clock.now() + CODE_TTL_MS }
    state.codes.push(pending)
    this.store.write(state)
    return { code, expiresAt: pending.expiresAt }
  }

  /** Spends the code on the session, linking it to the session that produced the code. */
  enterCode(sessionId: string, code: string): LinkView {
    this.assertMayLink(sessionId)
    const state = this.store.read()
    const pending = this.usableCode(state, code)
    const mine = this.endOf(sessionId)
    state.codes = state.codes.filter((c) => c !== pending)
    state.links = state.links.filter((l) => l.endedAt === undefined || !(involves(l, mine) || involves(l, pending.end)))
    state.links.push({ id: `${pending.end.workspaceId}:${pending.end.sessionId}~${mine.workspaceId}:${mine.sessionId}`, a: pending.end, b: mine })
    this.store.write(state)
    return this.viewOf(sessionId)
  }

  /** Ends the session's link; the other side shows it as ended. */
  unlink(sessionId: string): void {
    const state = this.store.read()
    const link = this.activeLink(state, sessionId)
    if (!link) return
    link.endedAt = this.clock.now()
    this.store.write(state)
  }

  /** The session is deleted: its link ends and a code it had pending is void. */
  sessionRemoved(sessionId: string): void {
    const state = this.store.read()
    const mine = this.endOf(sessionId)
    state.codes = state.codes.filter((c) => !sameEnd(c.end, mine))
    const link = this.activeLink(state, sessionId)
    if (link) link.endedAt = this.clock.now()
    this.store.write(state)
  }

  viewOf(sessionId: string): LinkView {
    const state = this.store.read()
    const mine = this.endOf(sessionId)
    const link = state.links.find((l) => involves(l, mine) && l.endedAt === undefined) ?? state.links.find((l) => involves(l, mine))
    if (!link) return { state: 'none' }
    const other = sameEnd(link.a, mine) ? link.b : link.a
    if (link.endedAt !== undefined) return { state: 'ended', other }
    const seen = state.presence[other.workspaceId]
    return {
      state: seen !== undefined && this.clock.now() - seen < PRESENCE_TTL_MS ? 'linked' : 'disconnected',
      other,
      ...(link.paused ? { paused: true as const } : {}),
    }
  }

  /** Pauses the link for both windows: the agents cannot reach each other until it is resumed. */
  pause(sessionId: string): void {
    this.setPaused(sessionId, true)
  }

  /** Lets the agents reach each other again; what was refused meanwhile is not delivered. */
  resume(sessionId: string): void {
    this.setPaused(sessionId, false)
  }

  private setPaused(sessionId: string, paused: boolean): void {
    const state = this.store.read()
    const link = this.activeLink(state, sessionId)
    if (!link) return
    if (paused) link.paused = true
    else delete link.paused
    this.store.write(state)
  }

  /** Whether a message from the session may go to the other side now; nothing is held for a side that is away. */
  checkSend(sessionId: string): SendCheck {
    const view = this.viewOf(sessionId)
    switch (view.state) {
      case 'linked':
        if (view.paused) return { ok: false, reason: 'The conversation is paused by the person, so the message was not sent.' }
        return { ok: true, target: view.other }
      case 'disconnected':
        return { ok: false, reason: `The window of ${view.other.workspaceName} is not open, so the message was not sent.` }
      case 'ended':
        return { ok: false, reason: 'The link to the other session has ended.' }
      case 'none':
        return { ok: false, reason: 'This session is not linked to another window.' }
    }
  }

  /** Refuses a code that could not link a session of this window, before any session is started for it. */
  assertCodeUsable(code: string): void {
    this.assertOnLocalMachine()
    this.usableCode(this.store.read(), code)
  }

  assertOnLocalMachine(): void {
    if (!this.env.onLocalMachine()) throw new Error('This window runs on a remote, container or WSL host, so it cannot link to windows on your machine.')
  }

  private usableCode(state: SharedLinkState, code: string): PendingLinkCode {
    const pending = state.codes.find((c) => c.code === code.trim())
    if (!pending) throw new Error('That pairing code is not valid.')
    if (this.clock.now() >= pending.expiresAt) {
      this.dropExpired(state)
      this.store.write(state)
      throw new Error('That pairing code has expired.')
    }
    if (pending.end.workspaceId === this.self.workspaceId) throw new Error('That code was produced in this workspace; enter it in a session of another window.')
    return pending
  }

  private assertMayLink(sessionId: string): void {
    if (this.env.modeOf(sessionId) !== 'chat') throw new Error('Only a chat session can be linked to another window.')
    this.assertOnLocalMachine()
    const view = this.viewOf(sessionId)
    if (view.state === 'linked' || view.state === 'disconnected') throw new Error('This session is already linked; unlink it before taking another code.')
  }

  private endOf(sessionId: string): LinkEnd {
    return { workspaceId: this.self.workspaceId, workspaceName: this.self.workspaceName, sessionId }
  }

  private activeLink(state: SharedLinkState, sessionId: string): LinkRecord | undefined {
    const mine = this.endOf(sessionId)
    return state.links.find((l) => involves(l, mine) && l.endedAt === undefined)
  }

  private dropExpired(state: SharedLinkState): void {
    state.codes = state.codes.filter((c) => this.clock.now() < c.expiresAt)
  }
}

const sameEnd = (x: LinkEnd, y: LinkEnd): boolean => x.workspaceId === y.workspaceId && x.sessionId === y.sessionId
const involves = (link: LinkRecord, end: LinkEnd): boolean => sameEnd(link.a, end) || sameEnd(link.b, end)
