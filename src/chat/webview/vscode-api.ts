import type { FromWebview, ToWebview } from '../protocol'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }

const api = acquireVsCodeApi()

export function post(message: FromWebview): void {
  api.postMessage(message)
}

export function onMessage(handler: (message: ToWebview) => void): void {
  window.addEventListener('message', (e: MessageEvent<ToWebview>) => handler(e.data))
}
