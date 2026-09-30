import type { FromWebview, ToWebview } from '../protocol'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; setState(state: unknown): void }

// One handle per page: VS Code refuses a second acquire, so every app in the bundle goes through here.
const api = acquireVsCodeApi()

export function postToHost(message: unknown): void {
  api.postMessage(message)
}

/** What VS Code hands back when it resolves the view again after a reload: the session it showed. */
export function rememberTab(tabId: string | undefined): void {
  api.setState({ tabId })
}

export function onHostMessage<M>(handler: (message: M) => void): void {
  window.addEventListener('message', (e: MessageEvent<M>) => handler(e.data))
}

export function post(message: FromWebview): void {
  postToHost(message)
}

export function onMessage(handler: (message: ToWebview) => void): void {
  onHostMessage(handler)
}
