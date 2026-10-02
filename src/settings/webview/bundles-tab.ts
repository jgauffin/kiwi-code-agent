import type { AppliedBundle, Bundle, BundleScope, BundleSkill, BundleTarget } from '../../agent/instructions/bundles'
import type { SettingsSnapshot } from '../protocol'
import { BundleAppliedEvent, BundleOfferDismissedEvent, BundleRemovedEvent } from './events'
import { button, el, heading, note, select } from './fields'

const SCOPE_OPTIONS = [
  { value: 'project', label: 'This project' },
  { value: 'user', label: 'You, everywhere' },
]

function targetLabel(target: BundleTarget): string {
  if (target.kind === 'any') return 'Any project'
  return target.kind === 'language' ? `Language: ${target.name}` : `Framework: ${target.name}`
}

const key = (source: string, name: string): string => `${source}/${name}`

/**
 * What fits this workspace, offered once; what is applied, to remove; what the
 * catalog holds, to apply at any time. A bundle's rule text is shown before
 * it is ever applied, never written until "Apply" is pressed.
 */
export class BundlesTab extends HTMLElement {
  private snapshot: SettingsSnapshot['bundles'] = { available: [], applied: [], suggested: [], offerPending: false }
  private readonly expanded = new Set<string>()
  private readonly scopeChoice = new Map<string, BundleScope>()

  update(snapshot: SettingsSnapshot): void {
    this.snapshot = snapshot.bundles
    this.render()
  }

  private render(): void {
    const { available, applied, suggested, offerPending } = this.snapshot
    this.replaceChildren(
      heading('Bundles', 'Shared rule text and skills, applied or offered'),
      note(
        'A bundle is a named, versioned set of rule text, skills, or both, applied as one marked block into AGENTS.md and a folder per skill. Its rule text and its skills are shown here before it is applied, and nothing is written to a file until you accept it.',
      ),
      ...(offerPending ? [this.offer(suggested)] : []),
      this.group('Applied', applied.length > 0 ? applied.map((a) => this.appliedRow(a)) : [note('Nothing applied yet.')]),
      this.group('Available', available.length > 0 ? available.map((b) => this.availableRow(b, applied)) : [note('No bundles in the catalog yet.')]),
    )
  }

  private offer(suggested: Bundle[]): HTMLElement {
    const box = el('section', 'bundle-offer')
    box.append(el('h3', '', 'Bundles that fit this workspace'))
    const names = suggested.map((b) => b.name).join(', ')
    box.append(note(`What this workspace holds matches ${suggested.length} bundle${suggested.length === 1 ? '' : 's'}: ${names}. Apply one below, or dismiss this.`))
    box.append(button('Dismiss', () => this.dispatchEvent(new BundleOfferDismissedEvent())))
    return box
  }

  private group(title: string, rows: HTMLElement[]): HTMLElement {
    const section = el('section', title.toLowerCase())
    section.append(el('h3', '', title))
    section.append(...rows)
    return section
  }

  private appliedRow(applied: AppliedBundle): HTMLElement {
    const row = el('article', 'bundle')
    const text = el('div', 'text')
    text.append(
      el('strong', 'title', applied.name),
      el('span', 'summary', `${applied.source} \u00b7 v${applied.version} \u00b7 ${applied.scope === 'project' ? 'this project' : 'you, everywhere'}`),
    )
    const controls = el('div', 'controls')
    controls.append(button('Remove', () => this.dispatchEvent(new BundleRemovedEvent(applied.scope, applied.source, applied.name)), 'remove'))
    row.append(text, controls)
    return row
  }

  private availableRow(bundle: Bundle, applied: AppliedBundle[]): HTMLElement {
    const id = key(bundle.source, bundle.name)
    const already = applied.find((a) => a.source === bundle.source && a.name === bundle.name)
    const row = el('article', 'bundle')
    const text = el('div', 'text')
    text.append(el('strong', 'title', bundle.name), el('span', 'summary', `${bundle.source} \u00b7 v${bundle.version} \u00b7 ${targetLabel(bundle.target)}`))
    row.append(text)
    const hasText = bundle.text.trim() !== ''
    const skills = bundle.skills ?? []
    if (this.expanded.has(id)) {
      if (hasText) row.append(el('pre', 'bundle-text', bundle.text))
      if (skills.length > 0) row.append(this.skillsList(skills))
    }
    const controls = el('div', 'controls')
    const shown = hasText && skills.length > 0 ? 'details' : skills.length > 0 ? 'skills' : 'rules'
    controls.append(button(this.expanded.has(id) ? `Hide ${shown}` : `Show ${shown}`, () => this.toggle(id)))
    const scope = select('scope', SCOPE_OPTIONS, this.scopeChoice.get(id) ?? 'project')
    scope.addEventListener('change', () => this.scopeChoice.set(id, scope.value as BundleScope))
    controls.append(scope)
    controls.append(button(already ? 'Re-apply' : 'Apply', () => this.dispatchEvent(new BundleAppliedEvent(this.scopeChoice.get(id) ?? 'project', bundle))))
    row.append(controls)
    return row
  }

  /** The name and description of every skill a bundle would add, shown before it is applied. */
  private skillsList(skills: BundleSkill[]): HTMLElement {
    const list = el('ul', 'bundle-skills')
    for (const skill of skills) {
      const item = el('li', 'bundle-skill')
      item.append(el('strong', '', skill.name), el('span', '', `: ${skill.description}`))
      list.append(item)
    }
    return list
  }

  private toggle(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id)
    else this.expanded.add(id)
    this.render()
  }
}

customElements.define('bundles-tab', BundlesTab)
