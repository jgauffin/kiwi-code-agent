import { sameModelProfile, type ModelProfile, type PhaseProfile, type Step } from './model-profile'
import { isFeatureless } from './session-manager'
import { underWay, type SessionStatus } from './session-status'

/**
 * The steps a feature's plan carries its own profile choice for: blind plan,
 * map against code, implement, cleanup (B1). `isFeatureless` names exactly
 * the steps that stand on their own rather than on a feature, so its
 * complement is every step of a feature's plan. Verification takes no
 * choice because it is not a step at all: it runs no model.
 */
export const isPhaseStep = (step: Step): boolean => !isFeatureless(step)

/** The four steps `isPhaseStep` names (B1), as a type narrower than every `Step`, for anything that only ever shows or chooses across these four. */
export type PhaseStepName = 'plan' | 'reconcile' | 'implement' | 'cleanup'

/** The four phase steps in the order a feature runs them (B1), for anything that must show or choose across all of them. */
export const PHASE_STEPS: readonly PhaseStepName[] = ['plan', 'reconcile', 'implement', 'cleanup']

/** One feature's phase choices: the profile name picked for a step, absent where the settings default stands (B2). */
export type PhaseChoices = Partial<Record<Step, string>>

/** Every feature's phase choices, keyed by feature name. */
export type FeaturePhaseChoices = Record<string, PhaseChoices>

/**
 * Where the choices live: per feature and per user, outside the spec and the
 * tasks file, so choosing a profile never changes a feature's derived stage
 * and never makes a mapped board stale (B7).
 */
export interface PhaseChoiceStore {
  read(): FeaturePhaseChoices
  save(choices: FeaturePhaseChoices): Promise<void>
}

/** The choice held for one feature's step, if any; undefined means the settings default stands (B2). */
export function choiceFor(choices: FeaturePhaseChoices, feature: string, step: Step): string | undefined {
  return choices[feature]?.[step]
}

/** Sets or clears one feature's choice for one step, leaving every other feature and every other step of this one untouched. */
export async function chooseProfile(store: PhaseChoiceStore, feature: string, step: Step, profileName: string | undefined): Promise<FeaturePhaseChoices> {
  const current = store.read()
  const forFeature = { ...current[feature] }
  if (profileName) forFeature[step] = profileName
  else delete forFeature[step]
  const next: FeaturePhaseChoices = { ...current, [feature]: forFeature }
  await store.save(next)
  return next
}
