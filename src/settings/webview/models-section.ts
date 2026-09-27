import type { SettingsSnapshot } from '../protocol'
import { ModelsSubTabSelectedEvent, type ModelsSubTab } from './events'
import { ProfilesTab } from './profiles-tab'
import { ProvidersTab } from './providers-tab'

const SUBTABS: { tab: ModelsSubTab; label: string }[] = [
  { tab: 'providers', label: 'Providers' },
  { tab: 'profiles', label: 'Profiles' },
]

/**
 * Where a model comes from, and what a session runs on: two views of the
 * same setting, so they sit under one tab rather than two unrelated ones. A
 * profile can only name a provider that already exists, and Providers is
 * where you make one exist.
 */
export class ModelsSection extends HTMLElement {
  private readonly strip = document.createElement('nav')
  private readonly providersTab = new ProvidersTab()
  private readonly profilesTab = new ProfilesTab()
  private subtab: ModelsSubTab = 'providers'

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.strip.className = 'subtabs'
    this.providersTab.className = 'subpane providers'
    this.profilesTab.className = 'subpane profiles'
    this.append(this.strip, this.providersTab, this.profilesTab)
    this.show(this.subtab)
    this.addEventListener(ModelsSubTabSelectedEvent.type, (e) => this.show(e.tab))
  }

  update(snapshot: SettingsSnapshot): void {
    this.providersTab.update(snapshot)
    this.profilesTab.update(snapshot)
  }

  /** The models a provider's endpoint just reported, on their way to the Providers sub-tab. */
  discoveredModels(provider: string, models: string[]): void {
    this.providersTab.discoveredModels(provider, models)
  }

  private show(tab: ModelsSubTab): void {
    this.subtab = tab
    this.strip.replaceChildren()
    for (const entry of SUBTABS) {
      const node = document.createElement('button')
      node.type = 'button'
      node.className = `tab${entry.tab === tab ? ' active' : ''}`
      node.textContent = entry.label
      node.addEventListener('click', () => this.dispatchEvent(new ModelsSubTabSelectedEvent(entry.tab)))
      this.strip.append(node)
    }
    this.providersTab.hidden = tab !== 'providers'
    this.profilesTab.hidden = tab !== 'profiles'
  }
}

customElements.define('models-section', ModelsSection)
