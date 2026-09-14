import { compileTemplate } from '@relax.js/core/html'
import type { SessionTab } from '../protocol'
import type { SessionStatus } from '../../agent/session/session-status'
import { NewSessionViewRequestedEvent, SessionClosedEvent, SessionSelectedEvent } from './events'

const STATUS: Record<SessionStatus, { icon: string; label: string }> = {
  idle: { icon: '○', label: 'waiting for you' },
  planning: { icon: '📐', label: 'planning' },
  implementing: { icon: '🔧', label: 'implementing' },
  verifying: { icon: '🧪', label: 'verifying' },
  needs_human: { icon: '✋', label: 'needs you' },
  error: { icon: '⚠', label: 'error' },
}

type TabRow = SessionTab & { icon: string; label: string; state: string }

/** Tabs for the sessions in play plus "+". Parent supplies the data; clicks become events. */
export class SessionTabs extends HTMLElement {
  private readonly template = compileTemplate(`
    <ul class="tabs">
      <li loop="t in tabs" class="tab {{t.status}} {{t.state}}" title="{{t.title}} · {{t.profileName}} · {{t.label}}" r-click="select(t)">
        <span class="status">{{t.icon}}</span>
        <span class="title">{{t.title}}</span>
        <button type="button" class="close" title="Stop engine and hide tab" r-click="close(t, event)">×</button>
      </li>
      <li class="tab new {{newState}}" title="New session" r-click="add()">+</li>
    </ul>
  `)

  connectedCallback(): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
  }

  update(tabs: SessionTab[], creating: boolean): void {
    const rows: TabRow[] = tabs.map((t) => ({
      ...t,
      ...STATUS[t.status],
      state: t.active && !creating ? 'active' : '',
    }))
    this.template.render(
      { tabs: rows, newState: creating ? 'active' : '' },
      {
        select: (t: TabRow) => this.dispatchEvent(new SessionSelectedEvent(t.id)),
        close: (t: TabRow, event: Event) => {
          event.stopPropagation()
          this.dispatchEvent(new SessionClosedEvent(t.id))
        },
        add: () => this.dispatchEvent(new NewSessionViewRequestedEvent()),
      },
    )
  }
}

customElements.define('session-tabs', SessionTabs)
