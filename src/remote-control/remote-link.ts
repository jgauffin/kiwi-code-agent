/** Where the forwarding service lives until a workspace says otherwise. */
export const DEFAULT_SERVICE_URL = 'wss://remote.kiwipow.com'

/** What travels over the link to the forwarding service, in either direction. */
export type RemoteMessage = { type: string } & Record<string, unknown>

/** A socket narrow enough to fake in tests, and what the platform's own WebSocket already satisfies. */
export type SocketLike = {
  send(data: string): void
  close(): void
  addEventListener(type: 'open' | 'message' | 'close' | 'error', handler: (event: { data?: unknown }) => void): void
}

export type SocketFactory = (url: string) => SocketLike

/**
 * The one link between this workspace's agent and the forwarding service.
 * The agent always opens it; it never accepts one, so the dev computer
 * needs no inbound port or address of its own.
 */
export interface RemoteLink {
  readonly connected: boolean
  connect(): void
  disconnect(): void
  /** Fire-and-forget: a message the link cannot deliver right now is dropped, never queued for later. */
  send(message: RemoteMessage): boolean
  onMessage(handler: (message: RemoteMessage) => void): void
}

/** Connects out to the forwarding service over a WebSocket; closing or losing it never leaves anything buffered to resend. */
export class WebSocketRemoteLink implements RemoteLink {
  private socket: SocketLike | undefined
  private open = false
  private readonly handlers: ((message: RemoteMessage) => void)[] = []

  constructor(
    private readonly url: () => string,
    private readonly openSocket: SocketFactory = (address) => new WebSocket(address) as unknown as SocketLike,
  ) {}

  get connected(): boolean {
    return this.open
  }

  connect(): void {
    if (this.socket) return
    const socket = this.openSocket(this.url())
    socket.addEventListener('open', () => {
      if (this.socket === socket) this.open = true
    })
    socket.addEventListener('message', (event) => this.receive(event.data))
    socket.addEventListener('close', () => this.forget(socket))
    socket.addEventListener('error', () => this.forget(socket))
    this.socket = socket
  }

  disconnect(): void {
    this.socket?.close()
    this.socket = undefined
    this.open = false
  }

  send(message: RemoteMessage): boolean {
    if (!this.open || !this.socket) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  onMessage(handler: (message: RemoteMessage) => void): void {
    this.handlers.push(handler)
  }

  private forget(socket: SocketLike): void {
    if (this.socket !== socket) return
    this.socket = undefined
    this.open = false
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') return
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    if (!isRemoteMessage(parsed)) return
    for (const handler of this.handlers) handler(parsed)
  }
}

function isRemoteMessage(value: unknown): value is RemoteMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}
