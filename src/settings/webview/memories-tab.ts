import type { MemoryEntry, MemoryScope } from '../../agent/memory/memories'
import type { SettingsSnapshot } from '../protocol'
import { MemoryForgottenEvent, MemoryOpenedEvent } from './events'
import { button, el, heading, note } from './fields'

/** What is kept for this project and for the person: listed index-first, opened by hand to change, forgotten to drop for good. */
export class MemoriesTab extends HTMLElement {
  private signature = ''

  update(snapshot: SettingsSnapshot): void {
    const signature = JSON.stringify(snapshot.memories)
    if (signature === this.signature) return
    this.signature = signature
    this.replaceChildren(
      heading('Memories', 'Working notes, not settings'),
      note('A memory is a working note about this codebase or how you want to be worked with, written by the agent when you settle something. Open one to change it by hand; forget one to drop it for good.'),
      this.group('project', 'This project', snapshot.memories.project, 'Nothing remembered for this project yet.'),
      this.group('user', 'You, everywhere', snapshot.memories.user, 'Nothing remembered about you yet.'),
    )
  }

  private group(scope: MemoryScope, title: string, entries: MemoryEntry[], empty: string): HTMLElement {
    const section = el('section', scope)
    section.append(el('h3', '', title))
    if (entries.length === 0) section.append(note(empty))
    for (const entry of entries) section.append(this.row(scope, entry))
    return section
  }

  private row(scope: MemoryScope, entry: MemoryEntry): HTMLElement {
    const row = el('article', 'memory')
    const text = el('div', 'text')
    text.append(el('strong', 'title', entry.title), el('span', 'summary', entry.summary))
    const controls = el('div', 'controls')
    controls.append(
      button('Open', () => this.dispatchEvent(new MemoryOpenedEvent(scope, entry.file))),
      button('Forget', () => this.dispatchEvent(new MemoryForgottenEvent(scope, entry.title)), 'remove'),
    )
    row.append(text, controls)
    return row
  }
}

customElements.define('memories-tab', MemoriesTab)
