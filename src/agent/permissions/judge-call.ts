import type { CommandSite } from './classifiers/classifier'
import { isKnown, known, type Effect, type Invocation, type Place } from './effects'
import { decideCall, judgeEffect, type EffectVerdict, type Ground, type KeepOffer } from './evaluator'
import { grantSentence } from './grant-sentence'
import { commandMatches, type KeptGrant } from './grants'
import { covers, normalizePlace } from './places'
import type { ProjectCommands } from './project-commands'
import { shellEffects, siteAt } from './shell-effects'
import { isShellTool } from './tool-classes'
import { toolEffects, type ToolFacts } from './tool-effects'

/** Everything one call is judged against. */
export type CallContext = {
  grants: readonly KeptGrant[]
  ground: Ground
  home?: string
  exists(path: string): 'file' | 'directory' | undefined
  project?: ProjectCommands
  tools: ToolFacts
}

/** One thing a call would do, as the permission prompt lists it. */
export type PermissionRow = {
  /** The command as written, or the tool's name. */
  text: string
  /** What it does and where, in a few words: `Reads D:/data`, `Deletes raw.csv`, `Runs a program`. */
  does: string
  verdict: EffectVerdict['kind']
  /** What lets it through, why it is asked, or why it is refused. */
  reason: string
  /** What an answer to it may be kept as; set when it is asked. */
  keep?: KeepOffer
}

export type CallJudgement = { decision: 'passes' | 'asked' | 'refused'; rows: PermissionRow[] }

/**
 * A call as rows, one per effect, and what the rules make of the whole. The
 * same action at the same place is one row however many commands do it; a
 * call with no effects runs unasked. `agent` is the sub agent the call is made inside.
 */
export function judgeCall(toolName: string, input: unknown, cwd: string, context: CallContext, agent?: string): CallJudgement {
  const start = known(normalizePlace(cwd))
  const items: { text: string; effect: Effect; invocation?: Invocation; cwd: Place; projectCommand?: string; refusal?: string }[] = []
  if (isShellTool(toolName)) {
    const command = typeof (input as { command?: unknown })?.command === 'string' ? (input as { command: string }).command : ''
    for (const judged of shellEffects(command, start, { home: context.home, exists: context.exists, project: context.project })) {
      if (judged.ruling.kind === 'refused') items.push({ text: judged.text, effect: { action: 'runs', reason: judged.ruling.reason }, cwd: judged.cwd, refusal: judged.ruling.reason })
      else for (const effect of judged.ruling.effects) items.push({ text: judged.text, effect, cwd: judged.cwd, ...(judged.invocation ? { invocation: judged.invocation } : {}), ...(judged.projectCommand ? { projectCommand: judged.projectCommand } : {}) })
    }
  } else {
    const site: CommandSite = siteAt(start, { home: context.home, exists: context.exists })
    const { invocation, ruling } = toolEffects(toolName, input, site, context.tools, agent)
    // A tool denied by name is refused even where it does nothing else a place could stand for.
    const denial = context.grants.find((g) => g.verdict === 'deny' && g.command !== undefined && commandMatches(g, invocation))
    if (ruling.kind === 'refused') items.push({ text: toolName, effect: { action: 'runs', reason: ruling.reason }, cwd: start, refusal: ruling.reason })
    else if (denial && ruling.effects.length === 0) items.push({ text: toolName, effect: { action: 'runs', reason: '' }, cwd: start, refusal: `refused by a kept answer: ${grantSentence(denial, denial.scope)}` })
    else for (const effect of ruling.effects) items.push({ text: toolName, effect, invocation, cwd: start })
  }
  const judged: { row: PermissionRow; effect: Effect }[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const verdict: EffectVerdict = item.refusal !== undefined ? { kind: 'refused', reason: item.refusal } : judgeEffect(item, context.grants, context.ground)
    const does = item.refusal !== undefined ? 'Refused before it runs' : describe(item.effect, item.invocation)
    const key = `${does}|${verdict.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    const row: PermissionRow = { text: item.text, does, verdict: verdict.kind, reason: verdict.kind === 'passes' ? verdict.by : verdict.kind === 'asked' ? verdict.why : verdict.reason, ...(verdict.kind === 'asked' ? { keep: verdict.keep } : {}) }
    judged.push({ row, effect: item.effect })
  }
  const rows = judged.filter((one, i) => !judged.some((other, j) => j !== i && answers(other, one) && !(answers(one, other) && i < j))).map((one) => one.row)
  return { decision: decideCall(rows.map(asVerdict)), rows }
}

/**
 * Does answering `wide` answer `narrow` too? Both asked about the same action
 * at known places, both keepable, and every place `wide` may be kept for
 * covers where `narrow` happens: `ls -R docs` and `wc -c docs/*` are one
 * question, so the narrower is not asked beside it.
 */
function answers(wide: { row: PermissionRow; effect: Effect }, narrow: { row: PermissionRow; effect: Effect }): boolean {
  if (wide.row.verdict !== 'asked' || narrow.row.verdict !== 'asked') return false
  if (wide.row.keep?.allowNever !== undefined || narrow.row.keep?.allowNever !== undefined) return false
  const a = wide.effect
  const b = narrow.effect
  if ((a.action !== 'read' && a.action !== 'write') || a.action !== b.action) return false
  if (!isKnown(a.place) || !isKnown(b.place)) return false
  return covers(a.place.path, a.extent, b.place.path, b.extent)
}

function asVerdict(row: PermissionRow): EffectVerdict {
  if (row.verdict === 'passes') return { kind: 'passes', by: row.reason }
  if (row.verdict === 'refused') return { kind: 'refused', reason: row.reason }
  return { kind: 'asked', why: row.reason, keep: row.keep! }
}

const VERB: Record<'read' | 'write' | 'destroy', string> = { read: 'Reads', write: 'Writes', destroy: 'Deletes or replaces' }
const BEYOND: Record<Extract<Effect, { action: 'reaches' }>['what'], string> = {
  network: 'Reaches the network',
  remote: 'Reaches a remote repository',
  history: "Changes the repository's history",
  machine: "Changes the machine's configuration",
  command: 'Runs',
}

/** What an effect does and where, as the prompt's row says it. */
export function describe(effect: Effect, invocation: Invocation | undefined): string {
  const where = (place: Place): string => (isKnown(place) ? place.path : `${place.unknown} (unknown place)`)
  switch (effect.action) {
    case 'read':
    case 'write':
    case 'destroy':
      return `${VERB[effect.action]} ${where(effect.place)}${effect.extent === 'tree' ? ' and below' : ''}`
    case 'runs':
      return 'Runs a program decided when it runs'
    case 'enters':
      return `Changes directory to ${where(effect.place)}`
    case 'reaches':
      return effect.what === 'command' ? `Runs ${invocation?.command.join(' ') ?? 'a command'} in ${where(effect.place)}` : `${BEYOND[effect.what]} from ${where(effect.place)}`
  }
}
