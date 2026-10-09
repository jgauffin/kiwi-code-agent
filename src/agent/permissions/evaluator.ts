import { isKnown, type Effect, type Invocation, type Place } from './effects'
import { grantSentence } from './grant-sentence'
import { allowCovers, denyRefuses, type GrantScope, type KeptGrant } from './grants'
import { isWithin, parentPlace, type Reach } from './places'

/**
 * The ground every call stands on besides the kept answers: where the
 * workspace is, what the session may always read, and the switches in force.
 */
export type Ground = {
  /** The workspace root, normalized. */
  workspace: string
  /** Where the session's own instructions live: read unasked wherever that is. */
  readable: readonly string[]
  /** The session's scratch folder, normalized: written unasked, and nothing there is worth asking about losing. */
  scratch?: string
  /** Is the session's Allow writes switch on? */
  writesAllowed: boolean
  /** Is this path one the repository ignores, so replacing it loses nothing worth asking about? */
  ignored(path: string): boolean
  /** Could git bring back everything at this path: tracked and unchanged, or ignored, with nothing untracked below it? */
  recoverable(path: string): boolean
  /** Does this file decide what runs without asking? A write to it is always asked. */
  trusted(path: string): boolean
  /** While on, a git command that does more than look is refused. */
  denyGitWrites: boolean
  /** The person's home folder: no answer is kept for it or any folder holding it. */
  home?: string
}

/** One effect's call, with what the rest of the line knows about it. */
export type Judged = { effect: Effect; invocation?: Invocation; cwd: Place; projectCommand?: string }

/** What may be kept from an answer to an asked effect. */
export type KeepOffer = {
  /** Why an allow cannot be kept, said on the prompt in one line; absent when it can. */
  allowNever?: string
  /** The scopes the place may be kept for. */
  scopes: GrantScope[]
  /** What a kept answer is for: an action at the place, or the call's command. */
  subject: { action: 'read' | 'write' } | { command: string[] }
  /** The places it may be kept for, the narrowest first, each with how far below it may reach. Empty for an unknown place. */
  places: { place: string; reaches: Reach[] }[]
  /** The flags of the call, offered on a deny only. */
  flags: string[]
}

export type EffectVerdict =
  | { kind: 'passes'; by: string }
  | { kind: 'asked'; why: string; keep: KeepOffer }
  | { kind: 'refused'; reason: string }

/**
 * Decides one effect. A kept denial wins over everything, in any scope; then
 * what the ground settles; then a kept allow; anything left is asked, with
 * what the answer may be kept as.
 */
export function judgeEffect(judged: Judged, grants: readonly KeptGrant[], ground: Ground): EffectVerdict {
  const { effect, invocation } = judged
  const cwd = isKnown(judged.cwd) ? judged.cwd.path : undefined
  const denial = grants.find((g) => denyRefuses(g, effect, invocation, cwd))
  if (denial) return { kind: 'refused', reason: `refused by a kept answer: ${grantSentence(denial, denial.scope)}` }
  if (ground.denyGitWrites && invocation?.command[0] === 'git' && effect.action !== 'read' && effect.action !== 'enters')
    return { kind: 'refused', reason: 'git commands that change the repository are turned off for this workspace (kiwiAgent.permissions.denyGitWrites); read-only git still runs' }
  const allowed = grants.find((g) => allowCovers(g, effect, invocation))
  const keptBy = allowed ? { kind: 'passes' as const, by: grantSentence(allowed, allowed.scope) } : undefined
  const flags = [...(invocation?.flags ?? [])]

  switch (effect.action) {
    case 'enters':
      return { kind: 'passes', by: 'changing directory' }
    case 'runs':
      return asked(`it ${effect.reason}`, { ...denyOnlyOffer(invocation, ground, flags), allowNever: 'Runs a program decided when it runs: always asked.' })
    case 'read': {
      if (!isKnown(effect.place)) return asked(`${effect.place.unknown} could be any folder`, unknownOffer(invocation, ground, flags))
      const path = effect.place.path
      if (isWithin(ground.workspace, path)) return { kind: 'passes', by: 'reading in the workspace' }
      if (ground.readable.some((place) => isWithin(place, path))) return { kind: 'passes', by: "the session's own instructions" }
      if (keptBy) return keptBy
      return asked('no kept answer reads here', placeOffer({ action: 'read' }, path, effect.extent, ground, flags))
    }
    case 'write':
    case 'destroy': {
      if (!isKnown(effect.place)) return asked(`${effect.place.unknown} could be any folder`, unknownOffer(invocation, ground, flags))
      const path = effect.place.path
      if (ground.trusted(path)) return asked('this file decides what runs without asking', { ...placeOffer({ action: 'write' }, path, 'file', ground, flags), allowNever: 'This file decides what runs without asking: always asked.' })
      const throwaway = (ground.scratch !== undefined && isWithin(ground.scratch, path)) || ground.ignored(path)
      // Deleting in the workspace loses nothing while git can bring all of it back, so the Allow writes switch covers it.
      if (effect.action === 'destroy' && effect.removes && ground.writesAllowed && isWithin(ground.workspace, path) && ground.recoverable(path))
        return { kind: 'passes', by: 'the Allow writes switch; git can bring back what it deletes' }
      if (effect.action === 'destroy' && !throwaway)
        return asked('it deletes or replaces what is there', { ...placeOffer({ action: 'write' }, path, effect.extent, ground, flags), allowNever: 'Deletes or replaces content: always asked.' })
      if (ground.scratch !== undefined && isWithin(ground.scratch, path)) return { kind: 'passes', by: 'the scratch folder' }
      if (isWithin(ground.workspace, path)) {
        if (ground.writesAllowed) return { kind: 'passes', by: 'the Allow writes switch' }
        return asked('Allow writes is off', { allowNever: 'Writes in the workspace follow the Allow writes switch.', scopes: [], subject: { action: 'write' }, places: [], flags })
      }
      if (keptBy) return keptBy
      return asked('no kept answer writes here', placeOffer({ action: 'write' }, path, effect.extent, ground, flags))
    }
    case 'reaches': {
      if (judged.projectCommand !== undefined) return { kind: 'passes', by: judged.projectCommand }
      if (keptBy) return keptBy
      const why = REACHES_WHY[effect.what]
      if (!isKnown(effect.place)) return asked(why, unknownOffer(invocation, ground, flags))
      return asked(why, placeOffer(commandOf(invocation), effect.place.path, 'directory', ground, flags))
    }
  }
}

