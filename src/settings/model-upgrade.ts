import type { ModelChoice, Profile, Provider, Step, StepChoice } from '../agent/session/model-profile'

/**
 * The newer model each bundled-engine model is succeeded by. The bundled
 * engine cannot run the newer one — it refuses a model its own version never
 * knew — so each pair is also a move onto the machine's own Claude Code. A
 * pair belongs here once a model the defaults ship outlives the engine
 * shipped beside it.
 */
const SUCCESSORS: Record<string, string> = {
  'claude-opus-5': 'claude-opus-5-5',
  'claude-sonnet-5': 'claude-sonnet-5-5',
}

/** The provider the upgrade adds where the machine has no installed-engine provider yet. */
export const INSTALLED_PROVIDER_NAME = 'Claude (installed)'

/** One model moving to its successor, for saying what the upgrade does before it is taken. */
export type ModelMove = { from: string; to: string }

/** What taking the upgrade writes: the provider to save, the profiles that change, and the moves to describe it by. */
export type ModelUpgrade = {
  provider: Provider
  /** Whether that provider is new, or one already configured that the profiles are merely pointed at. */
  providerIsNew: boolean
  profiles: { index: number; profile: Profile }[]
  moves: ModelMove[]
}

/** The newer model id, carrying the 1M-window suffix across, or nothing where the model has no successor. */
function successorOf(model: string): string | undefined {
  const suffix = model.endsWith('[1m]') ? '[1m]' : ''
  const base = suffix === '' ? model : model.slice(0, -suffix.length)
  const next = SUCCESSORS[base]
  return next === undefined ? undefined : next + suffix
}

/**
 * The upgrade waiting to be offered, or nothing when there is none: nothing
 * to move, or the profiles already run the newer models. Only a choice naming
 * a provider on the bundled engine moves, so a model on an OpenAI-compatible
 * endpoint, or one already on the installed engine, is left exactly as it is.
 *
 * An installed-engine provider already configured is reused rather than a
 * second one added beside it, so the offer cannot leave two providers serving
 * the same models.
 */
export function modelUpgrade(providers: Provider[], profiles: Profile[]): ModelUpgrade | undefined {
  const bundled = providers.filter((p) => p.engine === 'claude-sdk')
  const onBundledEngine = (choice: ModelChoice | StepChoice): string | undefined =>
    choice.provider !== undefined && choice.model !== undefined && bundled.some((p) => p.name === choice.provider) ? successorOf(choice.model) : undefined

  const moves: ModelMove[] = []
  for (const profile of profiles) {
    for (const choice of [profile.default, ...Object.values(profile.steps ?? {})]) {
      const to = onBundledEngine(choice)
      if (to !== undefined && !moves.some((m) => m.from === choice.model)) moves.push({ from: choice.model!, to })
    }
  }
  if (moves.length === 0) return undefined

  // Served: every successor the bundled providers' own lists have, so the
  // picker offers the whole line rather than only what a profile named.
  const served = new Set(moves.map((m) => m.to))
  for (const provider of bundled) {
    for (const model of provider.models) {
      const to = successorOf(model)
      if (to !== undefined) served.add(to)
    }
  }

  const existing = providers.find((p) => p.engine === 'claude-installed')
  const provider: Provider = existing
    ? { ...existing, models: [...new Set([...existing.models, ...served])] }
    : { name: INSTALLED_PROVIDER_NAME, engine: 'claude-installed', models: [...served] }

  const upgraded = <T extends ModelChoice | StepChoice>(choice: T): T => {
    const to = onBundledEngine(choice)
    return to === undefined ? choice : { ...choice, provider: provider.name, model: to }
  }

  const changed: ModelUpgrade['profiles'] = []
  profiles.forEach((profile, index) => {
    const next: Profile = {
      ...profile,
      default: upgraded(profile.default),
      ...(profile.steps ? { steps: Object.fromEntries(Object.entries(profile.steps).map(([step, choice]) => [step, upgraded(choice)])) as Partial<Record<Step, StepChoice>> } : {}),
    }
    if (JSON.stringify(next) !== JSON.stringify(profile)) changed.push({ index, profile: next })
  })

  return { provider, providerIsNew: existing === undefined, profiles: changed, moves }
}
