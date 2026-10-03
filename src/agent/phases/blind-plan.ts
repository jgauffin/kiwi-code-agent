import { join } from 'node:path'
import { KIWI_DIR } from '../kiwi-dir'
import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { DOC_READING } from '../openai-session/tools/markdown/outline-gate'
import { EDIT_WRITING } from '../openai-session/tools/edit'
import SPEC_CONTRACT from '../../../assets/plugin/skills/spec-writing/contract.md'
import { KEEP_RULING } from './ruling'
import type { Scope } from './scope-guard'
import { DECISION_FILES, FUTURE_FILE, UNFILED_DECISIONS, UNFILED_FILE } from './unfiled-decisions'

export const DOCS_DIR = 'docs'
export const SPECS_DIR = 'specs'

/** A feature's working files (review, decisions, tasks): the extension's own, beside its run logs, never committed. */
export const WORK_DIR = `${KIWI_DIR}/${SPECS_DIR}`

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
  return join(cwd, SPECS_DIR, `${featureSlug(feature)}.spec.md`)
}

/** The product's front door counts as intent: what it says it is, not how it is built. */
export const README_GLOB = '{README,ReadMe,Readme,readme}.md'

/** Every feature's spec: an approved one is that feature's definition, so a later planner reads it as it reads the docs. */
export const SPECS_GLOB = `${SPECS_DIR}/*.spec.md`

/**
 * The spec search tool by name. Spelled here rather than imported: the tool reads specs through the
 * spec model, which reads this module, and a constant taken back from it would be read before it is set.
 */
const SPEC_SEARCH = 'SpecSearch'

/**
 * Said to every session that changes code or plans a change, so a rule the user approved is not broken by
 * one that never knew it was there. Said even before the first spec exists: the specs are what blind
 * planning builds up, and a project has none only once.
 */
export const SPEC_READING = `The approved specs under \`${SPECS_GLOB}\` define what the product does, one named rule per line; a draft is still a proposal. Before you change how something behaves, or plan to, find the rules that cover it with ${SPEC_SEARCH}: it returns each matching rule whole, with its edge cases, its scenario and its spec's status, so a spec needs reading only for what its rules leave out. Keep to those rules. Breaking one is the user's call: ask first.`

/** Said to a session that can write the specs, after SPEC_READING: what follows once the user agrees. */
export const SPEC_AMENDING = `Once the user agrees to break a rule, amend it in its spec, keeping its name, or record the decision as unfiled when it reaches features beyond the one you are changing.`