const REACHES_WHY: Record<Extract<Effect, { action: 'reaches' }>['what'], string> = {
  network: 'it reaches the network',
  remote: 'it reaches a remote repository',
  history: "it changes the repository's history",
  machine: "it changes the machine's own configuration",
  command: 'no kept answer covers this command',
}

const asked = (why: string, keep: KeepOffer): EffectVerdict => ({ kind: 'asked', why, keep })

const commandOf = (invocation: Invocation | undefined): KeepOffer['subject'] => ({ command: invocation?.command ?? [] })

function unknownOffer(invocation: Invocation | undefined, ground: Ground, flags: string[]): KeepOffer {
  return { ...denyOnlyOffer(invocation, ground, flags), allowNever: 'Its place is not settled by the line, so this can only be answered for this call.' }
}

/** An effect no allow may be kept for can still have its command denied, across the workspace. */
function denyOnlyOffer(invocation: Invocation | undefined, ground: Ground, flags: string[]): KeepOffer {
  if (!invocation) return { scopes: [], subject: { command: [] }, places: [], flags }
  return { scopes: ['session', 'workspace'], subject: commandOf(invocation), places: [{ place: ground.workspace, reaches: ['tree'] }], flags }
}

/**
 * What an answer at a known place may be kept as: inside the workspace for
 * the session or the workspace, outside it for the session or the person. The
 * places run from the narrowest up to, but not including, the home folder and
 * any folder holding it, since a grant there reaches every file the person keeps.
 */
function placeOffer(subject: KeepOffer['subject'], path: string, extent: Reach, ground: Ground, flags: string[]): KeepOffer {
  const inside = isWithin(ground.workspace, path)
  const scopes: GrantScope[] = inside ? ['session', 'workspace'] : ['session', 'person']
  const places: KeepOffer['places'] = []
  if (extent === 'file') places.push({ place: path, reaches: ['file'] })
  let directory = extent === 'file' ? parentPlace(path) : path
  for (;;) {
    if (ground.home !== undefined && isWithin(directory, ground.home)) break
    // A command runs anywhere below where it is kept as readily as there, so its answer reaches the tree unless narrowed.
    const reaches: Reach[] = extent === 'tree' ? ['tree'] : 'command' in subject ? ['tree', 'directory'] : ['directory', 'tree']
    places.push({ place: directory, reaches })
    const up = parentPlace(directory)
    if (up === directory) break
    directory = up
  }
  // The root of a drive is never offered: a grant there is a grant of the whole drive. Nor is a place
  // straddling the workspace's edge, which would be kept in a scope that place does not warrant.
  const offered = places.filter((p) => !/^([A-Z]:)?\/$/.test(p.place) && (inside ? isWithin(ground.workspace, p.place) : !isWithin(p.place, ground.workspace)))
  return { scopes, subject, places: offered, flags }
}

/** A whole call: refused when any effect is, run unasked when every effect passes, asked otherwise. */
export function decideCall(verdicts: readonly EffectVerdict[]): 'refused' | 'passes' | 'asked' {
  if (verdicts.some((v) => v.kind === 'refused')) return 'refused'
  return verdicts.every((v) => v.kind === 'passes') ? 'passes' : 'asked'
}
