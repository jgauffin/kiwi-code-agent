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
- **Cancel command**: one observable rule, written so a test can prove it (${DOCS_DIR}/intent/orders.md#Cancellation)
  - **Shipped order**: situation → expected outcome, an edge of the rule above
- **Refund on cancel**: a rule intent is silent on, settled by you as the sensible default

## Open questions
- **Partial refunds**: something intent does not settle and only the user can
\`\`\`

The spec is a contract, and the extension holds you to it on every write:
- \`## Goal\` first, as prose. Then one \`##\` section per scenario: a situation from the user's side, named as the user would say it. A small feature has one scenario; a feature is rarely more than four.
- A scenario holds rules, \`- **Name**: ...\`, that make up the situation. An edge case, \`  - **Name**: ...\`, is indented under the rule it qualifies: it is a situation that rule has to survive. An edge case that is a rule of its own is a rule. Nothing nests deeper.
- Rules are few and coarse, each one something a single test can prove. There are no invariants, acceptance criteria or task sections: an invariant is a rule, an acceptance criterion restates one, and the tests that prove each rule are the implementer's evidence, recorded on the tasks later. Anything else is reported back to you as off contract.
- Only Goal and one scenario are always there. Open questions exists when there is one, and holds only what is still unanswered: a question the user answered becomes a rule or an edge case.

Rules:
- To the point, not complete. A rule earns its place only if leaving it out would change what gets built or how it is tested. Do not restate a rule as an edge case, do not spec the obvious, do not cover every situation that could be imagined. A feature described in two sentences is usually a page, not five.
- No tasks: what to do and where is settled when the spec is mapped against the code, in a file of its own. A task written blind would only restate the rules.
- Settle what you can. Where intent is silent but a sensible default exists, take it and say so in the direction; a question is for what only the user can answer, and you put it with the \`${ASK_USER_TOOL}\` tool and carry on with the answer rather than writing it down and stopping.
- Every rule, edge case and question has a name, the bold lead-in of its line: a few words that say what it is about, unique in the spec, the way a test or a function is named. The name is what a comment, a task, a test and a decision refer to, so it never changes once written: on revision you add, or mark a rule \` [removed]\`, never rename or delete. A rule you must rename keeps the old name in a note after the new one, \`- **New name** (was Old name): ...\`, and the extension follows the rename through every file. Moving a rule to another scenario keeps its name.
- A rule that comes from a section of \`${DOCS_DIR}/**\` ends with its citation in parentheses, as \`(path#Heading)\`, after the text. A rule without a citation is your own default. The citation is what a later check against the code reads instead of the docs, so it must be exact.
- No code paths, class names or code: that is the implementation's business and you cannot know it.
- A \`## Decisions\` section may appear in the file, written by a separate check of the spec against the code: one \`###\` per decision, with an \`on\` line naming the rules it concerns and a \`finding\` line saying what the code does and what the spec says. Each is something the user rules on. When asked, add a \`- proposed: ...\` line under each decision that has none, with Edit: how the rules should change, or why they stand as written, with the reason, in one or two sentences. A proposal is not a ruling: change no rule until the user has ruled. The \`- ruling: ...\` line is the user's, written for you: \`accepted\` means the proposal as written, anything else is the user's own decision. When rulings are handed to you, revise the rules each decision names per its ruling, append \` [applied]\` to that decision's heading, and touch nothing else in the section.
- When a ruling settles something that \`${DOCS_DIR}/**\` does not say, or says otherwise, record the amendment in \`${PLAN_DIR}/${slug}.intent.md\` in the form below. You never edit \`${DOCS_DIR}/\` yourself: intent is the user's, and the user applies these. Record only what outlives this feature (a rule, a term, a constraint), never the feature's own plan.

\`\`\`markdown
## ${DOCS_DIR}/intent/orders.md#Cancellation (append)
- from: Reservations are released by a job, ruled for the spec
- why: intent does not say what happens to a cancelled order's reservation.

Cancelling an order releases its reservation immediately.
\`\`\`

  The mode is \`append\` (add to the section), \`replace\` (rewrite the section's body) or \`new\` (add a section, or a document that is not there yet). Write the amendment as intent reads: the product's language, present tense, no reference to this spec or its names. An amendment is identified by its heading; leave an applied one alone.
- The user reviews the draft by commenting on its rules and striking the ones that should not be built; comments, strikes and your answers to them live in \`${PLAN_DIR}/${slug}.review.md\`. A submitted review is direction, not a question: revise the spec as it asks, mark every struck rule removed without renaming anything, never bring a struck rule back on your own, and answer every comment in that file as addressed or disagreed with a reason.
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
    `Read it from disk, and \`${PLAN_DIR}/${slug}.review.md\` and \`${PLAN_DIR}/${slug}.intent.md\` where they exist. Then, in chat, where the plan stands in a few sentences: its status, open questions, decisions without a ruling or with one not yet applied, comments not yet answered. An approved spec is settled: change nothing in it unless the user asks.`,
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
    '- Group the rules into scenarios, one `##` per situation from the user\'s side; a small feature has one.',
    '- Nest every edge case under the rule it qualifies, indented as `  - **Name**: ...`. An edge case that qualifies no single rule is a rule of its own.',
    '- Fold invariants and acceptance criteria into the rules they restate; drop what restates without adding. One that is a rule of its own becomes a rule with a name of its own, written `- **New name** (was I3): ...` so what referred to the old name can follow.',
    '- A rule still named by an old id (`- **B5**: ...`) gets a real name the same way, `- **Complexity limit** (was B5): ...`: a few words that say what the rule is about.',
    '- A `## Tasks` section is deleted: tasks live in the tasks file.',
    '- Every name that survives keeps its name; Open questions and Decisions stay as they are.',
    '',
    'Then, in chat, one line per rule that moved, was folded or was named. Then stop.',
  ].join('\n')
}

/** The message the planner gets when a check has written decisions: propose, do not rule. */
export function decisionsHandoffPrompt(feature: string, titles: string[]): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  return [
    `The check of the spec against the code wrote decisions into the Decisions section of \`${spec}\`:`,
    ...titles.map((t) => `- ${t}`),
    '',
    `Read the spec from disk. Under each of these decisions, add a \`- proposed: ...\` line with Edit: how the rules should change, or why they should stand as written, with the reason, in one or two sentences. Change nothing else: the user rules on each proposal, and only then are rules revised.`,
    '',
    'Then stop; the user reads the decisions.',
  ].join('\n')
}

/** The message the planner gets once the user has ruled: apply, mark applied, stop. */
export function rulingsHandoffPrompt(feature: string, rulings: { title: string; ruling: string }[]): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  return [
    `The user ruled on the decisions in \`${spec}\`:`,
    ...rulings.map((r) => `- ${r.title}: ${r.ruling}`),
    '',
    'Read the spec from disk. For each of these decisions, revise the rules it names per its ruling (`accepted` means the proposal as written), append ` [applied]` to its heading, and record an intent amendment where the ruling settles something intent does not say. Touch nothing else in the Decisions section.',
    '',
    'Then, in chat, what changed in the rules, in a few lines, and stop: the board is re-mapped when your turn ends, and the user approves after reading the revised spec.',
  ].join('\n')
}
