import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionMode } from './session-manager'

export type Hand = { sessionId: string; mode: SessionMode; feature?: string }

/** What a session last wrote to a path: the mtime it left, and the content, when the write recorded one. */
export type Snapshot = { mtimeMs: number; text: string }

type Registry = { id: string; mode: SessionMode; feature?: string; files: Record<string, number>; texts?: Record<string, string> }

/** Where each session's own writes land, on disk so another session — another process, another window — can look them up: nothing here assumes they share memory. */
const dirFor = (workspaceRoot: string): string => join(workspaceRoot, '.agent', 'sessions')

/**
 * Attributes a file's content to the KiwiAgent session that last wrote it, so
 * a stale-write refusal can name who: this session's own writes go in here,
 * another session's are read back off disk. A thin attribution log, not the
 * fuller claim registry (deadlines, heartbeats, denying a live session's
 * hold) `docs/features/coordination.md#Claims` describes — nothing this
 * feature's rules ask for yet needs those.
 */
export class FileHands {
  constructor(
    private readonly workspaceRoot: string,
    private readonly sessionId: string,
    private readonly mode: SessionMode,
    private readonly feature: string | undefined,
  ) {}

  /** Records that this session's own write left `path` at `mtimeMs`. */
  async recordWrite(path: string, mtimeMs: number): Promise<void> {
    const dir = dirFor(this.workspaceRoot)
    const file = join(dir, `${this.sessionId}.json`)
    const registry: Registry = (await readRegistry(file)) ?? {
      id: this.sessionId,
      mode: this.mode,
      ...(this.feature !== undefined ? { feature: this.feature } : {}),
      files: {},
    }
    registry.files[path] = mtimeMs
    await mkdir(dir, { recursive: true })
    await writeFile(file, JSON.stringify(registry), 'utf8').catch(() => undefined)
  }

  /** The other KiwiAgent session whose own write left `path` at exactly `mtimeMs`, if one did. */
  async whoWrote(path: string, mtimeMs: number): Promise<Hand | undefined> {
    return this.find(path, mtimeMs, `${this.sessionId}.json`)
  }

  /** The KiwiAgent session whose own write left `path` at exactly `mtimeMs`, this session's own included, if one did. */
  async handFor(path: string, mtimeMs: number): Promise<Hand | undefined> {
    return this.find(path, mtimeMs)
  }

  private async find(path: string, mtimeMs: number, skip?: string): Promise<Hand | undefined> {
    let names: string[]
    try {
      names = await readdir(dirFor(this.workspaceRoot))
    } catch {
      return undefined
    }
    for (const name of names) {
      if (name === skip) continue
      const registry = await readRegistry(join(dirFor(this.workspaceRoot), name))
      if (registry && registry.files[path] === mtimeMs) {
        return { sessionId: registry.id, mode: registry.mode, ...(registry.feature !== undefined ? { feature: registry.feature } : {}) }
      }
    }
    return undefined
  }
}

async function readRegistry(file: string): Promise<Registry | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Registry
  } catch {
    return undefined
  }
}

/**
 * What a refusal or notice says about where a change came from: the other
 * KiwiAgent session and the feature it works on when the registry names one,
 * outside KiwiAgent otherwise — never which tool made the change.
 */
export function describeHand(hand: Hand | undefined): string {
  if (!hand) return 'It was changed from outside KiwiAgent.'
  const who = hand.feature ? `a KiwiAgent ${hand.mode} session on "${hand.feature}"` : `a KiwiAgent ${hand.mode} session`
  return `It was changed by ${who}.`
}
