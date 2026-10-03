import { effortLevels, fitEffort, STEP_EFFORT, type ReasoningControl } from './effort'
import type { SessionMode } from './session-manager'

export type Engine = 'claude-sdk' | 'openai-compatible'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Where models come from: an endpoint, the key that opens it, and what it
 * serves. A key lives in secret storage under the provider's own name;
 * renaming the provider moves it, so there is nothing else to name. The
 * Claude engine has no base URL, and its key is optional: without one it runs
 * on the editor's Claude login.
 */
export type Provider = {
  name: string
  engine: Engine
  /** OpenAI-compatible providers only. */
  baseUrl?: string
  /** The models to pick from, hand-written or filled from the provider's own list. */
  models: string[]
  /**
   * Per model, the conversation size at which a session compacts; a model not
   * named here takes the global `compactAtTokens`. Kept on the provider since
   * what a long conversation costs is the provider's price for the model.
   */
  compactAtTokens?: Record<string, number>
  /** OpenAI-compatible providers only: how the endpoint takes effort. Absent, the known-model table decides per model. */
  reasoningControl?: ReasoningControl
}

/**
 * The step a session runs as: what it is for decides which model it gets. A
 * fix of a failed test run is an implement session, but a step of its own, as
 * is the build of an approved plan, which carries on in the plan's session.
 */
export type Step = SessionMode | 'fix' | 'code-build'

/** One model to run a step on, named by its provider. */
export type ModelChoice = {
  provider: string
  model: string
  effort?: Effort
  /** Path to a system prompt file, relative to the workspace. */
  systemPromptFile?: string
}

/** What a step says for itself: a model (provider and model together), an effort, or both. What it leaves out is the default's. */
export type StepChoice = Partial<ModelChoice>

/**
 * One selectable way to work: a model for everything, and a different one for
 * the steps that earn it. A step with no entry of its own runs the default, so
 * a step added later needs no profile changed.
 */
export type Profile = {
  name: string
  default: ModelChoice
  steps?: Partial<Record<Step, StepChoice>>
}

/** A profile's choice for one step, flattened with its provider: what a session runs on. */
export type ModelProfile = {
  name: string
  engine: Engine
  model: string
  /** OpenAI-compatible engines only. */
  baseUrl?: string
  /** Name under which the API key is stored in secret storage; required for OpenAI-compatible engines, optional for Claude. */
  apiKeySecret?: string
  effort?: Effort
  systemPromptFile?: string
}

/** The model a profile runs a step on: the step's own where it names one, the default's otherwise. */
export function choiceFor(profile: Profile, step: Step): ModelChoice {
  const own = profile.steps?.[step] ?? {}
  return {
    ...profile.default,
    ...(own.provider && own.model ? { provider: own.provider, model: own.model } : {}),
    ...(own.effort ? { effort: own.effort } : {}),
    ...(own.systemPromptFile ? { systemPromptFile: own.systemPromptFile } : {}),
  }
}

/**
 * The effort a step asks for: its own, else the one suggested for the step,
 * else the profile default's. The suggestion beats the default so that one
 * effort set for chat does not flatten every step to it.
 */
const wantedEffort = (profile: Profile, step: Step): Effort | undefined => profile.steps?.[step]?.effort ?? STEP_EFFORT[step] ?? profile.default.effort

/**
 * What the step runs on, as an engine needs it. A provider a profile names but
 * settings do not hold is an error rather than a fallback: a session silently
 * running on another model is worse than one that refuses to start. A fix
 * tries one level harder for each test run that failed again (`attempt`
 * counts from 1), and every effort is fitted to what the model takes.
 */
export function resolveStep(profile: Profile, providers: Provider[], step: Step, attempt = 1): ModelProfile {
  const choice = choiceFor(profile, step)
  const provider = providers.find((p) => p.name === choice.provider)
  if (!provider) throw new Error(`Profile "${profile.name}" runs ${step} on provider "${choice.provider}", which is not configured.`)
  const wanted = wantedEffort(profile, step)
  const effort = wanted && fitEffort(wanted, step === 'fix' ? attempt - 1 : 0, effortLevels(provider, choice.model))
  return {
    name: profile.name,
    engine: provider.engine,
    model: choice.model,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    apiKeySecret: provider.name,
    ...(effort ? { effort } : {}),
    ...(choice.systemPromptFile ? { systemPromptFile: choice.systemPromptFile } : {}),
  }
}

/**
 * A model on offer in the chat: what a session switched to it would run on,
 * and the effort levels it takes. Empty levels mean the model is not asked
 * for an effort, so there is nothing to offer.
 */
export type ModelOffer = { profile: ModelProfile; efforts: readonly Effort[] }

/** Every model the providers serve, as the chat offers them. */
export function offeredModels(providers: Provider[]): ModelOffer[] {
  return providers.flatMap((provider) => provider.models.map((model) => ({ profile: providerModel(provider, model), efforts: effortLevels(provider, model) })))
}

/**
 * What a session on `current` runs on once it switches to `offer`: the effort
 * it was on stays picked, brought down to the highest level the new model
 * takes, and a model that takes none leaves it at its own default.
 */
export function switchedTo(current: ModelProfile, offer: ModelOffer): ModelProfile {
  return atEffort(offer.profile, current.effort && fitEffort(current.effort, 0, offer.efforts))
}

/** The same profile at another effort, or at none: the model's own default, as a profile that never named one. */
export function atEffort(profile: ModelProfile, effort: Effort | undefined): ModelProfile {
  const next = { ...profile }
  delete next.effort
  return effort ? { ...next, effort } : next
}

/** A model of a provider as the chat picker offers it, and as a resolved profile for a session to run on. */
export function providerModel(provider: Provider, model: string): ModelProfile {
  return {
    name: `${provider.name} · ${model}`,
    engine: provider.engine,
    model,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    apiKeySecret: provider.name,
  }
}

/** Whether two resolved profiles would run a session the same way; used to tell a changed choice from one that resolved to the same place. */
export function sameModelProfile(a: ModelProfile, b: ModelProfile): boolean {
  return (
    a.engine === b.engine &&
    a.model === b.model &&
    a.baseUrl === b.baseUrl &&
    a.apiKeySecret === b.apiKeySecret &&
    a.effort === b.effort &&
    a.systemPromptFile === b.systemPromptFile
  )
}
