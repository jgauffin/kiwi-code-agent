import { describe, expect, it } from 'vitest'
import { PairingManager, type ClockPort, type PairedPhone, type PairingStore } from '../src/remote-control/pairing'

function fakeClock(start = 0): ClockPort & { advance: (ms: number) => void } {
  let now = start
  return { now: () => now, advance: (ms) => (now += ms) }
}

function fakeStore(initial: PairedPhone[] = []): PairingStore & { saved: PairedPhone[][] } {
  const saved: PairedPhone[][] = []
  return {
    load: () => initial,
    save: (phones) => void saved.push(phones),
    saved,
  }
}

function manager(options: { store?: PairingStore; clock?: ClockPort; codes?: string[] } = {}) {
  let next = 0
  const codes = options.codes ?? ['111111', '222222', '333333']
  return new PairingManager(options.store ?? fakeStore(), options.clock, () => codes[next++] ?? `code-${next}`)
}

describe('pairing code', () => {
  it('a_phone_pairs_by_presenting_the_code_the_agent_produced', () => {
    const m = manager()
    const pending = m.requestCode()
    const phone = m.pair(pending.code, { id: 'phone-1', name: 'Jonas’ Phone' })
    expect(phone.id).toBe('phone-1')
    expect(m.list()).toEqual([phone])
  })

  it('a_wrong_code_is_refused_and_the_pending_code_still_works', () => {
    const m = manager()
    const pending = m.requestCode()
    expect(() => m.pair('000000', { id: 'phone-1', name: 'Phone' })).toThrow(/not valid/)
    expect(() => m.pair(pending.code, { id: 'phone-1', name: 'Phone' })).not.toThrow()
  })
})

describe('code used once', () => {
  it('a_code_already_used_cannot_pair_a_second_phone', () => {
    const m = manager()
    const pending = m.requestCode()
    m.pair(pending.code, { id: 'phone-1', name: 'First' })
    expect(() => m.pair(pending.code, { id: 'phone-2', name: 'Second' })).toThrow(/not valid/)
    expect(m.list().map((p) => p.id)).toEqual(['phone-1'])
  })

  it('a_code_nobody_presents_expires_on_its_own', () => {
    const clock = fakeClock()
    const m = manager({ clock })
    const pending = m.requestCode()
    clock.advance(11 * 60 * 1000)
    expect(() => m.pair(pending.code, { id: 'phone-1', name: 'Late' })).toThrow(/expired/)
    expect(m.list()).toEqual([])
  })

  it('requesting_a_fresh_code_spends_the_one_it_replaces', () => {
    const m = manager()
    const first = m.requestCode()
    m.requestCode()
    expect(() => m.pair(first.code, { id: 'phone-1', name: 'Phone' })).toThrow(/not valid/)
  })
})

describe('pairing is the only identity', () => {
  it('a_paired_phone_carries_nothing_but_its_name_and_id_and_when_it_last_connected', () => {
    const m = manager()
    const pending = m.requestCode()
    const phone = m.pair(pending.code, { id: 'phone-1', name: 'Jonas’ Phone' })
    expect(Object.keys(phone).sort()).toEqual(['id', 'lastConnectedAt', 'name'])
  })
})

describe('one pairing per workspace', () => {
  it('two_workspaces_pairing_stores_never_share_a_phone', () => {
    const a = manager({ store: fakeStore() })
    const b = manager({ store: fakeStore() })
    const pending = a.requestCode()
    a.pair(pending.code, { id: 'phone-1', name: 'Phone' })
    expect(a.list()).toHaveLength(1)
    expect(b.list()).toHaveLength(0)
  })
})

describe('unpairing from the agent', () => {
  it('every_paired_phone_is_listed_by_its_name_and_when_it_last_connected', () => {
    const clock = fakeClock(1000)
    const m = manager({ clock })
    const pending = m.requestCode()
    m.pair(pending.code, { id: 'phone-1', name: 'Jonas’ Phone' })
    expect(m.list()).toEqual([{ id: 'phone-1', name: 'Jonas’ Phone', lastConnectedAt: 1000 }])
  })

  it('touching_a_phone_updates_when_it_last_connected', () => {
    const clock = fakeClock(1000)
    const m = manager({ clock })
    const pending = m.requestCode()
    m.pair(pending.code, { id: 'phone-1', name: 'Phone' })
    clock.advance(5000)
    m.touch('phone-1')
    expect(m.list()[0]!.lastConnectedAt).toBe(6000)
  })

  it('unpairing_removes_the_phone_from_the_agents_list', () => {
    const m = manager()
    const pending = m.requestCode()
    m.pair(pending.code, { id: 'phone-1', name: 'Phone' })
    m.unpair('phone-1')
    expect(m.list()).toEqual([])
    expect(m.isPaired('phone-1')).toBe(false)
  })
})
