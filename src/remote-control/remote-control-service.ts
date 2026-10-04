import { PairingManager, type ClockPort, type PairedPhone, type PairingStore } from './pairing'
import type { RemoteLink, RemoteMessage } from './remote-link'
import type { SessionView, WorkspaceSnapshot } from './following'
import type { SessionAlert } from './alerts'
import { parseRemoteCommand, type RemoteCommand } from './remote-commands'

/** Renders a pairing code as a QR image, returned as a data URL so the settings page needs nothing of its own to draw it. */
export type QrCodeRenderer = (text: string) => Promise<string>

export type PairingCode = { code: string; qrDataUrl: string; expiresAt: number }

/**
 * Ties the pairing records to the one link out to the forwarding service: a
 * code requested here is also told to the service, and a phone presenting it
 * reaches the agent as a message back over that same link. The service is
 * the one that durably forgets a phone's forward, including while this
 * agent is offline; what runs here only keeps its own list in step and never
 * stashes a message the link could not deliver.
 */
export class RemoteControlService {
  private readonly pairing: PairingManager
  private readonly commandHandlers: ((command: RemoteCommand) => void)[] = []

  constructor(
    private readonly link: RemoteLink,
    store: PairingStore,
    private readonly renderQr: QrCodeRenderer,
    private readonly log: (line: string) => void,
    clock?: ClockPort,
  ) {
    this.pairing = new PairingManager(store, clock)
    this.link.onMessage((message) => this.receive(message))
  }

  connect(): void {
    this.link.connect()
  }

  disconnect(): void {
    this.link.disconnect()
  }

  async requestPairingCode(): Promise<PairingCode> {
    const pending = this.pairing.requestCode()
    this.link.send({ type: 'register_code', code: pending.code, expiresAt: pending.expiresAt })
    return { code: pending.code, qrDataUrl: await this.renderQr(pending.code), expiresAt: pending.expiresAt }
  }

  /** Every phone paired with this workspace, by the name it gave and when it last connected. */
  phones(): PairedPhone[] {
    return this.pairing.list()
  }

  /** The agent's own list stops naming the phone; nothing further is sent its way. */
  unpair(phoneId: string): void {
    this.pairing.unpair(phoneId)
    this.link.send({ type: 'unpair', phoneId })
  }

  /**
   * The workspace's three lists, as they stand right now. Fire-and-forget like
   * every other message on this link: while the agent is not connected the
   * send goes nowhere, and nothing here queues it for when it is.
   */
  reportSnapshot(snapshot: WorkspaceSnapshot): void {
    this.link.send({ type: 'report_snapshot', snapshot })
  }

  /** A session's recent course, for the app to show once the person opens it from one of the three lists. */
  reportSessionView(view: SessionView): void {
    this.link.send({ type: 'report_session_view', view })
  }

  /** A session just stopped mid-turn on the person: pushed to the paired phones that may hear it, fire-and-forget like every other message on this link. */
  pushAlert(alert: SessionAlert): void {
    this.link.send({ type: 'push_alert', alert })
  }

  /** The alert is resolved or its session has ended: taken back everywhere rather than left offering buttons that do nothing. */
  withdrawAlert(sessionId: string): void {
    this.link.send({ type: 'withdraw_alert', sessionId })
  }

  /** A command a paired phone sent: answering a card, steering a session, settling a draft. */
  onCommand(handler: (command: RemoteCommand) => void): void {
    this.commandHandlers.push(handler)
  }

  private receive(message: RemoteMessage): void {
    switch (message.type) {
      case 'paired':
        this.completePairing(message)
        return
      case 'phone_connected':
        this.pairing.touch(String(message.phoneId))
        return
      case 'phone_revoked':
        // Another paired phone had this one's forward forgotten at the service; the agent's own list follows.
        this.pairing.unpair(String(message.phoneId))
        return
    }
    const command = parseRemoteCommand(message)
    if (command) for (const handler of this.commandHandlers) handler(command)
  }

  private completePairing(message: RemoteMessage): void {
    const phone = message.phone as { id: string; name: string } | undefined
    if (!phone) return
    try {
      this.pairing.pair(String(message.code), phone)
    } catch (error) {
      // A code the service already matched but this agent no longer recognises (replaced, expired): not kept, not retried.
      this.log(`remote control: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
