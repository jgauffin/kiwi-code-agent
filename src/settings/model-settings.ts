import type { Effort, Engine, ModelChoice, Profile, Provider } from '../agent/session/model-profile'
import { isPlanning, STEPS } from '../agent/session/session-manager'

/** A profile as settings held it before a model was chosen per step: one model, its endpoint inlined. */
export type LegacyProfile = {
  name: string
  engine: Engine
  model: string
  baseUrl?: string
  apiKeySecret?: string
  effort?: Effort
  systemPromptFile?: string
}

/** What a model runs on, as the settings page and the session factory read it. */
export type ModelSettings = { providers: Provider[]; profiles: Profile[]; activeProfile: string }

/**
 * The old shape read as the new one. Every distinct endpoint becomes a
 * provider, every old profile stays a profile so the picker still offers what
 * it offered, and the plan model becomes overrides on the one in use. Read
 * only: nothing is written back, so a settings.json from before keeps working
 * until the page saves over it.
 */
export function migrateModelSettings(legacy: LegacyProfile[], activeProfile: string, planProfile: string): ModelSettings {
  const providers: Provider[] = []
  const providerOf = new Map<LegacyProfile, string>()
  // Keyed on the old apiKeySecret too: two profiles naming the same one read the same stored secret, so they must become the one provider that now keeps it.
  const byEndpoint = new Map<string, Provider>()
  for (const profile of legacy) {
    const key = `${profile.engine}\u0000${profile.baseUrl ?? ''}\u0000${profile.apiKeySecret ?? ''}`
    const provider = byEndpoint.get(key) ?? addProvider(providers, profile)
    byEndpoint.set(key, provider)
    if (!provider.models.includes(profile.model)) provider.models.push(profile.model)
    providerOf.set(profile, provider.name)
  }
  const planned = legacy.find((p) => p.name === planProfile)
  const active = legacy.find((p) => p.name === activeProfile) ?? legacy[0]
  const profiles = legacy.map((profile) => {
    const own: Profile = { name: profile.name, default: choiceOf(profile, providerOf.get(profile)!) }
    // The plan model was one setting for every planning step, so it becomes an override on each of them.
    if (profile !== active || !planned || planned === active) return own
    const choice = choiceOf(planned, providerOf.get(planned)!)
    return { ...own, steps: Object.fromEntries(STEPS.filter((s) => isPlanning(s.step)).map((s) => [s.step, choice])) }
  })
  return { providers, profiles, activeProfile: active?.name ?? '' }
}

function addProvider(providers: Provider[], profile: LegacyProfile): Provider {
  // Named after the old apiKeySecret when there was one: the provider's name is now the secret's own key, and this is the name the secret is already stored under.
  const provider: Provider = {
    name: uniqueName(providers, profile.engine === 'claude-sdk' ? 'Claude' : profile.apiKeySecret?.trim() || profile.name),
    engine: profile.engine,
    ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
    models: [],
  }
  providers.push(provider)
  return provider
}

function uniqueName(providers: Provider[], wanted: string): string {
  if (!providers.some((p) => p.name === wanted)) return wanted
  for (let suffix = 2; ; suffix++) {
    const name = `${wanted} ${suffix}`
    if (!providers.some((p) => p.name === name)) return name
  }
}

function choiceOf(profile: LegacyProfile, provider: string): ModelChoice {
  return {
    provider,
    model: profile.model,
    ...(profile.effort ? { effort: profile.effort } : {}),
    ...(profile.systemPromptFile ? { systemPromptFile: profile.systemPromptFile } : {}),
  }
}

/**
 * No provider ever exists without the page or a migration having put it
 * there, so its absence is what marks settings from before providers
 * existed; `profiles` says nothing, since an empty profile list is equally
 * true of a fresh install and of one mid-migration.
 */
export const needsMigration = (providers: Provider[]): boolean => providers.length === 0
