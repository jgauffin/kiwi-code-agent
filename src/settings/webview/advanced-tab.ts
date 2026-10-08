import { SEARCH_PROVIDER_SECRET_NAME, type SettingsSnapshot } from '../protocol'
import { ApiKeySetEvent, SettingSavedEvent } from './events'
import { button, checkField, checkbox, field, heading, numberInput, onChange, settingsFileLink, textInput } from './fields'

/** How the host runs the engine: settings touched when something is wrong, not when working. */
export class AdvancedTab extends HTMLElement {
  private signature = ''

  update(snapshot: SettingsSnapshot): void {
    const searchKey = snapshot.keys.find((k) => k.name === SEARCH_PROVIDER_SECRET_NAME)
    const signature = JSON.stringify([snapshot.nodePath, snapshot.traceEngine, snapshot.compactAtTokens, searchKey?.stored])
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
    const searchApiKey = textInput('searchApiKey', '', { placeholder: searchKey?.stored ? 'Replace the stored key' : 'Paste the Brave Search API key' })
    searchApiKey.type = 'password'
    onChange(searchApiKey, () => {
      if (searchApiKey.value === '') return
      this.dispatchEvent(new ApiKeySetEvent(SEARCH_PROVIDER_SECRET_NAME, searchApiKey.value))
      searchApiKey.value = ''
    })
    const searchKeyField = field('Search provider key', searchApiKey, {
      hint: searchKey?.stored
        ? 'Stored in the editor’s secret storage. Leave blank to keep it.'
        : 'The research sub agent searches the internet through Brave Search. Without a key, it can still fetch a page it is already given, but not search for one.',
    })

    this.append(
      heading('Advanced', 'User settings'),
      field('Compact at (tokens)', compactAt, {
        hint: 'For models without a limit of their own (Models › Providers): a conversation this large is folded into a summary, even when the model’s window holds more, since every request re-sends the whole conversation. 0 compacts only when the window runs short. Applies to sessions started after the change.',
      }),
      field('Node executable', nodePath, { hint: 'Runs the Claude CLI. A path here wins over the editor’s Node.' }),
      checkField('Trace engine', trace, 'Logs every Claude SDK message to the Kiwipow Agent output channel. Applies to sessions started after the change.'),
      searchKeyField,
      ...(searchKey?.stored ? [button('Remove key', () => this.dispatchEvent(new ApiKeySetEvent(SEARCH_PROVIDER_SECRET_NAME, '')), 'remove')] : []),
      settingsFileLink('user'),
    )
  }
}

customElements.define('advanced-tab', AdvancedTab)
