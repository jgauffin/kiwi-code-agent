import type { Effort, ModelProfile, Provider, Step } from './model-profile'

/** Every level, weakest first. */
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * How hard each step thinks when the profile does not say. Understanding the
 * task is where most failures start, so the steps that read intent and code
 * get the most. Implement stays at medium rather than low because its runs
 * start cold on a task and explore the code themselves: the plan is written
 * blind to it. A fix starts at medium and rises per repeated failure.
 */
export const STEP_EFFORT: Partial<Record<Step, Effort>> = {
  plan: 'high',
  reconcile: 'high',
  implement: 'medium',
  fix: 'medium',
  cleanup: 'low',
  'code-plan': 'high',
  'docs-map': 'low',
  docs: 'medium',
  'file-decisions': 'medium',
}

/** How an OpenAI-compatible endpoint takes effort: not at all, or as `reasoning_effort` (low, medium, high). */
export type ReasoningControl = 'none' | 'reasoning_effort'

const REASONING_EFFORT: readonly Effort[] = ['low', 'medium', 'high']

/**
 * Models known to take `reasoning_effort`, matched after any host prefix
 * (`openai/gpt-5` on a router). An entry is only added from the vendor's API
 * docs: a wrong one sends a parameter the endpoint rejects.
 */
const KNOWN: { pattern: RegExp; control: ReasoningControl }[] = [
  { pattern: /^gpt-5(?![\w.-]*chat)/i, control: 'reasoning_effort' },
  { pattern: /^(o1|o3|o3-mini|o4-mini)(-\d{4}-\d{2}-\d{2})?$/i, control: 'reasoning_effort' },
]

export function knownReasoningControl(model: string): ReasoningControl | undefined {
  const id = model.slice(model.lastIndexOf('/') + 1)
  return KNOWN.find((k) => k.pattern.test(id))?.control
}

/**
 * The levels a model on this provider takes; none means effort is not sent.
 * Claude takes every level: the engine accepts one its model lacks without
 * failing the turn.
 */
export function effortLevels(provider: Provider, model: string): readonly Effort[] {
  if (provider.engine === 'claude-sdk') return EFFORTS
  const control = provider.reasoningControl ?? knownReasoningControl(model) ?? 'none'
  return control === 'reasoning_effort' ? REASONING_EFFORT : []
}

/**
 * A session's effort as its OpenAI-compatible endpoint takes it now. Fitted
 * again when the engine starts, since a session record keeps the effort it
 * was created with and the provider's control may have changed since.
 */
export function reasoningEffortFor(profile: ModelProfile, providers: Provider[]): 'low' | 'medium' | 'high' | undefined {
  const provider = providers.find((p) => p.name === profile.apiKeySecret)
  if (!profile.effort || !provider) return undefined
  return fitEffort(profile.effort, 0, effortLevels(provider, profile.model)) as 'low' | 'medium' | 'high' | undefined
}

/** `wanted` raised by `by` levels, then brought down to the highest level the model takes. */
export function fitEffort(wanted: Effort, by: number, levels: readonly Effort[]): Effort | undefined {
  if (levels.length === 0) return undefined
  const raised = EFFORTS[Math.min(EFFORTS.indexOf(wanted) + by, EFFORTS.length - 1)]!
  return [...levels].reverse().find((level) => EFFORTS.indexOf(level) <= EFFORTS.indexOf(raised)) ?? levels[0]
}
