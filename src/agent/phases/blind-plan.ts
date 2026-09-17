import { join } from 'node:path'
import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { KEEP_RULING } from './ruling'
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

/** Every feature's spec: an approved one is that feature's definition, so a later planner reads it as it reads the docs. */
export const SPECS_GLOB = `${PLAN_DIR}/*.spec.md`

/** `ignored` comes from the `kiwiAgent.planIgnore` setting: docs the planner must not see. */
export function blindPlanScope(feature: string, ignored: string[] = []): Scope {
  const slug = featureSlug(feature)
  // The review file holds the human's comments and the planner's resolutions to them.
  // The decisions file holds what the mapping found; the planner proposes on it and reads the rulings from it.
  const own = [`${PLAN_DIR}/${slug}.spec.md`, `${PLAN_DIR}/${slug}.review.md`, `${PLAN_DIR}/${slug}.decisions.md`]
  return {
    readable: [`${DOCS_DIR}/**`, README_GLOB, SPECS_GLOB, ...own],
    writable: own,
    // The docs are the user's: the planner edits them only when asked, one confirmed write at a time.
    askable: [`${DOCS_DIR}/**`],
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

What you may read: \`${DOCS_DIR}/**\` (product intent: goals, ubiquitous language, rules, constraints, feature descriptions), the README in the workspace root (what the product is, in its own words), every feature's spec under \`${SPECS_GLOB}\` (an approved spec is that feature's definition, as settled as a doc; a draft is a proposal still being planned) and your own plan files. Nothing else exists for you; do not try. Use Glob with path \`${DOCS_DIR}\` and with path \`${PLAN_DIR}\` to see what is there, then Read what is relevant. A rule in another spec is what the product does; its Decisions, if any, are history and say nothing you need. Where a doc and an approved spec disagree, ask: the user knows which is current, you do not.

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
- Rules are few and coarse, each one something a single test can prove, and each one sentence: what the rule has to survive is an edge case, and why it holds is not written in the spec. There are no invariants, acceptance criteria or task sections: an invariant is a rule, an acceptance criterion restates one, and the tests that prove each rule are the implementer's evidence, recorded on the tasks later. Anything else is reported back to you as off contract.
- Only Goal and one scenario are always there. Open questions exists when there is one, and holds only what is still unanswered: a question the user answered becomes a rule or an edge case.

Rules:
- To the point, not complete. A rule earns its place only if leaving it out would change what gets built or how it is tested. Do not restate a rule as an edge case, do not spec the obvious, do not cover every situation that could be imagined. A feature described in two sentences is usually a page, not five.
- No tasks: what to do and where is settled when the spec is mapped against the code, in a file of its own. A task written blind would only restate the rules.
- Settle what you can. Where intent is silent but a sensible default exists, take it and say so in the direction; a question is for what only the user can answer, and you put it with the \`${ASK_USER_TOOL}\` tool and carry on with the answer rather than writing it down and stopping.
- Every rule, edge case and question has a name, the bold lead-in of its line: a few words that say what it is about, unique in the spec, the way a test or a function is named. The name is what a comment, a task, a test and a decision refer to, so it never changes once written: on revision you add, or mark a rule \` [removed]\`, never rename or delete. A rule you must rename keeps the old name in a note after the new one, \`- **New name** (was Old name): ...\`, and the extension follows the rename through every file. Moving a rule to another scenario keeps its name.
- A rule that comes from a section of \`${DOCS_DIR}/**\` or of another feature's spec ends with its citation in parentheses, as \`(path#Heading)\`, after the text. A rule without a citation is your own default. The citation is what a later check against the code reads instead of the docs, so it must be exact.
- No code paths, class names or code: that is the implementation's business and you cannot know it.
- Decisions live beside the spec in \`${PLAN_DIR}/${slug}.decisions.md\`, written by a separate check of the spec against the code: one \`###\` per decision, with an \`on\` line naming the rules it concerns and a \`finding\` line saying what the code does and what the spec says. Each is something the user rules on. When asked, add one to three \`- proposed: ...\` lines under each decision that has none, with Edit: each a distinct way to settle it, written as the rule's new text as it would stand in the spec (one sentence, no argument, no reference to the decision). Keeping the rule as it stands is always offered to the user, so do not propose it. A proposal is not a ruling: change no rule until the user has ruled. The \`- ruling: ...\` line is the user's, written for you: \`${KEEP_RULING}\` means the rule stands and the code will change, so nothing in the spec moves; the text of a proposal means it replaces the rule verbatim; anything else is the user's own decision, which you work into the rules as it says (revise the rule, or add an edge case). When rulings are handed to you, revise the rules each decision names per its ruling, append \` [applied]\` to that decision's heading in the decisions file, and touch nothing else there.
- \`${DOCS_DIR}/\` is the user's. You edit it only when the user asks you to, and each write is confirmed by them.
- The user reviews the draft by commenting on its rules and striking the ones that should not be built; comments, strikes and your answers to them live in \`${PLAN_DIR}/${slug}.review.md\`. A submitted review is direction, not a question: revise the spec as it asks, mark every struck rule removed without renaming anything, never bring a struck rule back on your own, and answer every comment in that file as addressed or disagreed with a reason.
- If neither the docs nor the specs have anything on this feature, or the description is too thin to derive a direction, do not invent: ask with \`${ASK_USER_TOOL}\` and work from the answer.
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
    `Read it from disk, and \`${PLAN_DIR}/${slug}.review.md\` and \`${PLAN_DIR}/${slug}.decisions.md\` where they exist. Then, in chat, where the plan stands in a few sentences: its status, open questions, decisions without a ruling or with one not yet applied, comments not yet answered. An approved spec is settled: change nothing in it unless the user asks.`,
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
    '- A `## Tasks` section is deleted: tasks live in the tasks file. A `## Decisions` section is left as it is: the extension moves it.',
    '- Every name that survives keeps its name; Open questions stay as they are.',
    '',
    'Then, in chat, one line per rule that moved, was folded or was named. Then stop.',
  ].join('\n')
}

