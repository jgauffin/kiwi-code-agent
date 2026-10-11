import type { Effect, Invocation } from './effects'
import { covers, normalizePlace, type Reach } from './places'

/**
 * A kept answer: an allow or a deny of an action, or of a command, at a place
 * and as far below it as `reach` says. Where it is kept (the session, the
 * workspace's settings, the person's own) is its scope, not a field of it.
 * Pure, so the webview words a grant with the same module the extension
 * decides by.
 */
export type Grant = {
  verdict: 'allow' | 'deny'
  /** An action kept for a place. Exactly one of `action` and `command` is set. */
  action?: 'read' | 'write'
  /** A command, with its subcommand where it has one, or a tool's name; the call's own effects at the place are covered. */
  command?: string[]
  /** On a deny only: the flags, under their long names, a call must carry to be refused. */
  flags?: string[]
  /** Absolute, forward slashes. */
  place: string
  reach: Reach
  /**
   * The root of the one workspace it holds in. Set on an answer kept for a
   * workspace about a place outside it, which is stored with the person's own
   * answers on this machine rather than in the workspace's settings, so a path
   * on one machine never travels with the source.
   */
  workspace?: string
}

export type GrantScope = 'session' | 'workspace' | 'person'

export type KeptGrant = Grant & { scope: GrantScope }

const REACHES: readonly Reach[] = ['file', 'directory', 'tree']

/** A grant read from settings, or undefined when it is not one: a hand-edited entry that does not parse is left out rather than guessed at. */
export function parseGrant(value: unknown): Grant | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  if (v['verdict'] !== 'allow' && v['verdict'] !== 'deny') return undefined
  if (typeof v['place'] !== 'string' || !REACHES.includes(v['reach'] as Reach)) return undefined
  const action = v['action'] === 'read' || v['action'] === 'write' ? v['action'] : undefined
  const command = Array.isArray(v['command']) && v['command'].length > 0 && v['command'].every((w) => typeof w === 'string') ? (v['command'] as string[]) : undefined
  if ((action === undefined) === (command === undefined)) return undefined
  const flags = Array.isArray(v['flags']) && v['flags'].every((f) => typeof f === 'string') ? (v['flags'] as string[]) : undefined
  const workspace = typeof v['workspace'] === 'string' && v['workspace'] !== '' ? normalizePlace(v['workspace']) : undefined
  // An allow naming flags would stop covering the next call written differently; it is never kept.
  if (flags !== undefined && flags.length > 0 && v['verdict'] === 'allow') return undefined
  return {
    verdict: v['verdict'],
    ...(action !== undefined ? { action } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(flags !== undefined && flags.length > 0 ? { flags } : {}),
    place: normalizePlace(v['place']),
    reach: v['reach'] as Reach,
    ...(workspace !== undefined ? { workspace } : {}),
  }
}

/** Two grants that say the same thing, whatever order their flags were listed in. */
export function sameGrant(a: Grant, b: Grant): boolean {
  return (
    a.verdict === b.verdict &&
    a.action === b.action &&
    (a.command ?? []).join(' ') === (b.command ?? []).join(' ') &&
    [...(a.flags ?? [])].sort().join(' ') === [...(b.flags ?? [])].sort().join(' ') &&
    a.place === b.place &&
    a.reach === b.reach &&
    a.workspace === b.workspace
  )
}

/** Does a command grant name this call: the same command and subcommand, or the command alone, carrying every flag it names? */
export function commandMatches(grant: Grant, invocation: Invocation): boolean {
  const words = grant.command
  if (!words || words.length > invocation.command.length) return false
  const named = words.every((word, i) => {
    const called = invocation.command[i]!
    // An MCP server's tools all at once: `mcp__server__*`.
    if (i === 0 && word.endsWith('__*')) return called.startsWith(word.slice(0, -1))
    return i === 0 ? word.toLowerCase() === called.toLowerCase() : word === called
  })
  return named && (grant.flags ?? []).every((flag) => invocation.flags.has(flag))
}

/** Where an effect happens, and how far below it, for comparing against a grant's place. */
function effectPlace(effect: Effect): { path: string; extent: Reach } | undefined {
  if (effect.action === 'runs') return undefined
  if (!('path' in effect.place)) return undefined
  return { path: effect.place.path, extent: effect.action === 'reaches' || effect.action === 'enters' ? 'directory' : effect.extent }
}

/** Does the grant's place reach where the effect happens? */
export function reachesEffect(grant: Grant, effect: Effect): boolean {
  const at = effectPlace(effect)
  return at !== undefined && covers(grant.place, grant.reach, at.path, at.extent)
}

/**
 * Does an allow cover this effect? An action grant covers its own action, and
 * a place kept for writing may be read too; a command grant covers the
 * command's own effects at its place. A destroy, a program run and an unknown
 * place are never covered by an allow.
 */
export function allowCovers(grant: Grant, effect: Effect, invocation: Invocation | undefined): boolean {
  if (grant.verdict !== 'allow') return false
  if (effect.action === 'runs' || effect.action === 'destroy' || effect.action === 'enters') return false
  if (!reachesEffect(grant, effect)) return false
  if (grant.action !== undefined) return effect.action === 'read' ? true : effect.action === 'write' && grant.action === 'write'
  return invocation !== undefined && commandMatches(grant, invocation)
}

/**
 * Does a deny refuse this effect? A read denial refuses everything at the
 * place, changing into it among them; a write denial refuses writing and
 * destroying there. A command denial refuses the command wherever its effects
 * land in the place, or where it stands.
 */
export function denyRefuses(grant: Grant, effect: Effect, invocation: Invocation | undefined, cwd: string | undefined): boolean {
  if (grant.verdict !== 'deny') return false
  if (grant.action !== undefined) {
    if (!reachesEffect(grant, effect)) return false
    return grant.action === 'read' || effect.action === 'write' || effect.action === 'destroy'
  }
  if (invocation === undefined || !commandMatches(grant, invocation)) return false
  return reachesEffect(grant, effect) || (cwd !== undefined && covers(grant.place, grant.reach, cwd, 'directory'))
}
