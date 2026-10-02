import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { DOC_READING } from '../openai-session/tools/markdown/outline-gate'
import { EDIT_WRITING } from '../openai-session/tools/edit'
import { DOCS_DIR, README_GLOB, SPECS_GLOB } from './blind-plan'
import type { Scope } from './scope-guard'
import { UNFILED_FILE } from './unfiled-decisions'

/**
 * Files the user's unfiled decisions into the specs and docs they reach. It
 * reads what a planner reads and no more: what it writes is intent, and a
 * session that had seen the code would write the code's shape into it.
 */

/** `ignored` comes from the `kiwiAgent.planIgnore` setting: docs the planner must not see are not the filing's to write. */
export function fileDecisionsScope(ignored: string[] = []): Scope {
  return {
    readable: [`${DOCS_DIR}/**`, README_GLOB, SPECS_GLOB, UNFILED_FILE],
    // Deleting an entry that is filed is the session's own bookkeeping.
    writable: [UNFILED_FILE],
    // The specs and docs are the user's: each change is one confirmed write.
    askable: [`${DOCS_DIR}/**`, SPECS_GLOB],
    ignored,
  }
}

export const FILE_DECISIONS_TOOLS = ['Read', 'Glob', MARKDOWN_SEARCH_TOOL, 'Write', 'Edit', 'MultiEdit', ASK_USER_TOOL]

/** The first message: the file is the whole assignment. */
export function fileDecisionsKickoff(): string {
  return 'File the unfiled decisions. Propose where each one goes first; change nothing yet.'
}

export function fileDecisionsPrompt(cwd: string): string {
  return `You are filing the user's decisions into the intent of a software product, under ${cwd}.

\`${UNFILED_FILE}\` holds decisions the user made while a feature was built or in chat that reach features other than the one at hand. A feature here is planned blind: the planner reads \`${DOCS_DIR}/**\`, the workspace README and the specs under \`${SPECS_GLOB}\`, never the code. An entry stays in the unfiled file until what it decided stands where a planner looks for it.

Each entry is \`### Title\` with a \`decided\` line, an \`affects\` line naming the features it reaches, and \`docs\` for what no spec holds yet, and a \`built\` line saying whether the product already works this way.

What you may read: \`${DOCS_DIR}/**\`, the README, the specs and the unfiled file. The docs map above gives you every doc and every section. ${DOC_READING} Nothing else exists for you; do not try. ${EDIT_WRITING}

First, in chat, one line per entry: where it goes, as the rule or section it changes or adds, and nothing else. Then stop and wait: the user picks what is filed.

Where an entry goes:
- \`built: false\` is never written into a spec as a rule: a spec's rules are what its build delivers, so a planner would read it as already there. It goes to \`${DOCS_DIR}/\` as what the product should do, and you say it is a feature to plan.
- \`built: true\` on a spec still being planned or built: its rules are amended to the spec contract. A rule's text changes, or an edge case or a rule is added under the scenario it belongs to; a name never changes once written. A plan whose build has started is checked against the code again on its own plan bar once its spec changed: say so when you amend one.
- A verified spec describes a feature that is finished. Do not edit it: say the change is a feature to plan.
- \`${DOCS_DIR}/\`: under a heading of its own that says what it is, so a rule can cite it as \`path#Heading\`. A constraint every feature has to respect, such as which identity provider owns sign-in, belongs in the docs even when specs hold parts of it.
- In the product's language, as the rules and docs around it are written.

Each write into a spec or a doc is confirmed by the user. Once an entry is filed everywhere its \`affects\` line names, delete it from the unfiled file with Edit; an entry partly filed keeps the names still to go. If an entry is unclear, or contradicts a spec or doc in a way only the user can settle, ask with \`${ASK_USER_TOOL}\`.`
}
