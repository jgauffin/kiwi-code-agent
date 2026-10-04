import * as vscode from 'vscode'
import { toDataURL } from 'qrcode'
import type { PairedPhone, PairingStore } from './pairing'
import { DEFAULT_SERVICE_URL, WebSocketRemoteLink } from './remote-link'
import { RemoteControlService } from './remote-control-service'
import type { RemoteAlertPort } from './alerts'
import type { RemoteControlPort } from '../settings/settings-store'

/**
 * How this workspace's agent and a phone come to know each other: the agent
 * always opens the link to the forwarding service, and the paired phones
 * live in this workspace's own storage, one list per workspace.
 */
export function createRemoteControl(context: vscode.ExtensionContext, output: vscode.OutputChannel): RemoteControlService {
  const store: PairingStore = {
    load: () => context.workspaceState.get<PairedPhone[]>('remoteControl.phones', []),
    save: (phones) => Promise.resolve(context.workspaceState.update('remoteControl.phones', phones)),
  }
  const link = new WebSocketRemoteLink(() => vscode.workspace.getConfiguration('kiwiAgent').get('remoteControl.serviceUrl', DEFAULT_SERVICE_URL))
  return new RemoteControlService(link, store, (text) => toDataURL(text), (line) => output.appendLine(`remote control: ${line}`))
}

export function remoteControlPort(remoteControl: RemoteControlService): RemoteControlPort {
  return {
    phones: () => remoteControl.phones(),
    requestPairingCode: () => remoteControl.requestPairingCode(),
    unpair: (phoneId) => remoteControl.unpair(phoneId),
  }
}

/** Pushes a session's alert, and takes it back, over the same link the rest of remote control uses. */
export function remoteAlertPort(remoteControl: RemoteControlService): RemoteAlertPort {
  return {
    send: (alert) => remoteControl.pushAlert(alert),
    withdraw: (sessionId) => remoteControl.withdrawAlert(sessionId),
  }
}

/** The workspace's standing default for whether a session started at the desk may push, until the person changes it. */
export function pushDefault(): boolean {
  return vscode.workspace.getConfiguration('kiwiAgent').get('remoteControl.pushByDefault', true)
}

/** Behind its own setting: off until a workspace turns it on, and reconnected whenever that setting or the service address changes. */
export function syncRemoteControlConnection(remoteControl: RemoteControlService): void {
  const enabled = vscode.workspace.getConfiguration('kiwiAgent').get('remoteControl.enabled', false)
  remoteControl.disconnect()
  if (enabled) remoteControl.connect()
}
