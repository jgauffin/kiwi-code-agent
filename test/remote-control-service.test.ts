import { describe, expect, it } from 'vitest'
import { RemoteControlService } from '../src/remote-control/remote-control-service'
import type { PairedPhone, PairingStore } from '../src/remote-control/pairing'
import type { RemoteLink, RemoteMessage } from '../src/remote-control/remote-link'
import type { WorkspaceSnapshot } from '../src/remote-control/following'
import type { SessionAlert } from '../src/remote-control/alerts'

/** Records every call rather than opening anything, and only "delivers" a message when told to: nothing is ever queued by the fake itself. */
function fakeLink(): RemoteLink & { emit: (message: RemoteMessage) => void; sent: RemoteMessage[]; connectCalls: number; connectedValue: boolean } {
  let handler: ((message: RemoteMessage) => void) | undefined
  const sent: RemoteMessage[] = []
  let connectCalls = 0
  const self = {
    connectedValue: false,
    get connected() {
      return self.connectedValue
    },
    connect: () => {
      connectCalls++
      self.connectedValue = true
    },
    disconnect: () => {
      self.connectedValue = false
    },
    send: (message: RemoteMessage) => {
      if (!self.connectedValue) return false
      sent.push(message)
      return true
    },
    onMessage: (h: (message: RemoteMessage) => void) => {
      handler = h
    },
    emit: (message: RemoteMessage) => handler?.(message),
    sent,
    get connectCalls() {
      return connectCalls
    },
  }
  return self
}

function fakeStore(): PairingStore {
  let phones: PairedPhone[] = []
  return {
    load: () => phones,
    save: (next) => void (phones = next),
  }
}

function service(link = fakeLink()) {
  const logged: string[] = []
  const qr = async (text: string) => `data:image/png;base64,${text}`
  const svc = new RemoteControlService(link, fakeStore(), qr, (line) => logged.push(line))
  return { svc, link, logged, qr }
}

describe('pairing code', () => {
  it('shows_the_code_as_text_and_as_a_qr_code_carrying_it', async () => {
    const { svc } = service()
    const pairing = await svc.requestPairingCode()
    expect(pairing.code).toMatch(/^\d{6}$/)
    expect(pairing.qrDataUrl).toBe(`data:image/png;base64,${pairing.code}`)
  })

  it('a_phone_presenting_the_code_over_the_link_becomes_paired', async () => {
    const { svc, link } = service()
    const pairing = await svc.requestPairingCode()
    link.emit({ type: 'paired', code: pairing.code, phone: { id: 'phone-1', name: 'Jonas’ Phone' } })
    expect(svc.phones().map((p) => p.id)).toEqual(['phone-1'])
  })
})

describe('agent reaches out', () => {
  it('connecting_only_ever_opens_the_link_outward_rather_than_accepting_one', () => {
    const { svc, link } = service()
    svc.connect()
    expect(link.connectCalls).toBe(1)
    expect(link.connected).toBe(true)
  })
})

describe('unpairing from the agent', () => {
  it('unpairing_drops_the_phone_from_the_list_and_tells_the_service', async () => {
    const { svc, link } = service()
    link.connect()
    const pairing = await svc.requestPairingCode()
    link.emit({ type: 'paired', code: pairing.code, phone: { id: 'phone-1', name: 'Phone' } })
    svc.unpair('phone-1')
    expect(svc.phones()).toEqual([])
    expect(link.sent.at(-1)).toEqual({ type: 'unpair', phoneId: 'phone-1' })
  })
})

describe('revoking from another phone', () => {
  it('a_phone_revoked_notice_from_the_service_drops_it_from_the_agents_list_too', async () => {
    const { svc, link } = service()
    const pairing = await svc.requestPairingCode()
    link.emit({ type: 'paired', code: pairing.code, phone: { id: 'phone-1', name: 'Phone' } })
    link.emit({ type: 'phone_revoked', phoneId: 'phone-1' })
    expect(svc.phones()).toEqual([])
  })
})

