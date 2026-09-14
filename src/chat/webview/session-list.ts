import { compileTemplate } from '@relax.js/core/html'
import type { SessionSummary } from '../protocol'
import { NewSessionRequestedEvent, SessionRemovedEvent, SessionSelectedEvent } from './events'

type SessionRow = SessionSummary & { state: 'active' | '' }

/** Session picker plus "new session with profile". Parent supplies the data. */
export class SessionList extends HTMLElement {
  private readonly template = compileTemplate(`
    <form class="new-session" r-submit="create(event)">
      <select name="profile">
        <option loop="p in profiles" value="{{p}}">{{p}}</option>
      </select>
      <button type="submit">New</button>
    </form>
    <ul class="sessions">
      <li loop="s in sessions" class="session {{s.engine}} {{s.state}}" r-click="select(s)">
        <span class="live" if="s.live" title="engine running">●</span>
        <span class="title">{{s.title}}</span>
        <span class="profile">{{s.profileName}}</span>
        <button type="button" class="remove" title="Remove" r-click="remove(s, event)">×</button>
      </li>
    </ul>
  `)

  connectedCallback(): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
  }

  update(sessions: SessionSummary[], activeId: string | undefined, profiles: string[]): void {
    const rows: SessionRow[] = sessions.map((s) => ({ ...s, state: s.id === activeId ? 'active' : '' }))
    this.template.render(
      { sessions: rows, profiles },
      {
        create: (event: SubmitEvent) => {
          event.preventDefault()
          const form = event.target as HTMLFormElement
          const profile = (form.elements.namedItem('profile') as HTMLSelectElement).value
          this.dispatchEvent(new NewSessionRequestedEvent(profile))
        },
        select: (s: SessionRow) => this.dispatchEvent(new SessionSelectedEvent(s.id)),
        remove: (s: SessionRow, event: Event) => {
          event.stopPropagation()
          this.dispatchEvent(new SessionRemovedEvent(s.id))
        },
      },
    )
  }
}

customElements.define('session-list', SessionList)
