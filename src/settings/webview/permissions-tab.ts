import type { SettingsSnapshot } from '../protocol'
import type { Grant, GrantScope } from '../../agent/permissions/grants'
import { grantSentence } from '../../agent/permissions/grant-sentence'
import { PersonGrantsChangedEvent, SettingSavedEvent } from './events'
import { checkField, checkbox, el, heading, note, onChange, settingsFileLink } from './fields'

export const NO_WORKSPACE_NOTE = 'Open a folder to change workspace settings.'

/**
 * The answers kept from permission prompts: for this workspace, and for the
 * person wherever they open a project. Each reads as the sentence it was kept
 * as on the prompt, and is removed here; new ones are kept from a prompt.
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
      this.grantList(snapshot.permissions.workspace, 'workspace', disabled, (grants) => new SettingSavedEvent('permissions.grants', grants)),
      note("Answers are kept from a permission prompt. A denial wins over an allow in any scope. Rules in the Claude engine's own .claude/settings.json are honoured too."),
      this.gitWrites(snapshot.permissions.denyGitWrites, disabled),
      settingsFileLink('workspace'),
    )
    // Not a workspace setting, so it is never disabled for want of a folder open: it has nowhere else to live.
    const person = el('div', 'person')
    person.append(
      heading('Permissions', 'For you, in every workspace'),
      this.grantList(snapshot.permissions.person, 'person', false, (grants) => new PersonGrantsChangedEvent(grants)),
      note('Places outside every repository, granted once here rather than asked for again in each workspace that reaches them.'),
    )
    this.append(workspace, person)
  }

  private grantList(grants: Grant[], scope: GrantScope, disabled: boolean, changed: (grants: Grant[]) => Event): HTMLElement {
    const section = el('section', 'grants')
    if (grants.length === 0) {
      section.append(note('Nothing kept yet.'))
      return section
    }
    const list = el('ul', 'grant-list')
    grants.forEach((grant, index) => {
      const item = el('li', grant.verdict)
      const remove = el('button', 'remove', 'Remove')
      remove.setAttribute('type', 'button')
      if (disabled) remove.setAttribute('disabled', '')
      remove.addEventListener('click', () => this.dispatchEvent(changed(grants.filter((_, i) => i !== index))))
      item.append(el('span', 'sentence', grantSentence(grant, scope)), remove)
      list.append(item)
    })
    section.append(list)
    return section
  }

  private gitWrites(checked: boolean, disabled: boolean): HTMLElement {
    const section = el('section', 'git')
    section.append(el('h3', '', 'Git'))
    const box = checkbox('permissions.denyGitWrites', checked, { disabled })
    onChange(box, () => this.dispatchEvent(new SettingSavedEvent('permissions.denyGitWrites', box.checked)))
    section.append(
      checkField('Deny git writes', box, 'Blocks every git command that changes the repository (commit, push, checkout, stash, reset, ...), whatever is kept. Status, log, diff and other reads still run.'),
    )
    return section
  }
}

customElements.define('permissions-tab', PermissionsTab)
