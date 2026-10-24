import type { Step } from './model-profile'

/**
 * The steps a profile names a model for, in the order the settings page lists
 * them. A step is a mode: what a session is for is what decides how strong a
 * model it earns, so there is no second vocabulary to keep in step.
 */
export const STEPS: { step: Step; group: StepGroup; label: string; hint: string }[] = [
  { step: 'chat', group: 'Chat', label: 'Chat', hint: 'Work in the code with the full tool set.' },
  { step: 'code-plan', group: 'Plan', label: 'Planning', hint: 'Agree on intent, then plan against the code.' },
  { step: 'code-build', group: 'Plan', label: 'Build', hint: "Build the approved plan in the plan's own conversation, so on the same engine." },
  { step: 'plan', group: 'Feature planning', label: 'Spec', hint: 'Write the spec from the intent docs, blind to the code.' },
  { step: 'reconcile', group: 'Feature planning', label: 'Check against code', hint: 'Name each disagreement between the approved spec and the code before it is built.' },
  { step: 'implement', group: 'Feature planning', label: 'Implement', hint: 'Build the approved spec, task by task, with a test per rule.' },
  { step: 'fix', group: 'Feature planning', label: 'Fix', hint: 'Mend what a failed test run names; one effort level harder each time it fails again.' },
  { step: 'cleanup', group: 'Feature planning', label: 'Cleanup', hint: 'Split what the implementation left oversized.' },
  { step: 'docs-map', group: 'Maintenance', label: 'Docs map', hint: 'Describe the docs so a blind planner can find its way.' },
  { step: 'file-decisions', group: 'Maintenance', label: 'File decisions', hint: "File the user's unfiled decisions into the specs and docs they belong in." },
  { step: 'doc-migration', group: 'Maintenance', label: 'Clean up docs', hint: 'Move behaviour into specs, drop what the specs already say, and make the rest easy to find.' },
]

/** The kind of session a step belongs to: the settings page shows one group at a time. */
export type StepGroup = 'Chat' | 'Plan' | 'Feature planning' | 'Maintenance'

export const STEP_GROUPS: StepGroup[] = ['Chat', 'Plan', 'Feature planning', 'Maintenance']

/** A step named where its group is not shown around it: "Feature planning · Spec". */
export function stepTitle(step: Step): string {
  const entry = STEPS.find((s) => s.step === step)
  if (!entry) return step
  return entry.group === entry.label ? entry.label : `${entry.group} · ${entry.label}`
}