describe('nothing kept after delivery', () => {
  it('a_message_the_link_cannot_deliver_right_now_is_dropped_rather_than_queued', async () => {
    const { svc, link } = service()
    // The link is not connected: register_code cannot go out, and nothing holds onto it for later.
    await svc.requestPairingCode()
    expect(link.sent).toEqual([])
    link.connect()
    // Connecting later never replays what was dropped.
    expect(link.sent).toEqual([])
  })

  it('a_pairing_code_the_service_already_matched_to_a_replaced_code_is_logged_and_not_kept_waiting', async () => {
    const { svc, link, logged } = service()
    const first = await svc.requestPairingCode()
    await svc.requestPairingCode() // replaces the pending code
    link.emit({ type: 'paired', code: first.code, phone: { id: 'phone-1', name: 'Phone' } })
    expect(svc.phones()).toEqual([])
    expect(logged.some((line) => line.includes('not valid'))).toBe(true)
  })
})

describe('nothing to do while unreachable', () => {
  const snapshot: WorkspaceSnapshot = { features: [], sessionsAtWork: [], sessionsStopped: [] }

  it('reporting_the_three_lists_while_the_link_is_down_reaches_nobody_and_is_not_queued_for_when_it_reconnects', () => {
    const { svc, link } = service()
    svc.reportSnapshot(snapshot)
    expect(link.sent).toEqual([])
    link.connect()
    expect(link.sent).toEqual([])
  })

  it('reports_the_three_lists_once_the_link_is_up', () => {
    const { svc, link } = service()
    link.connect()
    svc.reportSnapshot(snapshot)
    expect(link.sent).toEqual([{ type: 'report_snapshot', snapshot }])
  })

  it('reports_a_sessions_view_once_the_link_is_up', () => {
    const { svc, link } = service()
    link.connect()
    const view = { sessionId: 'plan', entries: [] }
    svc.reportSessionView(view)
    expect(link.sent).toEqual([{ type: 'report_session_view', view }])
  })
})

describe('anything that blocks completion pushes', () => {
  const alert: SessionAlert = { sessionId: 's1', title: 'Orders', body: 'Which approach?', buttons: [{ label: 'A', value: 'A' }], opensApp: false }

  it('a_message_the_link_cannot_deliver_right_now_is_dropped_rather_than_queued', () => {
    const { svc, link } = service()
    svc.pushAlert(alert)
    expect(link.sent).toEqual([])
    link.connect()
    expect(link.sent).toEqual([])
  })

  it('pushes_the_alert_once_the_link_is_up', () => {
    const { svc, link } = service()
    link.connect()
    svc.pushAlert(alert)
    expect(link.sent).toEqual([{ type: 'push_alert', alert }])
  })
})

describe('alert withdrawn once answered', () => {
  it('withdraws_the_alert_once_the_link_is_up', () => {
    const { svc, link } = service()
    link.connect()
    svc.withdrawAlert('s1')
    expect(link.sent).toEqual([{ type: 'withdraw_alert', sessionId: 's1' }])
  })
})

describe('acting from the phone', () => {
  it('a_command_the_phone_sent_reaches_every_handler_registered_for_it', () => {
    const { svc, link } = service()
    const seen: unknown[] = []
    svc.onCommand((command) => seen.push(command))
    link.emit({ type: 'send_prompt', sessionId: 's1', text: 'keep going' })
    expect(seen).toEqual([{ type: 'send_prompt', sessionId: 's1', text: 'keep going' }])
  })

  it('a_message_that_is_not_a_command_the_phone_may_send_reaches_no_handler', () => {
    const { svc, link } = service()
    const seen: unknown[] = []
    svc.onCommand((command) => seen.push(command))
    link.emit({ type: 'add_comment', target: 'plan', text: 'hmm' })
    expect(seen).toEqual([])
  })
})
