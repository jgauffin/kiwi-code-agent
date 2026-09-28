import { compileTemplate } from '@relax.js/core/html'
import type { ResumablePlan, SessionTab } from '../protocol'
import type { SessionStatus } from '../../agent/session/session-status'
import { NewSessionViewRequestedEvent, PlanResumeRequestedEvent, SessionClosedEvent, SessionSelectedEvent } from './events'

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

/**
 * Tabs for the sessions in play plus "+", and at the far right the plans on
 * disk to pick up. They are not sessions until one is picked, so they hang off
 * the bar rather than taking a tab of their own.
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
        <button type="button" class="old {{openState}}" title="Resume a plan under plan/" r-click="toggle(event)">↩</button>
        <ul class="plans" if="open">
          <li class="empty" unless="hasPlans">No plan under plan/ is in progress.</li>
          <li loop="p in plans">
            <button type="button" class="plan {{p.status}}" title="Open the plan session behind this spec, or start one on it." r-click="resume(p)">
              <strong>{{p.feature}}</strong>
              <span class="hint">{{p.hint}}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  `)
  private tabs: SessionTab[] = []
  private creating = false
  private plans: PlanRow[] = []
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

  update(tabs: SessionTab[], creating: boolean, plans: ResumablePlan[]): void {
    this.tabs = tabs
    this.creating = creating
    this.plans = plans.map((p) => ({ ...p, hint: STATUS_HINT[p.status] }))
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
        hasPlans: this.plans.length > 0,
        plans: this.plans,
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
      },
    )
  }
}

customElements.define('session-tabs', SessionTabs)
