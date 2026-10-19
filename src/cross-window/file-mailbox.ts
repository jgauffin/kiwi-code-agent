import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Envelope, MessageTransport } from './agent-exchange'

/** Beside the links file, so every window of this user on this machine reaches the same folders, and no other machine's. */
export const defaultMailRoot = (): string => path.join(os.homedir(), '.kiwipow', 'window-mail')

/**
 * One folder per workspace, holding an envelope per file until that
 * workspace's window takes it. The sender writes, the receiver reads and
 * deletes, so no file is ever written by two windows.
 */
export class FileMailbox implements MessageTransport {
  private sent = 0

  constructor(private readonly root: string = defaultMailRoot()) {}

  post(envelope: Envelope): void {
    const dir = path.join(this.root, envelope.to.workspaceId)
    fs.mkdirSync(dir, { recursive: true })
    // Named by when it was sent, so the receiver reads them in order; written beside and renamed so it is never taken half written.
    const name = `${String(Date.now()).padStart(15, '0')}-${process.pid}-${String(this.sent++).padStart(6, '0')}`
    const temp = path.join(dir, `${name}.tmp`)
    fs.writeFileSync(temp, JSON.stringify(envelope))
    fs.renameSync(temp, path.join(dir, `${name}.json`))
  }

  /** Every envelope waiting for the workspace, oldest first, each handed out once. */
  take(workspaceId: string): Envelope[] {
    const dir = path.join(this.root, workspaceId)
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const envelopes: Envelope[] = []
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      const file = path.join(dir, name)
      const text = fs.readFileSync(file, 'utf8')
      fs.unlinkSync(file)
      envelopes.push(JSON.parse(text) as Envelope)
    }
    return envelopes
  }
}
