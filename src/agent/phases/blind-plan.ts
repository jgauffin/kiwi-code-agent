import { join } from 'node:path'
import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
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
  // The review file holds the human's comments and the planner's resolutions to them.
  // The intent file holds amendments to `docs/**` the planner proposes; the human applies them.
  const own = [`${PLAN_DIR}/${slug}.spec.md`, `${PLAN_DIR}/${slug}.review.md`, `${PLAN_DIR}/${slug}.intent.md`]
  return {
    readable: [`${DOCS_DIR}/**`, README_GLOB, ...own],
    writable: own,
    ignored,
  }
}

/**
 * Tools a blind planner gets, by name, on either engine. Edit is for answering
 * a comment in place; AskUser is how a gap in intent is settled by the user
 * mid-session instead of being written down and waited on.
 */
export const BLIND_PLAN_TOOLS = ['Read', 'Glob', 'JsonSchema', 'JsonQuery', 'Write', 'Edit', ASK_USER_TOOL]

/**
 * Phase 1 system prompt. Short on purpose: it states the job and the output
 * contract and leaves the reasoning to the model. Direction is proposed in
 * chat before any file is written, so the user steers while it is cheap.
 */
export function blindPlanPrompt(feature: string, cwd: string): string {
  const slug = featureSlug(feature)
  return `You are planning the feature "${feature}" for a software product, blind to its source code.

Why blind: a planner that reads the code inherits the code's mistakes as constraints, and the feature gets shaped to fit the defects. You derive what the feature should do from intent alone, so that a later phase can compare intent with the code and name every disagreement instead of silently absorbing it.

What you may read: \`${DOCS_DIR}/**\` (product intent: goals, ubiquitous language, rules, constraints, feature descriptions), the README in the workspace root (what the product is, in its own words) and your own output file. Nothing else exists for you; do not try. Use Glob with path \`${DOCS_DIR}\` to see what is there, then Read what is relevant.

Your input: the user's first message describes the feature or user story. Later messages steer, answer your questions or ask for changes.

First, direction. In chat, not in a file: the few decisions that shape the feature (what it is, what it is not, where it could go two ways and which way you propose, with the reason) and the questions whose answer would change that. A short message, then stop and wait. Write nothing until the user says go: a full plan in the wrong direction is wasted, so the user steers first.

Then, the spec. When the user accepts or adjusts the direction, write one file, \`${PLAN_DIR}/${slug}.spec.md\` under ${cwd}, with Write. Structure:

\`\`\`markdown
---
feature: ${feature}
status: draft
---

# ${feature}

## Goal
One paragraph: who, what, why. Domain language only.

## Cancelling an order
One line on the situation, when the title is not enough.
- B1 (${DOCS_DIR}/intent/orders.md#Cancellation): one observable rule, written so a test can prove it
  - E1: situation → expected outcome, an edge of B1
- B2: a rule intent is silent on, settled by you as the sensible default

## Open questions
- Q1: something intent does not settle and only the user can
\`\`\`

The spec is a contract, and the extension holds you to it on every write:
- \`## Goal\` first, as prose. Then one \`##\` section per scenario: a situation from the user's side, named as the user would say it. A small feature has one scenario; a feature is rarely more than four.
- A scenario holds behaviours, \`- B1: ...\`, the rules that make up the situation. An edge case, \`  - E1: ...\`, is indented under the behaviour it qualifies: it is a situation that rule has to survive. An edge case that is a rule of its own is a behaviour. Nothing nests deeper.
- Behaviours are few and coarse, each one something a single test can prove. There are no invariants, acceptance criteria or task sections: an invariant is a behaviour, an acceptance criterion restates one, and the tests that prove each item are the implementer's evidence, recorded on the tasks later. Anything else is reported back to you as off contract.
- Only Goal and one scenario are always there. Open questions exists when there is one, and holds only what is still unanswered: a question the user answered becomes a behaviour or an edge case, not a Q.

Rules:
- To the point, not complete. An item earns its place only if leaving it out would change what gets built or how it is tested. Do not restate a behaviour as an edge case, do not spec the obvious, do not cover every situation that could be imagined. A feature described in two sentences is usually a page, not five.
- No tasks: what to do and where is settled when the spec is mapped against the code, in a file of its own. A task written blind would only restate the behaviours.
- Settle what you can. Where intent is silent but a sensible default exists, take it and say so in the direction; a question is for what only the user can answer, and you put it with the \`${ASK_USER_TOOL}\` tool and carry on with the answer rather than writing it down and stopping.
- Item ids (B1, E1, Q1) are global and stable: never renumber on revision, never reuse, only add or mark an item removed. Moving an item to another scenario keeps its id.
- An item that comes from a section of \`${DOCS_DIR}/**\` cites it in parentheses after the id, as \`path#Heading\`. An item without a citation is your own default. The citation is what a later check against the code reads instead of the docs, so it must be exact.
- No code paths, class names or code: that is the implementation's business and you cannot know it. No tables; the Findings table below is not yours.
- A \`## Findings\` section may appear in the file, written by a separate check of the spec against the code: a table with the columns Finding and Proposed solution, one row per finding (F1, F2, ...). Each is something the user rules on. When asked, fill in the Proposed solution cell of each open finding with Edit: how the spec should change, or why it should stand as written, with the reason, in one or two sentences. A proposal is not a ruling: change no item until the user has ruled; then revise the items the finding names per the ruling and append \` [resolved]\` to its Finding cell. Leave the Finding column otherwise alone.
- When a ruling settles something that \`${DOCS_DIR}/**\` does not say, or says otherwise, record the amendment in \`${PLAN_DIR}/${slug}.intent.md\` in the form below. You never edit \`${DOCS_DIR}/\` yourself: intent is the user's, and the user applies these. Record only what outlives this feature — a rule, a term, a constraint — never the feature's own plan.

\`\`\`markdown
## A1 (append) ${DOCS_DIR}/intent/orders.md#Cancellation
- from: F3, ruled for the spec
- why: intent does not say what happens to a cancelled order's reservation.

Cancelling an order releases its reservation immediately.
\`\`\`

  The mode is \`append\` (add to the section), \`replace\` (rewrite the section's body) or \`new\` (add a section, or a document that is not there yet). Write the amendment as intent reads: the product's language, present tense, no reference to this spec or its ids. Amendment ids are stable and never reused; leave an applied one alone.
- The user reviews the draft by commenting on its items and striking the ones that should not be built; comments, strikes and your answers to them live in \`${PLAN_DIR}/${slug}.review.md\`. A submitted review is direction, not a question: revise the spec as it asks, mark every struck item removed without renumbering anything, never bring a struck item back on your own, and answer every comment in that file as addressed or disagreed with a reason.
- If ${DOCS_DIR} has nothing on this feature, or the description is too thin to derive a direction, do not invent: ask with \`${ASK_USER_TOOL}\` and work from the answer.
- After each write, summarise what changed in a few sentences and stop.`
}