/** The message the planner gets when a check has written decisions: propose, do not rule. */
export function decisionsHandoffPrompt(feature: string, titles: string[]): string {
  const decisions = `${PLAN_DIR}/${featureSlug(feature)}.decisions.md`
  return [
    `The check of the spec against the code wrote decisions into \`${decisions}\`:`,
    ...titles.map((t) => `- ${t}`),
    '',
    `Read that file and the spec from disk. Under each of these decisions, add one to three \`- proposed: ...\` lines with Edit, each a distinct way to settle it written as the rule's new text as it would stand in the spec, one sentence. Keeping the rule is offered to the user by itself; do not propose it. Change nothing else: the user picks a ruling on each, and only then are rules revised.`,
    '',
    'Then stop; the user reads the decisions.',
  ].join('\n')
}

/** The message the planner gets once the user has ruled: apply, mark applied, stop. */
export function rulingsHandoffPrompt(feature: string, rulings: { title: string; ruling: string }[]): string {
  const slug = featureSlug(feature)
  const spec = `${PLAN_DIR}/${slug}.spec.md`
  const decisions = `${PLAN_DIR}/${slug}.decisions.md`
  return [
    `The user ruled on the decisions in \`${decisions}\`:`,
    ...rulings.map((r) => `- ${r.title}: ${r.ruling}`),
    '',
    `Read the spec at \`${spec}\` and the decisions file from disk. For each of these decisions, revise the rules it names per its ruling: \`${KEEP_RULING}\` keeps the rule as it stands (the code changes, nothing in the spec moves); the text of a proposal replaces the rule verbatim; any other text is the user's own decision, worked into the rules as it says. Then append \` [applied]\` to the decision's heading in the decisions file. Touch nothing else there.`,
    '',
    'Then, in chat, what changed in the rules, in a few lines, and stop: the board is re-mapped when your turn ends, and the user approves after reading the revised spec.',
  ].join('\n')
}

/**
 * The message the planner gets when the spec is approved: the docs it was
 * planned from may now say less, or otherwise, than the spec. Listed in chat
 * so the user updates them, or asks the planner to.
 */
export function docsReviewPrompt(feature: string): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  return [
    `The spec at \`${spec}\` is approved and is now the definition of "${feature}".`,
    '',
    `Read again the docs under \`${DOCS_DIR}/\` you cited or built on, and list in chat, one line per doc section, what now reads differently from the spec or is covered by it and can go. Edit nothing. If nothing needs to change, say so in one line.`,
    '',
    'The user updates the docs, or asks you to: then edit only what you listed, and each write is confirmed by them.',
  ].join('\n')
}
