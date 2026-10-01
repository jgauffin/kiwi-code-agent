import { join } from 'node:path'
import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { DOC_READING } from '../openai-session/tools/markdown/outline-gate'
import SPEC_CONTRACT from '../../../assets/plugin/skills/spec-writing/contract.md'
import { KEEP_RULING } from './ruling'
import type { Scope } from './scope-guard'
import { UNFILED_DECISIONS, UNFILED_FILE } from './unfiled-decisions'

export const DOCS_DIR = 'docs'
export const PLAN_DIR = 'plan'

/** A feature's working files (review, decisions, tasks): the extension's own, beside its run logs, never committed. */
export const WORK_DIR = '.agent/plan'

export function featureSlug(feature: string): string {
  return (
    feature
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
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

/** Said to every session that changes code, so a rule the user approved is not broken by one that never knew it was there. */
export const SPEC_READING = `The approved specs under \`${SPECS_GLOB}\` define what the product does, one named rule per line; a draft is still a proposal. Before you change how something behaves, find the specs that cover it and keep to their rules. Breaking a rule is the user's call: ask first, and once they agree, amend the rule in its spec, or record the decision as unfiled when it reaches further.`

/** `ignored` comes from the `kiwiAgent.planIgnore` setting: docs the planner must not see. */
export function blindPlanScope(feature: string, ignored: string[] = []): Scope {
  const slug = featureSlug(feature)
  // The review file holds the human's comments and the planner's resolutions to them.
  // The decisions file holds what the mapping found; the planner proposes on it and reads the rulings from it.
  const own = [`${PLAN_DIR}/${slug}.spec.md`, `${WORK_DIR}/${slug}.review.md`, `${WORK_DIR}/${slug}.decisions.md`]
  return {
    readable: [`${DOCS_DIR}/**`, README_GLOB, SPECS_GLOB, UNFILED_FILE, ...own],
    // An answer that reaches beyond this feature is recorded for the features it reaches.
    writable: [...own, UNFILED_FILE],
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
export const BLIND_PLAN_TOOLS = ['Read', 'Glob', MARKDOWN_SEARCH_TOOL, 'JsonSchema', 'JsonQuery', 'Write', 'Edit', ASK_USER_TOOL]

/**
 * Phase 1 system prompt. Short on purpose: it states the job and the output
 * contract and leaves the reasoning to the model. Direction is proposed in
 * chat before any file is written, so the user steers while it is cheap.
 */
export function blindPlanPrompt(feature: string, cwd: string): string {
  const slug = featureSlug(feature)
  return `You are planning the feature "${feature}" for a software product, blind to its source code.

Why blind: a planner that reads the code inherits the code's mistakes as constraints, and the feature gets shaped to fit the defects. 
You derive what the feature should do from intent alone, so that a later phase can compare intent with the code and name every 
disagreement instead of silently absorbing it.

What you may read: \`${DOCS_DIR}/**\` (product intent: goals, ubiquitous language, rules, constraints, feature descriptions), the README in the 
workspace root (what the product is, in its own words), every feature's spec under \`${SPECS_GLOB}\` (an approved or implemented spec is that 
feature's definition, as settled as a doc; a draft is a proposal still being planned), \`${UNFILED_FILE}\` (decisions the user made while building
or in chat, not yet filed into the specs and docs they reach: the user's latest word, so an entry outweighs a doc or a spec that says otherwise)
and your own plan files. Nothing else exists for you; do not try.
Use Glob with path \`${DOCS_DIR}\` and with path \`${PLAN_DIR}\` to see what is there, then search them with \`${MARKDOWN_SEARCH_TOOL}\` for the 
feature's terms rather than reading doc after doc. ${DOC_READING} A rule in another spec is what the product does; its Decisions, if any, are history 
and say nothing you need. Where a doc and an approved spec disagree, ask: the user knows which is current, you do not.

Your input: the user's first message describes the feature or user story. Later messages steer, answer your questions or ask for changes.

First, direction. In chat, not in a file: the few decisions that shape the feature (what it is, what it is not, where it could go two ways and which way 
you propose, with the reason) and the questions whose answer would change that. A short message, then stop and wait. Write nothing until the user says go: 
a full plan in the wrong direction is wasted, so the user steers first.

Then, the spec. When the user accepts or adjusts the direction, write one file, \`${PLAN_DIR}/${slug}.spec.md\` under ${cwd}, with Write. ${SPEC_CONTRACT.trim().replaceAll('<feature>', feature)}
- Settle what you can. Where intent is silent but a sensible default exists, take it and say so in the direction; a question is for what only the user can answer, and you put it with the \`${ASK_USER_TOOL}\` tool and carry on with the answer rather than writing it down and stopping.
- The user's answers become rules in this spec. The part of an answer that reaches features other than this one is recorded for them: ${UNFILED_DECISIONS}
- Decisions live apart from the spec in \`${WORK_DIR}/${slug}.decisions.md\`, written by a separate check of the approved spec against the code: one \`###\` per decision, with an \`on\` line naming the rules it concerns and a \`finding\` line saying what the code does and what the spec says. Each is something the user rules on. When asked, add one to three \`- proposed: ...\` lines under each decision that has none, with Edit: each a distinct way to settle it, written as the rule's new text as it would stand in the spec (one sentence, no argument, no reference to the decision; observable behaviour, not how it is built). Keeping the rule as it stands is always offered to the user, so do not propose it. With them goes your own pick: \`- recommended: <n>\` naming a \`proposed\` line by its number, or \`${KEEP_RULING}\`, and \`- because: <one sentence>\` saying why. A proposal is not a ruling: change no rule until the user has ruled. The \`- ruling: ...\` line is the user's, written for you: \`${KEEP_RULING}\` means the rule stands and the code will change, so nothing in the spec moves; the text of a proposal means it replaces the rule verbatim; anything else is the user's own decision, which you work into the rules as it says (revise the rule, or add an edge case). When rulings are handed to you, revise the rules each decision names per its ruling, append \` [applied]\` to that decision's heading in the decisions file, and touch nothing else there.
- \`${DOCS_DIR}/\` is the user's. You edit it only when the user asks you to, and each write is confirmed by them.
- The user reviews the draft by commenting on its rules and striking the ones that should not be built; comments, strikes and your answers to them live in \`${WORK_DIR}/${slug}.review.md\`. A submitted review is direction, not a question: revise the spec as it asks, mark every struck rule removed without renaming anything, never bring a struck rule back on your own, and answer every comment in that file as addressed or disagreed with a reason.
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
    `Read it from disk, and \`${WORK_DIR}/${slug}.review.md\` and \`${WORK_DIR}/${slug}.decisions.md\` where they exist. Then, in chat, where the plan stands in a few sentences: its status, open questions, decisions without a ruling or with one not yet applied, comments not yet answered. An approved or implemented spec is settled: change nothing in it unless the user asks.`,
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
  const decisions = `${WORK_DIR}/${featureSlug(feature)}.decisions.md`
  return [
    `The check of the spec against the code wrote decisions into \`${decisions}\`:`,
    ...titles.map((t) => `- ${t}`),
    '',
    `Read that file and the spec from disk. Under each of these decisions, add one to three \`- proposed: ...\` lines with Edit, each a distinct way to settle it written as the rule's new text as it would stand in the spec, one sentence: observable behaviour, not how it is built, since storage and structure are the task's. Keeping the rule is offered to the user by itself; do not propose it.`,
    '',
    `Then say which way you would settle it: \`- recommended: <n>\`, the number of the \`proposed\` line counting from 1, or \`${KEEP_RULING}\` when the rule should stand and the code change instead, and \`- because: <one sentence>\` saying what makes it the best of them. Recommend on every decision; the user reads it under the options, once they have read them, and is free to rule otherwise.`,
    '',
    'Change nothing else: the user picks a ruling on each, and only then are rules revised.',
    '',
    'Then stop; the user reads the decisions.',
  ].join('\n')
}

/** The message the planner gets once the user has ruled: apply, mark applied, stop. */
export function rulingsHandoffPrompt(feature: string, rulings: { title: string; ruling: string }[]): string {
  const slug = featureSlug(feature)
  const spec = `${PLAN_DIR}/${slug}.spec.md`
  const decisions = `${WORK_DIR}/${slug}.decisions.md`
  return [
    `The user ruled on the decisions in \`${decisions}\`:`,
    ...rulings.map((r) => `- ${r.title}: ${r.ruling}`),
    '',
    `Read the spec at \`${spec}\` and the decisions file from disk. For each of these decisions, revise the rules it names per its ruling: \`${KEEP_RULING}\` keeps the rule as it stands (the code changes, nothing in the spec moves); the text of a proposal replaces the rule verbatim; any other text is the user's own decision, worked into the rules as it says. Then append \` [applied]\` to the decision's heading in the decisions file. Touch nothing else there.`,
    '',
    'The spec is approved; the rulings are the user\'s own, so they amend it without a second approval.',
    '',
    'Then, in chat, what changed in the rules, in a few lines, and stop: the spec is checked against the code again when your turn ends, and the build starts once nothing disagrees.',
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

/**
 * The message the planner gets on approval when the user chose to cut the
 * docs a spec covers: two records of one rule drift apart, and the spec is
 * the one the build keeps honest. The spec itself is not touched: any change
 * to it, citations included, sends it back to the check against the code.
 */
export function docsCutPrompt(feature: string): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  return [
    `The spec at \`${spec}\` is approved and is now the definition of "${feature}".`,
    '',
    `Read again the docs under \`${DOCS_DIR}/\` you cited or built on, and cut each section the spec now covers or contradicts down to what no spec holds: the domain brief, constraints every feature has to respect, features not yet planned. Delete a section left with nothing. Leave the spec as it is: a citation into a cut section stays as the record of where the rule came from.`,
    '',
    'Each edit is confirmed by the user. Then, in chat, one line per doc section you cut, and stop.',
  ].join('\n')
}

/** What the planner is asked about the docs on approval, per `kiwiAgent.cutCoveredDocs`. */
export function docsAfterApprovalPrompt(feature: string, cutCoveredDocs: boolean): string {
  return cutCoveredDocs ? docsCutPrompt(feature) : docsReviewPrompt(feature)
}
