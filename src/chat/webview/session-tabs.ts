import { compileTemplate } from '@relax.js/core/html'
import type { ResumableChat, ResumablePlan, SessionTab } from '../protocol'
import type { SessionStatus } from '../../agent/session/session-status'
import { NewSessionRequestedEvent, NewSessionViewRequestedEvent, PlanResumeRequestedEvent, SessionClosedEvent, SessionSelectedEvent } from './events'

const STATUS: Record<SessionStatus, { icon: string; label: string }> = {
  idle: { icon: '○', label: 'waiting for you' },
  planning: { icon: '📐', label: 'planning' },
  implementing: { icon: '🔧', label: 'implementing' },
  needs_human: { icon: '✋', label: 'needs you' },
  needs_approval: { icon: '🔒', label: 'waiting for you to allow or deny' },
  needs_answer: { icon: '❓', label: 'waiting for your answer' },
  error: { icon: '⚠', label: 'error' },
}

/** What picking the plan up means at its status: the plan bar offers the same. */
const STATUS_HINT: Record<ResumablePlan['status'], string> = {
  draft: 'draft: review, check or approve',
  approved: 'approved: ready to implement',
}

type TabRow = SessionTab & { icon: string; label: string; state: string }

type PlanRow = ResumablePlan & { hint: string }

type ChatRow = ResumableChat & { hint: string }

/** The chat's own date and time, as short as the reader's locale writes them. */
const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })

/**
 * Tabs for the sessions in play plus "+", and at the far right what can be
 * picked up again: the plans on disk, and the chats closed but not forgotten.
 * Neither has a tab until it is picked, so they hang off the bar instead.
 */
export class SessionTabs extends HTMLElement {
  private readonly template = compileTemplate(`
    <div class="bar">
      <ul class="tabs">
        <li loop="t in tabs" class="tab {{t.status}} {{t.state}}" title="{{t.title}} · {{t.profileName}} · {{t.label}}" r-click="select(t)">
          <span class="status">{{t.icon}}</span>
          <span class="title">{{t.title}}</span>
          <button type="button" class="close" title="Stop engine and hide tab" r-click="close(t, event)">×</button>
        </li>
        <li class="tab new {{newState}}" title="New session" r-click="add()">+</li>
      </ul>
      <div class="menu">
        <button type="button" class="old {{openState}} {{unfiledState}}" title="{{menuTitle}}" r-click="toggle(event)">↩<span class="count" if="unfiled">{{unfiled}}</span></button>
        <ul class="picks" if="open">
          <li class="empty" unless="any">Nothing to pick up yet.</li>
          <li if="unfiled">
            <button type="button" class="pick unfiled" title="Start a session that files them into the specs and docs they reach, each write confirmed by you." r-click="file()">
              <span class="icon">🗂</span>
              <span class="what">
                <strong>{{unfiledLabel}}</strong>
                <span class="hint">decided, not yet in the specs or docs</span>
              </span>
            </button>
          </li>
          <li loop="p in plans">
            <button type="button" class="pick plan {{p.status}}" title="Open the plan session behind this spec, or start one on it." r-click="resume(p)">
              <span class="icon">📐</span>
              <span class="what">
                <strong>{{p.feature}}</strong>
                <span class="hint">{{p.hint}}</span>
              </span>
            </button>
          </li>
          <li loop="c in chats">
            <button type="button" class="pick chat" title="Open this chat again, with its conversation as it stands." r-click="reopen(c)">
              <span class="icon">🔧</span>
              <span class="what">
                <strong>{{c.title}}</strong>
                <span class="hint">{{c.hint}}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  `)
  private tabs: SessionTab[] = []
  private creating = false
  private plans: PlanRow[] = []
  private chats: ChatRow[] = []
  /** Decisions waiting to be filed: pending work, so the menu says so while it is closed. */
  private unfiled = 0
  private open = false
  /** A click anywhere else is a click past the open list, and closes it. */
  private readonly dismiss = (event: Event): void => {
    if (this.open && !this.contains(event.target as Node)) {
      this.open = false
      this.render()
    }
  }

  connectedCallback(): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
    document.addEventListener('click', this.dismiss)
  }

  disconnectedCallback(): void {
    document.removeEventListener('click', this.dismiss)
  }

  update(tabs: SessionTab[], creating: boolean, pick: { plans: ResumablePlan[]; chats: ResumableChat[]; unfiled: number }): void {
    this.tabs = tabs
    this.creating = creating
    this.plans = pick.plans.map((p) => ({ ...p, hint: STATUS_HINT[p.status] }))
    this.chats = pick.chats.map((c) => ({ ...c, hint: when(c.startedAt) }))
    this.unfiled = pick.unfiled
    this.render()
  }

  private render(): void {
    const rows: TabRow[] = this.tabs.map((t) => ({
      ...t,
      ...STATUS[t.status],
      state: t.active && !this.creating ? 'active' : '',
    }))
    this.template.render(
      {
        tabs: rows,
        newState: this.creating ? 'active' : '',
        open: this.open,
        openState: this.open ? 'active' : '',
        any: this.plans.length + this.chats.length + this.unfiled > 0,
        plans: this.plans,
        chats: this.chats,
        unfiled: this.unfiled,
        unfiledState: this.unfiled > 0 ? 'waiting' : '',
        unfiledLabel: `${this.unfiled} unfiled decision${this.unfiled === 1 ? '' : 's'}`,
        menuTitle: this.unfiled > 0 ? `Pick up a plan or an earlier chat; ${this.unfiled} unfiled decision${this.unfiled === 1 ? '' : 's'} to file` : 'Pick up a plan or an earlier chat',
      },
      {
        select: (t: TabRow) => this.dispatchEvent(new SessionSelectedEvent(t.id)),
        close: (t: TabRow, event: Event) => {
          event.stopPropagation()
          this.dispatchEvent(new SessionClosedEvent(t.id))
        },
        add: () => this.dispatchEvent(new NewSessionViewRequestedEvent()),
        toggle: (event: Event) => {
          event.stopPropagation()
          this.open = !this.open
          this.render()
        },
        resume: (p: PlanRow) => {
          this.open = false
          this.render()
          this.dispatchEvent(new PlanResumeRequestedEvent(p.feature))
        },
        reopen: (c: ChatRow) => {
          this.open = false
          this.render()
          this.dispatchEvent(new SessionSelectedEvent(c.sessionId))
        },
        file: () => {
          this.open = false
          this.render()
          this.dispatchEvent(new NewSessionRequestedEvent('file-decisions', undefined, undefined))
        },
      },
    )
  }
}

customElements.define('session-tabs', SessionTabs)
