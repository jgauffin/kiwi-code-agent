import { stat } from 'node:fs/promises'

/**
 * Remembers what the model has read and when, so an edit is refused on a
 * file the model never saw or that changed underneath it (the user edits in
 * the IDE while the agent runs).
 */
export class ReadTracker {
  private readonly readAt = new Map<string, number>()

  async markRead(path: string): Promise<void> {
    this.readAt.set(path, (await stat(path)).mtimeMs)
  }

  /** Returns a reason the edit must not proceed, or undefined when it may. */
  async staleness(path: string): Promise<string | undefined> {
    const seen = this.readAt.get(path)
    if (seen === undefined) return `File has not been read in this session: ${path}. Read it before editing.`
    const current = (await stat(path)).mtimeMs
    if (current !== seen) return `File changed on disk since it was read: ${path}. Read it again before editing.`
    return undefined
  }

  forget(path: string): void {
    this.readAt.delete(path)
  }
}
