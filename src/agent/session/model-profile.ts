import type { SessionMode } from './session-manager'

export type Engine = 'claude-sdk' | 'openai-compatible'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Where models come from: an endpoint, the key that opens it, and what it
 * serves. The Claude engine inherits the editor's login, so it carries
 * neither a base URL nor a key. An OpenAI-compatible provider's key lives in
 * secret storage under the provider's own name; renaming the provider moves
 * it, so there is nothing else to name.
 */
export type Provider = {
  name: string
  engine: Engine
  /** OpenAI-compatible providers only. */
  baseUrl?: string
  /** The models to pick from, hand-written or filled from the provider's own list. */
  models: string[]
}

/** The step a session runs as: what it is for decides which model it gets. */
export type Step = SessionMode

/** One model to run a step on, named by its provider. */
export type ModelChoice = {
  provider: string
  model: string
  effort?: Effort
  /** Path to a system prompt file, relative to the workspace. */
  systemPromptFile?: string
}

/**
 * One selectable way to work: a model for everything, and a different one for
 * the steps that earn it. A step with no entry of its own runs the default, so
 * a step added later needs no profile changed.
 */
export type Profile = {
  name: string
  default: ModelChoice
  steps?: Partial<Record<Step, ModelChoice>>
}

/** A profile's choice for one step, flattened with its provider: what a session runs on. */
export type ModelProfile = {
  name: string
  engine: Engine
  model: string
  /** OpenAI-compatible engines only. */
  baseUrl?: string
  /** Name under which the API key is stored in secret storage. */
  apiKeySecret?: string
  effort?: Effort
  systemPromptFile?: string
}

/** The choice a profile makes for a step: its own where it has one, the default otherwise. */
export const choiceFor = (profile: Profile, step: Step): ModelChoice => profile.steps?.[step] ?? profile.default

/**
 * What the step runs on, as an engine needs it. A provider a profile names but
 * settings do not hold is an error rather than a fallback: a session silently
 * running on another model is worse than one that refuses to start.
 */
export function resolveStep(profile: Profile, providers: Provider[], step: Step): ModelProfile {
  const choice = choiceFor(profile, step)
  const provider = providers.find((p) => p.name === choice.provider)
  if (!provider) throw new Error(`Profile "${profile.name}" runs ${step} on provider "${choice.provider}", which is not configured.`)
  return {
    name: profile.name,
    engine: provider.engine,
    model: choice.model,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    ...(provider.engine === 'openai-compatible' ? { apiKeySecret: provider.name } : {}),
    ...(choice.effort ? { effort: choice.effort } : {}),
    ...(choice.systemPromptFile ? { systemPromptFile: choice.systemPromptFile } : {}),
  }
}

/** A model of a provider as the chat picker offers it, and as a resolved profile for a session to run on. */
export function providerModel(provider: Provider, model: string): ModelProfile {
  return {
    name: `${provider.name} · ${model}`,
    engine: provider.engine,
    model,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    ...(provider.engine === 'openai-compatible' ? { apiKeySecret: provider.name } : {}),
  }
}
