import { relative } from 'node:path'

/** Lines seen or changed, 1-based and inclusive. */
export type LineRange = { from: number; to: number }

type Note = { read: LineRange[]; readWhole: boolean; edited: LineRange[]; written: boolean }

/** Files past this many drop off the ledger, oldest touch first; the newest are the ones still being worked on. */
export const LEDGER_LIMIT = 60

/**
 * Which files the session has looked at and changed, and where in them. It
 * outlives the messages that say so: compaction folds the reads away, and
 * without this the model would have to search the repo again to find what it
 * had already found. Re-rendered from here at every compaction rather than
 * carried in the summary, which the next summariser would paraphrase away.
 */
export class FileLedger {
  private readonly notes = new Map<string, Note>()

  read(path: string, offset?: number, limit?: number): void {
    const note = this.touch(path)
    if (offset === undefined && limit === undefined) {
      note.readWhole = true
      note.read = []
      return
    }
    const from = offset ?? 1
    if (!note.readWhole) note.read = merge([...note.read, { from, to: limit ? from + limit - 1 : Number.MAX_SAFE_INTEGER }])
  }

  edited(path: string, range: LineRange): void {
    const note = this.touch(path)
    note.edited = merge([...note.edited, range])
  }

  written(path: string): void {
    this.touch(path).written = true
  }

  forget(path: string): void {
    this.notes.delete(path)
  }

  /** The paths it knows, oldest touch first. */
  paths(): string[] {
    return [...this.notes.keys()]
  }

  /**
   * The ledger as the compacted conversation carries it. Empty when nothing
   * has been touched, so a session that has only talked adds no noise.
   */
  render(cwd: string, limit = LEDGER_LIMIT): string {
    const entries = [...this.notes.entries()].slice(-limit)
    if (entries.length === 0) return ''
    const dropped = this.notes.size - entries.length
    const lines = entries.map(([path, note]) => `- ${relative(cwd, path).replace(/\\/g, '/') || path}: ${describe(note)}`)
    if (dropped > 0) lines.push(`- (${dropped} file${dropped === 1 ? '' : 's'} touched earlier are not listed)`)
    return [
      'Files this session has already worked with. Their contents are no longer in the conversation:',
      'read them again before relying on what they say.',
      '',
      ...lines,
    ].join('\n')
  }

  private touch(path: string): Note {
    const existing = this.notes.get(path)
    // Re-inserted so the map's order is the order last touched: the oldest fall off first.
    if (existing) this.notes.delete(path)
    const note = existing ?? { read: [], readWhole: false, edited: [], written: false }
    this.notes.set(path, note)
    return note
  }
}

function describe(note: Note): string {
  const parts: string[] = []
  if (note.readWhole) parts.push('read in full')
  else if (note.read.length) parts.push(`read ${note.read.map(show).join(', ')}`)
  if (note.written) parts.push('written')
  if (note.edited.length) parts.push(`edited ${note.edited.map(show).join(', ')}`)
  return parts.join('; ') || 'seen'
}

const show = (r: LineRange): string => (r.to >= Number.MAX_SAFE_INTEGER ? `${r.from}-end` : r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)

/** Overlapping and touching ranges become one; a list of adjacent reads is not worth spelling out. */
function merge(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from)
  const out: LineRange[] = []
  for (const range of sorted) {
    const last = out[out.length - 1]
    if (last && range.from <= last.to + 1) last.to = Math.max(last.to, range.to)
    else out.push({ ...range })
  }
  return out
}
