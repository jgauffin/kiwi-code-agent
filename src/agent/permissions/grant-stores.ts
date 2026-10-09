import { readFileSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readOptional } from '../workspace-files'
import { grantFromClaudeRule, grantFromOldRule, type RuleOrigin } from './grant-formats'
import { parseGrant, sameGrant, type Grant } from './grants'

/** Every entry of a stored list that reads as a grant; one that does not is left out rather than guessed at. */
export function readGrantList(value: unknown): Grant[] {
  return Array.isArray(value) ? value.map(parseGrant).filter((g): g is Grant => g !== undefined) : []
}

/** Answers kept before grants existed, as the grants they become; those that become none are dropped. */
export function oldRulesAsGrants(allow: readonly string[], deny: readonly string[], origin: RuleOrigin): Grant[] {
  const convert = (verdict: Grant['verdict']) => (rule: string) => grantFromOldRule(rule, verdict, origin)
  return [...allow.map(convert('allow')), ...deny.map(convert('deny'))].filter((g): g is Grant => g !== undefined)
}

/** Grants not already in `current`, appended to it. */
export function withGrants(current: readonly Grant[], added: readonly Grant[]): Grant[] {
  const merged = [...current]
  for (const grant of added) if (!merged.some((g) => sameGrant(g, grant))) merged.push(grant)
  return merged
}

/** Where the person's own answers are kept: granted once, honoured in every workspace. */
export function personGrantsFile(home: string = homedir()): string {
  return join(home, '.kiwi', 'permissions.json')
}

/** The person's answers, those kept in the old `allow` and `deny` lists among them. */
export async function readPersonGrants(home: string = homedir()): Promise<Grant[]> {
  const text = await readOptional(personGrantsFile(home))
  if (!text) return []
  let stored: { grants?: unknown; allow?: unknown; deny?: unknown }
  try {
    stored = JSON.parse(text) as typeof stored
  } catch (error) {
    throw new Error(`${personGrantsFile(home)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((r): r is string => typeof r === 'string') : [])
  const origin: RuleOrigin = { workspace: home, home, exists: existsAt }
  return withGrants(readGrantList(stored.grants), oldRulesAsGrants(strings(stored.allow), strings(stored.deny), origin))
}

export async function writePersonGrants(grants: readonly Grant[], home: string = homedir()): Promise<void> {
  const file = personGrantsFile(home)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify({ grants }, null, 2)}\n`, 'utf8')
}

/**
 * The person's answers, read once at start-up and kept in memory from then on:
 * every call reads them synchronously, so what is kept for the person answers
 * the same way a session's own answers do, with the file write trailing behind.
 */
export class PersonGrantsStore {
  private grants: Grant[] = []
  private readonly loaded: Promise<void>

  constructor(
    private readonly home: string = homedir(),
    onError: (error: unknown) => void = () => {},
  ) {
    this.loaded = readPersonGrants(this.home).then(
      (grants) => {
        this.grants = grants
      },
      onError,
    )
  }

  /** Waits for the first read, so an early write is not lost under what is still loading. */
  async ready(): Promise<void> {
    await this.loaded
  }

  get(): readonly Grant[] {
    return this.grants
  }

  async add(grants: readonly Grant[]): Promise<void> {
    await this.loaded
    await this.set(withGrants(this.grants, grants))
  }

  /** Replaces the whole list, as editing it on the settings page does. */
  async set(grants: readonly Grant[]): Promise<void> {
    await this.loaded
    this.grants = [...grants]
    await writePersonGrants(this.grants, this.home)
  }
}

/**
 * One of the Claude engine's settings files, its `permissions.allow` and
 * `permissions.deny` read as grants. Read again only when the file changes,
 * since every call asks.
 */
export class ClaudeRulesFile {
  private seen: number | undefined
  private grants: Grant[] = []

  constructor(
    private readonly file: string,
    private readonly origin: RuleOrigin,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  read(): readonly Grant[] {
    let modified: number
    try {
      modified = statSync(this.file).mtimeMs
    } catch {
      // No such file: the engine has no rules here.
      this.seen = undefined
      this.grants = []
      return this.grants
    }
    if (modified === this.seen) return this.grants
    this.seen = modified
    try {
      const settings = JSON.parse(readFileSync(this.file, 'utf8')) as { permissions?: { allow?: unknown; deny?: unknown } }
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((r): r is string => typeof r === 'string') : [])
      const convert = (verdict: Grant['verdict']) => (rule: string) => grantFromClaudeRule(rule, verdict, this.origin)
      this.grants = [...list(settings.permissions?.allow).map(convert('allow')), ...list(settings.permissions?.deny).map(convert('deny'))].filter((g): g is Grant => g !== undefined)
    } catch (error) {
      this.grants = []
      this.onError(new Error(`${this.file}: ${error instanceof Error ? error.message : String(error)}`))
    }
    return this.grants
  }
}

export function existsAt(path: string): 'file' | 'directory' | undefined {
  try {
    return statSync(path).isDirectory() ? 'directory' : 'file'
  } catch {
    // Absent, or out of reach: nothing there to say what it is.
    return undefined
  }
}
