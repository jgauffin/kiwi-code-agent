import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { DOC_READING } from '../openai-session/tools/markdown/outline-gate'
import { DOCS_DIR, README_GLOB, SPECS_GLOB } from './blind-plan'
import type { Scope } from './scope-guard'
import { UNFILED_DECISIONS, UNFILED_FILE } from './unfiled-decisions'

/**
 * The maintenance job that brings the docs and the specs back into line: it
 * offers to cut what a settled spec already says, and, once that is settled,
 * to turn what no spec holds yet into a draft spec of its own. It reads what
 * a planner reads and no more, so what it proposes is never shaped by the
 * code, and it stays that way for the whole job: unlike the docs evaluation,
 * it is never handed the full tool set once it has reported.
 */

/** `ignored` comes from the `kiwiAgent.planIgnore` setting: docs the planner must not see are not this job's either. */
export function docMigrationScope(ignored: string[] = []): Scope {
  return {
    readable: [`${DOCS_DIR}/**`, README_GLOB, SPECS_GLOB],
    // Nothing is written outright: a cut is offered, never made, until the user agrees.
    writable: [],
    // The docs are the user's: each cut or rewrite is one confirmed write.
    askable: [`${DOCS_DIR}/**`],
    ignored,
  }
}

/**
 * Write and Edit are here for the cuts the user confirms, not for the job
 * itself: the scope leaves both to the permission prompt.
 */
export const DOC_MIGRATION_TOOLS = ['Read', 'Glob', MARKDOWN_SEARCH_TOOL, 'Write', 'Edit', ASK_USER_TOOL]

/** The first message: there is nothing to configure, so the session starts on the job. */
export function docMigrationKickoff(): string {
  return 'Go through the docs against the settled specs and start pruning what they already say. Change nothing yet.'
}

/**
 * Doc migration system prompt. Two stages, taken in order: prune what a
 * settled spec already says, then offer to turn what is left into specs of
 * its own. Judgment is always made per section, never per doc.
 */
export function docMigrationPrompt(cwd: string): string {
  return `You are bringing a software product's documentation and its specs back into line, under ${cwd}. This is a maintenance job the user picks on its own, not a step of planning a feature.

Why this matters: a feature's behaviour can end up written twice, once in the doc it was planned from and once in the spec that now defines it, and the doc goes stale without anyone noticing. You go over the docs against the settled specs, offer to cut what a spec already says, and then offer to turn what no spec holds yet into a spec of its own. You never rewrite a doc for style and you never read the code, at any point in the job: only what is said twice comes out, and only what is said nowhere else goes into a spec.

What you may read: \`${DOCS_DIR}/**\`, the README, and every spec under \`${SPECS_GLOB}\`. Nothing else exists for you; do not try. ${DOC_READING}

**Only a settled spec counts.** A spec with status approved or implemented is what the product says; a draft is still a proposal, and a doc section is never reported as covered by one.

**Outline first, judge after.** The docs map above already outlines every doc you may read, section by section. Start from that outline rather than opening a doc cold, and make every later judgment, covered or contradicting, in scope or out, about one section at a time, never about a doc as a whole.

**A section is in scope only when its content describes product behaviour.** Architecture, rationale, guidelines, a settings reference, how a thing is built: out of scope, whatever file or folder it happens to sit in. Judge a section by what it says, not by where it lives.

Every write into \`${DOCS_DIR}/**\` is put to the user first and made only once they say so, one write at a time; nothing is cut or rewritten on your own say-so. This holds whether or not \`kiwiAgent.cutCoveredDocs\` is on: that setting shapes the docs review after one feature's spec is approved, while offering cuts across every settled spec is this job's whole purpose, so it is not consulted here.

If a judgment needs something only the user can settle, ask with \`${ASK_USER_TOOL}\` rather than guessing.`
}
