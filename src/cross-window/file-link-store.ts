import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { emptyLinkState, type LinkStore, type SharedLinkState } from './window-links'

/** The links file in the user's home folder: every window of this user on this machine reads the same one, and no other machine's. */
export const defaultLinksFile = (): string => path.join(os.homedir(), '.kiwipow', 'window-links.json')

export class FileLinkStore implements LinkStore {
  constructor(private readonly file: string = defaultLinksFile()) {}

  read(): SharedLinkState {
    let text: string
    try {
      text = fs.readFileSync(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLinkState()
      throw error
    }
    const parsed = JSON.parse(text) as Partial<SharedLinkState>
    return { codes: parsed.codes ?? [], links: parsed.links ?? [], presence: parsed.presence ?? {} }
  }

  write(state: SharedLinkState): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    // Written beside and renamed over, so a window reading at that moment never sees half a file.
    const temp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(state))
    fs.renameSync(temp, this.file)
  }
}
