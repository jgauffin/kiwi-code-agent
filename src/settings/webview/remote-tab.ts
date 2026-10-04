import type { PairedPhone } from '../../remote-control/pairing'
import type { SettingsSnapshot } from '../protocol'
import { PairingCodeRequestedEvent, PhoneUnpairedEvent, SettingSavedEvent } from './events'
import { button, checkField, checkbox, el, field, heading, note, onChange, textInput } from './fields'

/** The pairing code the host just produced, waiting for a phone to present it. */
type PairingCode = { code: string; qrDataUrl: string; expiresAt: number }

/**
 * How a phone and this workspace's agent come to know each other: a code
 * produced on request, shown as text and as a QR carrying it, and the list
 * of phones a code has already paired. No account, no sign-in: this list is
 * the whole of what the agent knows a phone by.
 */
export class RemoteTab extends HTMLElement {
  private signature = ''
  private pairing: PairingCode | undefined

  update(snapshot: SettingsSnapshot): void {
    const signature = JSON.stringify([snapshot.remoteControl, snapshot.hasWorkspace])
    if (signature === this.signature) return
    this.signature = signature
    this.draw(snapshot)
  }

  /** The code just produced, on its way from `request_pairing_code`. */
  showPairingCode(pairing: PairingCode): void {
    this.pairing = pairing
    this.draw()
  }

  private draw(snapshot?: SettingsSnapshot): void {
    const current = snapshot ?? this.lastSnapshot
    this.lastSnapshot = current
    if (!current) return
    this.replaceChildren(
      heading('Remote control', 'This workspace'),
      note('Lets a paired phone see this workspace’s specs and sessions, and be alerted when one stops. No account: a phone becomes paired by presenting a code produced here, once.'),
      this.toggle(current),
      this.pairingSection(current),
      this.phones(current.remoteControl.phones, current.hasWorkspace),
    )
  }

  private lastSnapshot: SettingsSnapshot | undefined

  private toggle(snapshot: SettingsSnapshot): HTMLElement {
    const disabled = !snapshot.hasWorkspace
    const section = el('section', 'remote-control-toggle')
    const box = checkbox('remoteControl.enabled', snapshot.remoteControl.enabled, { disabled })
    onChange(box, () => this.dispatchEvent(new SettingSavedEvent('remoteControl.enabled', box.checked)))
    section.append(checkField('Enable remote control', box, 'Lets this workspace pair with a phone over the forwarding service.'))
    const url = textInput('remoteControl.serviceUrl', snapshot.remoteControl.serviceUrl, { disabled: disabled || !snapshot.remoteControl.enabled })
    onChange(url, () => this.dispatchEvent(new SettingSavedEvent('remoteControl.serviceUrl', url.value.trim())))
    section.append(field('Service address', url))
    const pushBox = checkbox('remoteControl.pushByDefault', snapshot.remoteControl.pushByDefault, { disabled: disabled || !snapshot.remoteControl.enabled })
    onChange(pushBox, () => this.dispatchEvent(new SettingSavedEvent('remoteControl.pushByDefault', pushBox.checked)))
    section.append(checkField('Push by default', pushBox, 'What a session started at the desk follows until the person sets it for that session; one started from the phone always may.'))
    return section
  }

  private pairingSection(snapshot: SettingsSnapshot): HTMLElement {
    const section = el('section', 'pairing')
    section.append(el('h3', '', 'Pair a phone'))
    if (!snapshot.remoteControl.enabled) {
      section.append(note('Turn remote control on to produce a pairing code.'))
      return section
    }
    section.append(button('Pair a phone', () => this.dispatchEvent(new PairingCodeRequestedEvent()), 'add'))
    if (this.pairing) {
      const shown = el('div', 'pairing-code')
      shown.append(el('span', 'code', this.pairing.code))
      const img = document.createElement('img')
      img.className = 'qr'
      img.src = this.pairing.qrDataUrl
      img.alt = 'QR code carrying the pairing code'
      shown.append(img)
      section.append(shown)
    }
    return section
  }

  private phones(phones: PairedPhone[], hasWorkspace: boolean): HTMLElement {
    const section = el('section', 'phones')
    section.append(el('h3', '', 'Paired phones'))
    if (!hasWorkspace) {
      section.append(note('Open a folder to pair a phone with it.'))
      return section
    }
    if (phones.length === 0) {
      section.append(note('No phone paired with this workspace yet.'))
      return section
    }
    for (const phone of phones) section.append(this.phoneRow(phone))
    return section
  }

  private phoneRow(phone: PairedPhone): HTMLElement {
    const row = el('article', 'phone')
    const text = el('div', 'text')
    text.append(el('strong', 'name', phone.name), el('span', 'last-connected', `Last connected ${new Date(phone.lastConnectedAt).toLocaleString()}`))
    row.append(text, button('Unpair', () => this.dispatchEvent(new PhoneUnpairedEvent(phone.id)), 'remove'))
    return row
  }
}

customElements.define('remote-tab', RemoteTab)
