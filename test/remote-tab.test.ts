// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PairedPhone } from '../src/remote-control/pairing'
import type { SettingsSnapshot } from '../src/settings/protocol'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { RemoteTab } = await import('../src/settings/webview/remote-tab')
const events = await import('../src/settings/webview/events')

function snapshot(remoteControl: SettingsSnapshot['remoteControl'], hasWorkspace = true): SettingsSnapshot {
  return {
    providers: [],
    profiles: [],
    activeProfile: '',
    keys: [],
    permissions: { allow: [], deny: [], denyGitWrites: false, person: { allow: [], deny: [] } },
    verify: [],
    verifyFailureBudget: 3,
    cleanup: { functionLines: 60, functionComplexity: 15, typeLines: 200, fileLines: 400, tests: [], testFunctionLines: 120, testFunctionComplexity: 15, testTypeLines: 600, testFileLines: 1200, ignore: [] },
    planIgnore: [],
    cutCoveredDocs: false,
    memories: { project: [], user: [] },
    bundles: { available: [], applied: [], suggested: [], offerPending: false },
    nodePath: '',
    traceEngine: false,
    compactAtTokens: 400_000,
    hasWorkspace,
    remoteControl,
  }
}

function tab(remoteControl: SettingsSnapshot['remoteControl'], hasWorkspace = true) {
  const node = new RemoteTab()
  document.body.appendChild(node)
  node.update(snapshot(remoteControl, hasWorkspace))
  return node
}

describe('pairing code', () => {
  it('pair_a_phone_asks_the_host_for_a_fresh_code', () => {
    const node = tab({ enabled: true, serviceUrl: 'wss://remote.kiwipow.com', pushByDefault: true, phones: [] })
    let requested = false
    node.addEventListener(events.PairingCodeRequestedEvent.type, () => (requested = true))
    ;[...node.querySelectorAll('button')].find((b) => b.textContent === 'Pair a phone')!.click()
    expect(requested).toBe(true)
    node.remove()
  })

  it('the_code_the_host_produced_is_shown_as_text_and_as_a_qr_code_carrying_it', () => {
    const node = tab({ enabled: true, serviceUrl: 'wss://remote.kiwipow.com', pushByDefault: true, phones: [] })
    node.showPairingCode({ code: '123456', qrDataUrl: 'data:image/png;base64,abc', expiresAt: 0 })
    expect(node.querySelector('.pairing-code .code')!.textContent).toBe('123456')
    expect(node.querySelector<HTMLImageElement>('.pairing-code img.qr')!.src).toContain('data:image/png;base64,abc')
    node.remove()
  })
})

describe('default by where it started', () => {
  it('the_workspace_standing_default_is_shown_and_a_change_is_saved', () => {
    const node = tab({ enabled: true, serviceUrl: 'wss://remote.kiwipow.com', pushByDefault: true, phones: [] })
    const box = node.querySelector<HTMLInputElement>('input[name="remoteControl.pushByDefault"]')!
    expect(box.checked).toBe(true)
    let saved: { key: string; value: unknown } | undefined
    node.addEventListener(events.SettingSavedEvent.type, (e) => (saved = { key: e.key, value: e.value }))
    box.checked = false
    box.dispatchEvent(new Event('change', { bubbles: true }))
    expect(saved).toEqual({ key: 'remoteControl.pushByDefault', value: false })
    node.remove()
  })
})

describe('unpairing from the agent', () => {
  const phones: PairedPhone[] = [{ id: 'phone-1', name: "Jonas' Phone", lastConnectedAt: Date.parse('2026-01-01T00:00:00Z') }]

  it('every_paired_phone_is_listed_by_the_name_it_gave_and_when_it_last_connected', () => {
    const node = tab({ enabled: true, serviceUrl: 'wss://remote.kiwipow.com', pushByDefault: true, phones })
    const row = node.querySelector('.phones .phone')!
    expect(row.textContent).toContain("Jonas' Phone")
    expect(row.textContent).toContain('2026')
    node.remove()
  })

  it('unpair_on_a_phones_row_asks_the_host_to_drop_that_phone', () => {
    const node = tab({ enabled: true, serviceUrl: 'wss://remote.kiwipow.com', pushByDefault: true, phones })
    let unpaired: string | undefined
    node.addEventListener(events.PhoneUnpairedEvent.type, (e) => (unpaired = e.id))
    ;[...node.querySelectorAll('button')].find((b) => b.textContent === 'Unpair')!.click()
    expect(unpaired).toBe('phone-1')
    node.remove()
  })
})
