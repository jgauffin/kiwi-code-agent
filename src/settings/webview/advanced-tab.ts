import type { SettingsSnapshot } from '../protocol'
import { SettingSavedEvent } from './events'
import { checkField, checkbox, field, heading, numberInput, onChange, settingsFileLink, textInput } from './fields'

/** How the host runs the engine: settings touched when something is wrong, not when working. */
export class AdvancedTab extends HTMLElement {
  private signature = ''

  update(snapshot: SettingsSnapshot): void {
    const signature = JSON.stringify([snapshot.nodePath, snapshot.traceEngine, snapshot.compactAtTokens])
    if (signature === this.signature) return
    this.signature = signature
    this.replaceChildren()

    const nodePath = textInput('nodePath', snapshot.nodePath, { placeholder: 'Leave empty to run on the editor’s own Node' })
    onChange(nodePath, () => this.dispatchEvent(new SettingSavedEvent('nodePath', nodePath.value.trim())))
    const trace = checkbox('traceEngine', snapshot.traceEngine)
    onChange(trace, () => this.dispatchEvent(new SettingSavedEvent('traceEngine', trace.checked)))
    const compactAt = numberInput('compactAtTokens', snapshot.compactAtTokens)
    onChange(compactAt, () => {
      const parsed = Number.parseInt(compactAt.value, 10)
      // A blank or negative size is no ceiling anyone meant; the field goes back to what holds.
      if (Number.isNaN(parsed) || parsed < 0) {
        compactAt.value = String(snapshot.compactAtTokens)
        return
      }
      this.dispatchEvent(new SettingSavedEvent('compactAtTokens', parsed))
    })

    this.append(
      heading('Advanced', 'User settings'),
      field('Compact at (tokens)', compactAt, {
        hint: 'For models without a limit of their own (Models › Providers): a conversation this large is folded into a summary, even when the model’s window holds more, since every request re-sends the whole conversation. 0 compacts only when the window runs short. Applies to sessions started after the change.',
      }),
      field('Node executable', nodePath, { hint: 'Runs the Claude CLI. A path here wins over the editor’s Node.' }),
      checkField('Trace engine', trace, 'Logs every Claude SDK message to the KiwiAgent output channel. Applies to sessions started after the change.'),
      settingsFileLink('user'),
    )
  }
}

customElements.define('advanced-tab', AdvancedTab)
