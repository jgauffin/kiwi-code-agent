import type { SettingsSnapshot } from '../protocol'
import { PersonRulesChangedEvent, RuleListChangedEvent, SettingSavedEvent } from './events'
import { checkField, checkbox, el, heading, note, onChange, settingsFileLink } from './fields'
import { RuleList } from './rule-list'

export const NO_WORKSPACE_NOTE = 'Open a folder to change workspace settings.'

/**
 * What the agent may do without asking: in this workspace, and for the
 * person wherever they open a project, which is where a rule about ground
 * outside every repository belongs, granted once rather than per workspace.
 */
export class PermissionsTab extends HTMLElement {
  private signature = ''

  update(snapshot: SettingsSnapshot): void {
    const signature = JSON.stringify([snapshot.permissions, snapshot.hasWorkspace])
    if (signature === this.signature) return
    this.signature = signature
    this.replaceChildren()

    const disabled = !snapshot.hasWorkspace
    const workspace = el('div', 'workspace')
    workspace.append(heading('Permissions', 'This workspace'))
    if (disabled) workspace.append(note(NO_WORKSPACE_NOTE))
    workspace.append(
      this.list('Allowed without asking', 'permissions.allow', snapshot.permissions.allow, disabled),
      this.list('Denied', 'permissions.deny', snapshot.permissions.deny, disabled),
      note('A rule is a tool name, or a tool with a pattern: Edit, Edit(src/**), Bash(npm test), PowerShell(npm run:*). Deny wins over allow.'),
      this.gitWrites(snapshot.permissions.denyGitWrites, disabled),
      settingsFileLink('workspace'),
    )
    // Not a workspace setting, so it is never disabled for want of a folder open: it has nowhere else to live.
    const person = el('div', 'person')
    person.append(
      heading('Permissions', 'For you, in every workspace'),
      this.personList('Allowed without asking', 'allow', snapshot.permissions.person.allow),
      this.personList('Denied', 'deny', snapshot.permissions.person.deny),
      note('A folder or a file outside every repository, granted once here rather than asked for again in each workspace that reaches it.'),
    )
    this.append(workspace, person)
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

  private personList(title: string, kind: 'allow' | 'deny', values: string[]): HTMLElement {
    const section = el('section', 'rules')
    section.append(el('h3', '', title))
    const list = new RuleList()
    list.update(values, { placeholder: 'D:/data' })
    list.addEventListener(RuleListChangedEvent.type, (e) => this.dispatchEvent(new PersonRulesChangedEvent(kind, e.values)))
    section.append(list)
    return section
  }

  private gitWrites(checked: boolean, disabled: boolean): HTMLElement {
    const section = el('section', 'git')
    section.append(el('h3', '', 'Git'))
    const box = checkbox('permissions.denyGitWrites', checked, { disabled })
    onChange(box, () => this.dispatchEvent(new SettingSavedEvent('permissions.denyGitWrites', box.checked)))
    section.append(
      checkField('Deny git writes', box, 'Blocks every git command that changes the repository (commit, push, checkout, stash, reset, ...), whatever the allow rules say. Status, log, diff and other reads still run.'),
    )
    return section
  }
}

customElements.define('permissions-tab', PermissionsTab)
