import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { DOC_READING } from '../openai-session/tools/markdown/outline-gate'
import { EDIT_WRITING } from '../openai-session/tools/edit'
import { DOCS_DIR, README_GLOB, SPECS_GLOB } from './blind-plan'
import type { Scope } from './scope-guard'
import { SPEC_SEARCH_TOOL } from './spec-search'
import { DECISION_FILES, FUTURE_FILE, UNFILED_FILE } from './unfiled-decisions'

/**
 * Files the user's unfiled decisions and future work into the specs and docs
 * they reach. It reads what a planner reads and no more: what it writes is
 * intent, and a session that had seen the code would write the code's shape into it.
 */

/** `ignored` comes from the `kiwiAgent.planIgnore` setting: docs the planner must not see are not the filing's to write. */
export function fileDecisionsScope(ignored: string[] = []): Scope {
  return {
    readable: [`${DOCS_DIR}/**`, README_GLOB, SPECS_GLOB, ...DECISION_FILES],
    // Deleting an entry that is filed is the session's own bookkeeping.
    writable: [...DECISION_FILES],
    // The specs and docs are the user's: each change is one confirmed write.
    askable: [`${DOCS_DIR}/**`, SPECS_GLOB],
    ignored,
  }
}

export const FILE_DECISIONS_TOOLS = ['Read', 'Glob', MARKDOWN_SEARCH_TOOL, SPEC_SEARCH_TOOL, 'Write', 'Edit', 'MultiEdit', ASK_USER_TOOL]

/** The first message: the two files are the whole assignment. */
export function fileDecisionsKickoff(): string {
  return 'File the unfiled decisions and the future work. Propose where each entry goes first; change nothing yet.'
}

export function fileDecisionsPrompt(cwd: string): string {
  return `You are filing the user's decisions into the intent of a software product, under ${cwd}.

Two files hold what the user decided while a feature was built, or in chat, that reaches beyond the work at hand. \`${UNFILED_FILE}\` holds how the product works, to be filed into the specs it reaches. \`${FUTURE_FILE}\` holds work decided for later, to be planned as features of their own. A feature here is planned blind: the planner reads \`${DOCS_DIR}/**\`, the workspace README, the specs under \`${SPECS_GLOB}\` and these two files, never the code. An entry stays in its file until what it decided stands where a planner looks for it.

Each entry is \`### Title\` with a \`decided\` line and an \`affects\` line. The \`affects\` line names the features it reaches, and says \`docs\` for what no spec holds yet.

What you may read: \`${DOCS_DIR}/**\`, the README, the specs and the two files. \`${MARKDOWN_SEARCH_TOOL}\` finds the doc section an entry belongs in, and ${SPEC_SEARCH_TOOL} the rules it touches. ${DOC_READING} Nothing else exists for you; do not try. ${EDIT_WRITING}

First, in chat, one line per entry: where it goes, as the rule or section it changes or adds, and nothing else. Then stop and wait: the user picks what is filed.

Where an entry goes:
- An entry from \`${FUTURE_FILE}\` is never written into a spec as a rule: a spec's rules are what its build delivers, so a planner would read it as already there. It goes to \`${DOCS_DIR}/\` as what the product should do, and you say it is a feature to plan.
- An entry from \`${UNFILED_FILE}\` amends the rules of each draft, approved or implemented spec it reaches, to the spec contract: a rule's text changes, or an edge case or a rule is added under the scenario it belongs to; a name never changes once written. A plan whose build has started is checked against the code again on its own plan bar once its spec changed: say so when you amend one.
- A verified spec describes a feature that is finished. Do not edit it: say the change is a feature to plan.
- \`${DOCS_DIR}/\`: under a heading of its own that says what it is, so a rule can cite it as \`path#Heading\`. A constraint every feature has to respect, such as which identity provider owns sign-in, belongs in the docs even when specs hold parts of it.
- In the product's language, as the rules and docs around it are written.

Each write into a spec or a doc is confirmed by the user. Once an entry is filed everywhere its \`affects\` line names, delete it from its file with Edit; an entry partly filed keeps the names still to go. If an entry is unclear, or contradicts a spec or doc in a way only the user can settle, ask with \`${ASK_USER_TOOL}\`.`
}
