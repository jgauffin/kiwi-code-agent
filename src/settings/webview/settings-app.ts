import './settings.css'
import { onHostMessage, postToHost } from '../../chat/webview/vscode-api'
import type { FromSettingsWebview, SettingsSnapshot, ToSettingsWebview } from '../protocol'
import { AdvancedTab } from './advanced-tab'
import {
  ApiKeySetEvent,
  ProfileRemovedEvent,
  ProfileSavedEvent,
  SettingSavedEvent,
  SettingsFileRequestedEvent,
  SettingsTabSelectedEvent,
  type SettingsTab,
} from './events'
import { ModelsTab } from './models-tab'
import { PermissionsTab } from './permissions-tab'
import { ProjectTab } from './project-tab'

const post = (message: FromSettingsWebview): void => postToHost(message)

const TABS: { tab: SettingsTab; label: string }[] = [
  { tab: 'models', label: 'Models' },
  { tab: 'permissions', label: 'Permissions' },
  { tab: 'project', label: 'Project' },
  { tab: 'advanced', label: 'Advanced' },
]

/**
 * Root of the settings page. One tab per group, split by where the group is
 * written: what runs the model is the person's, what the agent may do in a
 * project is the workspace's. Children talk to it through events.
 */
export class SettingsApp extends HTMLElement {
  private readonly strip = document.createElement('nav')
  private readonly panes: Record<SettingsTab, HTMLElement & { update(snapshot: SettingsSnapshot): void }> = {
    models: new ModelsTab(),
    permissions: new PermissionsTab(),
    project: new ProjectTab(),
    advanced: new AdvancedTab(),
  }
  private tab: SettingsTab = 'models'

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.strip.className = 'tabs'
    this.append(this.strip)
    for (const [tab, pane] of Object.entries(this.panes)) {
      pane.className = `pane ${tab}`
      this.append(pane)
    }
    this.show(this.tab)

    this.addEventListener(SettingsTabSelectedEvent.type, (e) => this.show(e.tab))
    this.addEventListener(SettingSavedEvent.type, (e) => post({ type: 'save', key: e.key, value: e.value } as FromSettingsWebview))
    this.addEventListener(ProfileSavedEvent.type, (e) => post({ type: 'save_profile', index: e.index, profile: e.profile }))
    this.addEventListener(ProfileRemovedEvent.type, (e) => post({ type: 'remove_profile', index: e.index }))
    this.addEventListener(ApiKeySetEvent.type, (e) => post({ type: 'set_api_key', name: e.name, value: e.value }))
    this.addEventListener(SettingsFileRequestedEvent.type, (e) => post({ type: 'open_settings_file', target: e.scope }))

    onHostMessage<ToSettingsWebview>((message) => this.receive(message))
    post({ type: 'ready' })
  }

  private receive(message: ToSettingsWebview): void {
    if (message.type !== 'settings') return
    for (const pane of Object.values(this.panes)) pane.update(message.snapshot)
  }

  private show(tab: SettingsTab): void {
    this.tab = tab
    this.strip.replaceChildren()
    for (const entry of TABS) {
      const node = document.createElement('button')
      node.type = 'button'
      node.className = `tab${entry.tab === tab ? ' active' : ''}`
      node.textContent = entry.label
      node.addEventListener('click', () => this.dispatchEvent(new SettingsTabSelectedEvent(entry.tab)))
      this.strip.append(node)
    }
    for (const [name, pane] of Object.entries(this.panes)) pane.hidden = name !== tab
  }
}

customElements.define('settings-app', SettingsApp)
