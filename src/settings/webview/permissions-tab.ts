import type { SettingsSnapshot } from '../protocol'
import { RuleListChangedEvent, SettingSavedEvent } from './events'
import { el, heading, note, settingsFileLink } from './fields'
import { RuleList } from './rule-list'

export const NO_WORKSPACE_NOTE = 'Open a folder to change workspace settings.'

/** What the agent may do without asking in this workspace, and what it may never do. */
export class PermissionsTab extends HTMLElement {
  private signature = ''

  update(snapshot: SettingsSnapshot): void {
    const signature = JSON.stringify([snapshot.permissions, snapshot.hasWorkspace])
    if (signature === this.signature) return
    this.signature = signature
    this.replaceChildren()

    const disabled = !snapshot.hasWorkspace
    this.append(heading('Permissions', 'This workspace'))
    if (disabled) this.append(note(NO_WORKSPACE_NOTE))
    this.append(
      this.list('Allowed without asking', 'permissions.allow', snapshot.permissions.allow, disabled),
      this.list('Denied', 'permissions.deny', snapshot.permissions.deny, disabled),
      note('A rule is a tool name, or a tool with a pattern: Edit, Edit(src/**), Bash(npm test), PowerShell(npm run:*). Deny wins over allow.'),
      settingsFileLink('workspace'),
    )
  }

  private list(title: string, key: 'permissions.allow' | 'permissions.deny', values: string[], disabled: boolean): HTMLElement {
    const section = el('section', 'rules')
    section.append(el('h3', '', title))
    const list = new RuleList()
    list.update(values, { placeholder: 'Edit(src/**)', disabled })
    list.addEventListener(RuleListChangedEvent.type, (e) => this.dispatchEvent(new SettingSavedEvent(key, e.values)))
    section.append(list)
    return section
  }
}

customElements.define('permissions-tab', PermissionsTab)
