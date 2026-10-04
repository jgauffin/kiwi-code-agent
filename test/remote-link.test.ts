import { describe, expect, it } from 'vitest'
import { WebSocketRemoteLink, type SocketLike } from '../src/remote-control/remote-link'

/** A socket that never accepts a connection, only ever opened by the code under test calling out to it. */
function fakeSocket() {
  const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {}
  const sent: string[] = []
  const socket: SocketLike = {
    send: (data) => sent.push(data),
    close: () => listeners.close?.forEach((h) => h({})),
    addEventListener: (type, handler) => {
      ;(listeners[type] ??= []).push(handler)
    },
  }
  return {
    socket,
    sent,
    open: () => listeners.open?.forEach((h) => h({})),
    message: (data: unknown) => listeners.message?.forEach((h) => h({ data })),
  }
}

describe('agent reaches out', () => {
  it('connecting_opens_the_socket_toward_the_configured_address_rather_than_accepting_one', () => {
    const fake = fakeSocket()
    const urls: string[] = []
    const link = new WebSocketRemoteLink(
      () => 'wss://remote.kiwipow.com',
      (url) => {
        urls.push(url)
        return fake.socket
      },
    )
    link.connect()
    expect(urls).toEqual(['wss://remote.kiwipow.com'])
    expect(link.connected).toBe(false) // not yet open
    fake.open()
    expect(link.connected).toBe(true)
  })
})

describe('nothing kept after delivery', () => {
  it('a_message_sent_before_the_socket_is_open_is_dropped_rather_than_buffered', () => {
    const fake = fakeSocket()
    const link = new WebSocketRemoteLink(() => 'wss://remote.kiwipow.com', () => fake.socket)
    link.connect()
    expect(link.send({ type: 'register_code', code: '123456' })).toBe(false)
    fake.open()
    expect(fake.sent).toEqual([]) // never replayed once it opens
  })

  it('a_message_sent_once_open_goes_straight_out_and_is_not_kept_anywhere', () => {
    const fake = fakeSocket()
    const link = new WebSocketRemoteLink(() => 'wss://remote.kiwipow.com', () => fake.socket)
    link.connect()
    fake.open()
    expect(link.send({ type: 'register_code', code: '123456' })).toBe(true)
    expect(fake.sent).toEqual([JSON.stringify({ type: 'register_code', code: '123456' })])
  })
})

describe('unpairing forgets the forward', () => {
  it('a_closed_socket_stops_delivery_until_the_agent_connects_out_again', () => {
    const fake = fakeSocket()
    const link = new WebSocketRemoteLink(() => 'wss://remote.kiwipow.com', () => fake.socket)
    link.connect()
    fake.open()
    link.disconnect()
    expect(link.connected).toBe(false)
    expect(link.send({ type: 'unpair', phoneId: 'phone-1' })).toBe(false)
  })
})

describe('incoming messages', () => {
  it('a_message_from_the_service_reaches_every_registered_handler', () => {
    const fake = fakeSocket()
    const link = new WebSocketRemoteLink(() => 'wss://remote.kiwipow.com', () => fake.socket)
    const received: unknown[] = []
    link.onMessage((message) => received.push(message))
    link.connect()
    fake.open()
    fake.message(JSON.stringify({ type: 'phone_connected', phoneId: 'phone-1' }))
    expect(received).toEqual([{ type: 'phone_connected', phoneId: 'phone-1' }])
  })

  it('malformed_data_from_the_service_is_ignored_rather_than_crashing_the_link', () => {
    const fake = fakeSocket()
    const link = new WebSocketRemoteLink(() => 'wss://remote.kiwipow.com', () => fake.socket)
    const received: unknown[] = []
    link.onMessage((message) => received.push(message))
    link.connect()
    fake.open()
    fake.message('not json')
    expect(received).toEqual([])
  })
})