/** `ignored` comes from the `kiwiAgent.planIgnore` setting: docs the planner must not see. */
export function blindPlanScope(feature: string, ignored: string[] = []): Scope {
  const slug = featureSlug(feature)
  // The review file holds the human's comments and the planner's resolutions to them.
  // The decisions file holds what the mapping found; the planner proposes on it and reads the rulings from it.
  const own = [`${SPECS_DIR}/${slug}.spec.md`, `${WORK_DIR}/${slug}.review.md`, `${WORK_DIR}/${slug}.decisions.md`]
  return {
    readable: [`${DOCS_DIR}/**`, README_GLOB, SPECS_GLOB, ...DECISION_FILES, ...own],
    // An answer that reaches beyond this feature is recorded for the features it reaches, or as work for later.
    writable: [...own, ...DECISION_FILES],
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
export const BLIND_PLAN_TOOLS = ['Read', 'Glob', MARKDOWN_SEARCH_TOOL, SPEC_SEARCH, 'JsonSchema', 'JsonQuery', 'Write', 'Edit', 'MultiEdit', ASK_USER_TOOL]

/**
 * Phase 1 system prompt. Short on purpose: it states the job and the output
 * contract and leaves the reasoning to the model. Direction is proposed in
 * chat before any file is written, so the user steers while it is cheap.
 */
export function blindPlanPrompt(feature: string, cwd: string): string {
  const slug = featureSlug(feature)
  return `You are planning the feature "${feature}" for a software product, blind to its source code.

A planner that reads the code inherits the code's mistakes as constraints, and the feature gets shaped to fit the defects. 
You derive what the feature should do from intent alone, so that a later phase can compare intent with the code and name every 
disagreement instead of silently absorbing it.

What you may read: \`${DOCS_DIR}/**\` (product intent: goals, ubiquitous language, rules, constraints, feature descriptions), the README in the 
workspace root (what the product is, in its own words), every feature's spec under \`${SPECS_GLOB}\` (a spec the user has approved is that
feature's definition, as settled as a doc; a draft is a proposal still being planned), \`${UNFILED_FILE}\` (decisions the user made while building
or in chat, not yet filed into the specs and docs they reach: the user's latest word, so an entry outweighs a doc or a spec that says otherwise),
\`${FUTURE_FILE}\` (work the user decided on for later, not yet built or planned) and your own plan files. Nothing else exists for you; do not try.
The docs map in this prompt shows every doc; use Glob with path \`${SPECS_DIR}\` to see which features have a spec. Search the docs with \`${MARKDOWN_SEARCH_TOOL}\` and the specs
with ${SPEC_SEARCH} for the feature's terms rather than reading file after file. ${DOC_READING} ${EDIT_WRITING}
Where a doc and an approved spec disagree, ask: the user knows which is current, you do not.

Your input: the user's first message describes the feature or user story. Later messages steer, answer your questions or ask for changes.

First, direction. In chat, not in a file: the few decisions that shape the feature (what it is, what it is not, where it could go two ways and which way 
you propose, with the reason) and the questions whose answer would change that, asked in the message itself. A short message, then stop and wait. Write nothing until the user says go:
a full plan in the wrong direction is wasted, so the user steers first. \`${ASK_USER_TOOL}\` is for what comes up once you write the spec.

Then, the spec. When the user accepts or adjusts the direction, write one file, \`${SPECS_DIR}/${slug}.spec.md\` under ${cwd}, with Write. ${SPEC_CONTRACT.trim().replaceAll('<feature>', feature)}
- Settle what you can. Where intent is silent but a sensible default exists, take it and say so in the direction; a question is for what only the user can answer, and you put it with the \`${ASK_USER_TOOL}\` tool and carry on with the answer rather than writing it down and stopping.
- The user's answers become rules in this spec. The part of an answer that reaches features other than this one is recorded for them: ${UNFILED_DECISIONS}
- Once approved, the spec is checked against the code by a separate run, which writes what stands in its way to \`${WORK_DIR}/${slug}.decisions.md\` for the user to rule on. Those decisions reach you as hand-offs that say what to do, proposing ways to settle them or applying the user's rulings. Change no rule until the user has ruled.
- \`${DOCS_DIR}/\` is the user's. You edit it only when the user asks you to, and each write is confirmed by them.
- The user reviews a draft by commenting on its rules and striking the ones that should not be built, in \`${WORK_DIR}/${slug}.review.md\`. A submitted review reaches you as a hand-off that says what to do; a struck rule never comes back on your own.
- If neither the docs nor the specs have anything on this feature, or the description is too thin to derive a direction, do not invent: ask with \`${ASK_USER_TOOL}\` and work from the answer.
- After each write, summarise what changed in a few sentences and stop.`
}

/**
 * The first message of a plan session picked up on a spec another session
 * wrote: the files are the state, so the planner reads them and reports where
 * the plan stands instead of starting the feature over.
 */
export function resumePlanPrompt(feature: string, present: { review: boolean; decisions: boolean }): string {
  const slug = featureSlug(feature)
  // Only the files that exist are named, so no Read is spent on one that is not there.
  const files = [`\`${SPECS_DIR}/${slug}.spec.md\``, ...(present.review ? [`\`${WORK_DIR}/${slug}.review.md\``] : []), ...(present.decisions ? [`\`${WORK_DIR}/${slug}.decisions.md\``] : [])]
  const read = files.length === 1 ? files[0]! : `${files.slice(0, -1).join(', ')} and ${files.at(-1)!}`
  return [
    `The spec for "${feature}" already exists at \`${SPECS_DIR}/${slug}.spec.md\`, written in an earlier session that is gone. Do not start over.`,
    '',
    `Read ${read} from disk, in one reply. Then, in chat, where the plan stands in a few sentences: its status, open questions${present.decisions ? ', decisions without a ruling or with one not yet applied' : ''}${present.review ? ', comments not yet answered' : ''}. A spec the user has approved is settled: change nothing in it unless the user asks.`,
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
  const spec = `${SPECS_DIR}/${featureSlug(feature)}.spec.md`
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
    `Read that file and the spec from disk. Under each of these decisions, add one to three \`- proposed: ...\` lines with Edit, each a distinct way to settle it written as the rule's new text as it would stand in the spec, one sentence with no argument and no reference to the decision: observable behaviour, not how it is built, since storage and structure are the task's. Keeping the rule is offered to the user by itself; do not propose it.`,
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
  const spec = `${SPECS_DIR}/${slug}.spec.md`
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
 * so the user updates them, or asks the planner to. A section the spec
 * covers and a section it contradicts are not the same finding: only the
 * first can go on the user's word, since a contradiction means one of the
 * two records is wrong and only the user knows which.
 */
export function docsReviewPrompt(feature: string): string {
  const spec = `${SPECS_DIR}/${featureSlug(feature)}.spec.md`
  return [
    `The spec at \`${spec}\` is approved and is now the definition of "${feature}".`,
    '',
    `Read again the doc sections the spec's rules cite, each by its line range in the docs map, and list in chat, one line per section: what the spec now covers, naming the rules, and can go; and, separately, what now reads otherwise than the spec, reported but never offered to go, since which side is current is the user's to say. Edit nothing. If nothing needs to change, say so in one line.`,
    '',
    `The user updates the docs, or asks you to: then edit only what you listed, and each write is confirmed by them. If they say a section that reads otherwise is current, record the ruling as an unfiled decision naming "${feature}" in \`${UNFILED_FILE}\`, as your instructions on unfiled decisions say.`,
  ].join('\n')
}

/**
 * The message the planner gets on approval when the user chose to cut the
 * docs a spec covers: two records of one rule drift apart, and the spec is
 * the one the build keeps honest. The spec itself is not touched: any change
 * to it, citations included, sends it back to the check against the code. A
 * section that contradicts the spec is never cut outright, since a
 * contradiction is not settled until the user says which side is current.
 */
export function docsCutPrompt(feature: string): string {
  const spec = `${SPECS_DIR}/${featureSlug(feature)}.spec.md`
  return [
    `The spec at \`${spec}\` is approved and is now the definition of "${feature}".`,
    '',
    `Read again the doc sections the spec's rules cite, each by its line range in the docs map, and cut each section the spec now covers down to what no spec holds: the domain brief, constraints every feature has to respect, features not yet planned. Delete a section left with nothing. Leave the spec as it is: a citation into a cut section stays as the record of where the rule came from.`,
    '',
    `A section that now reads otherwise than the spec is never cut: report it in chat instead, since which side is current is the user's to say. If they say the doc is current, record the ruling as an unfiled decision naming "${feature}" in \`${UNFILED_FILE}\`, as your instructions on unfiled decisions say.`,
    '',
    'Each edit is confirmed by the user. Then, in chat, one line per doc section you cut, and stop.',
  ].join('\n')
}

/** What the planner is asked about the docs on approval, per `kiwiAgent.cutCoveredDocs`. */
export function docsAfterApprovalPrompt(feature: string, cutCoveredDocs: boolean): string {
  return cutCoveredDocs ? docsCutPrompt(feature) : docsReviewPrompt(feature)
}
