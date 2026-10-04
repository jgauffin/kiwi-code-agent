import { randomInt } from 'node:crypto'

/** A phone the agent has come to know; pairing is the whole of that identity, nothing more is kept about it. */
export type PairedPhone = { id: string; name: string; lastConnectedAt: number }

export type PendingCode = { code: string; expiresAt: number }

export type ClockPort = { now(): number }

export const systemClock: ClockPort = { now: () => Date.now() }

/** Where this workspace's paired phones live between restarts; one list per workspace, never shared with another. */
export type PairingStore = {
  load(): PairedPhone[]
  save(phones: PairedPhone[]): void | Promise<void>
}

/** A pairing code nobody presents within this long is as if it never existed. */
export const CODE_TTL_MS = 10 * 60 * 1000

function randomCode(): string {
  // Six digits: short enough to type by hand, and carried whole by the QR code shown beside it.
  return Array.from({ length: 6 }, () => randomInt(10)).join('')
}

/**
 * How a phone and this workspace's agent come to know each other: no
 * account, no sign-in, just a code presented once and the list of phones
 * that came from doing so.
 */
export class PairingManager {
  private pending: PendingCode | undefined
  private phones: PairedPhone[]

  constructor(
    private readonly store: PairingStore,
    private readonly clock: ClockPort = systemClock,
    private readonly makeCode: () => string = randomCode,
  ) {
    this.phones = store.load()
  }

  /** A fresh code replaces whatever was pending; the one it replaces can never be presented again. */
  requestCode(): PendingCode {
    this.pending = { code: this.makeCode(), expiresAt: this.clock.now() + CODE_TTL_MS }
    return this.pending
  }

  /** Spends the pending code for one phone. A wrong guess is refused without spending the real code; an expired or already-spent one is refused too. */
  pair(code: string, phone: { id: string; name: string }): PairedPhone {
    const pending = this.pending
    if (!pending || pending.code !== code) throw new Error('That pairing code is not valid.')
    if (this.clock.now() >= pending.expiresAt) {
      this.pending = undefined
      throw new Error('That pairing code has expired.')
    }
    this.pending = undefined // spent: this phone used it, so no other phone can
    const paired: PairedPhone = { id: phone.id, name: phone.name, lastConnectedAt: this.clock.now() }
    this.phones = [...this.phones.filter((p) => p.id !== phone.id), paired]
    this.persist()
    return paired
  }

  /** Every phone paired with this workspace, by the name it gave and when it last connected. */
  list(): PairedPhone[] {
    return this.phones
  }

  isPaired(phoneId: string): boolean {
    return this.phones.some((p) => p.id === phoneId)
  }

  touch(phoneId: string): void {
    const phone = this.phones.find((p) => p.id === phoneId)
    if (!phone) return
    phone.lastConnectedAt = this.clock.now()
    this.persist()
  }

  /** Removes the phone from the agent's own list; nothing further is sent its way after this. */
  unpair(phoneId: string): void {
    this.phones = this.phones.filter((p) => p.id !== phoneId)
    this.persist()
  }

  private persist(): void {
    void this.store.save(this.phones)
  }
}