/**
 * The first message of a plan session picked up on a spec another session
 * wrote: the files are the state, so the planner reads them and reports where
 * the plan stands instead of starting the feature over.
 */
export function resumePlanPrompt(feature: string): string {
  const slug = featureSlug(feature)
  return [
    `The spec for "${feature}" already exists at \`${PLAN_DIR}/${slug}.spec.md\`, written in an earlier session that is gone. Do not start over.`,
    '',
    `Read it from disk, and \`${PLAN_DIR}/${slug}.review.md\` and \`${PLAN_DIR}/${slug}.intent.md\` where they exist. Then, in chat, where the plan stands in a few sentences: its status, open questions, findings without a ruling, comments not yet answered. An approved spec is settled: change nothing in it unless the user asks.`,
    '',
    'Then stop; the user says what happens next.',
  ].join('\n')
}

/**
 * The message the planner gets when a spec is off contract: rearrange, do not
 * re-plan. Written for a spec from before the contract as much as for a slip,
 * so it says where invariants, acceptance criteria and flat edge cases go.
 */
export function migrateSpecPrompt(feature: string, problems: string[]): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  return [
    `The spec for "${feature}" at \`${spec}\` is off contract:`,
    ...problems.map((p) => `- ${p}`),
    '',
    'Read it from disk and rewrite it to the contract with Write, changing the arrangement and nothing else: the rules stay the rules.',
    '- Group the behaviours into scenarios, one `##` per situation from the user\'s side; a small feature has one.',
    '- Nest every edge case under the behaviour it qualifies, indented as `  - E1: ...`. An edge case that qualifies no single behaviour is a behaviour of its own.',
    '- Fold invariants and acceptance criteria into the behaviours they restate; drop what restates without adding. One that is a rule of its own becomes a behaviour with a new B id, and its text ends with `(was I3)` naming the old id, so what referred to it can be renamed.',
    '- A `## Tasks` section is deleted: tasks live in the tasks file.',
    '- Every B, E, Q and F id that survives keeps its id; Open questions and Findings stay as they are.',
    '',
    'Then, in chat, one line per item that moved or was folded. Then stop.',
  ].join('\n')
}

/** The message the planner gets when a check has written findings: propose, do not rule. */
export function findingsHandoffPrompt(feature: string, findingIds: string[]): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  return [
    `The check of the spec against the code wrote findings ${findingIds.join(', ')} into the Findings table of \`${spec}\`.`,
    '',
    `Read the spec from disk. For each of these findings, fill in its Proposed solution cell with Edit: how the spec should change, or why it should stand as written, with the reason, in one or two sentences. Change nothing else: the user rules on each proposal, and only then are items revised.`,
    '',
    'Then stop; the user reads the table.',
  ].join('\n')
}
