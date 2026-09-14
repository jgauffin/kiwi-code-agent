import { join } from 'node:path'
import type { Scope } from './scope-guard'

export const DOCS_DIR = 'docs'
export const PLAN_DIR = 'plan'

export function featureSlug(feature: string): string {
  return (
    feature
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'feature'
  )
}

export function specPath(cwd: string, feature: string): string {
  return join(cwd, PLAN_DIR, `${featureSlug(feature)}.spec.md`)
}

/** The product's front door counts as intent: what it says it is, not how it is built. */
export const README_GLOB = '{README,ReadMe,Readme,readme}.md'

/** `ignored` comes from the `kiwiAgent.planIgnore` setting: docs the planner must not see. */
export function blindPlanScope(feature: string, ignored: string[] = []): Scope {
  const slug = featureSlug(feature)
  return {
    readable: [`${DOCS_DIR}/**`, README_GLOB, `${PLAN_DIR}/${slug}.spec.md`],
    writable: [`${PLAN_DIR}/${slug}.spec.md`],
    ignored,
  }
}

/** Tools a blind planner gets, by name, on either engine. */
export const BLIND_PLAN_TOOLS = ['Read', 'Glob', 'Write']

/**
 * Phase 1 system prompt. Short on purpose: it states the job and the output
 * contract and leaves the reasoning to the model.
 */
export function blindPlanPrompt(feature: string, cwd: string): string {
  const slug = featureSlug(feature)
  return `You are planning the feature "${feature}" for a software product, blind to its source code.

Why blind: a planner that reads the code inherits the code's mistakes as constraints, and the feature gets shaped to fit the defects. You derive what the feature should do from intent alone, so that a later phase can compare intent with the code and name every disagreement instead of silently absorbing it.

What you may read: \`${DOCS_DIR}/**\` (product intent: goals, ubiquitous language, rules, constraints, feature descriptions), the README in the workspace root (what the product is, in its own words) and your own output file. Nothing else exists for you; do not try. Use Glob with path \`${DOCS_DIR}\` to see what is there, then Read what is relevant.

Your input: the user's first message describes the feature or user story. Later messages answer your questions or ask for changes.

Your output: one file, \`${PLAN_DIR}/${slug}.spec.md\` under ${cwd}, written with Write. Structure:

\`\`\`markdown
---
feature: ${feature}
status: draft
---

# ${feature}

## Goal
One paragraph: who, what, why. Domain language only.

## Behaviour
- B1: one observable rule per item
- B2: ...

## Invariants
- I1: what must always hold

## Edge cases
- E1: situation → expected outcome

## Acceptance criteria
- A1: Given ... when ... then ... (each one testable)

## Tasks
- T1: a unit of work that delivers part of the above, referencing the items it covers (B1, A2)
- T2: ...

## Open questions
- Q1: anything intent does not settle
\`\`\`

Rules:
- Item ids (B1, I1, E1, A1, T1, Q1) are stable: never renumber on revision, only add or mark an item removed.
- No file paths, class names, tables or code. That is the implementation's business and you cannot know it.
- Tasks become work items: each must be understandable on its own and small enough to finish in one sitting.
- If ${DOCS_DIR} has nothing on this feature, or the description is too thin to derive behaviour, do not invent: write the questions under Open questions, write the file, and stop.
- When you have written the file, summarise what it contains in a few sentences and stop.`
}
