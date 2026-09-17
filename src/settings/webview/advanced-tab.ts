import type { SettingsSnapshot } from '../protocol'
import { SettingSavedEvent } from './events'
import { checkField, checkbox, field, heading, onChange, settingsFileLink, textInput } from './fields'

/** How the host runs the engine: settings touched when something is wrong, not when working. */
export class AdvancedTab extends HTMLElement {
  private signature = ''

  update(snapshot: SettingsSnapshot): void {
    const signature = JSON.stringify([snapshot.nodePath, snapshot.traceEngine])
    if (signature === this.signature) return
    this.signature = signature
    this.replaceChildren()

    const nodePath = textInput('nodePath', snapshot.nodePath, { placeholder: 'Leave empty to run on the editor’s own Node' })
    onChange(nodePath, () => this.dispatchEvent(new SettingSavedEvent('nodePath', nodePath.value.trim())))
    const trace = checkbox('traceEngine', snapshot.traceEngine)
    onChange(trace, () => this.dispatchEvent(new SettingSavedEvent('traceEngine', trace.checked)))

    this.append(
      heading('Advanced', 'User settings'),
      field('Node executable', nodePath, { hint: 'Runs the Claude CLI. A path here wins over the editor’s Node.' }),
      checkField('Trace engine', trace, 'Logs every Claude SDK message to the KiwiAgent output channel. Applies to sessions started after the change.'),
      settingsFileLink('user'),
    )
  }
}

customElements.define('advanced-tab', AdvancedTab)
