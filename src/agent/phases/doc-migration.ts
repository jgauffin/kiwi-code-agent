import { join } from 'node:path'
import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { DOC_READING } from '../openai-session/tools/markdown/outline-gate'
import { EDIT_WRITING } from '../openai-session/tools/edit'
import SPEC_CONTRACT from '../../../assets/plugin/skills/spec-writing/contract.md'
import { readOptional } from '../workspace-files'
import { DOCS_DIR, SPECS_DIR, SPECS_ANY_GLOB, README_GLOB, REFERENCE_DIRECTION, SPECS_GLOB } from './blind-plan'
import { decisionsPath, readDecisions } from './decisions'
import { featureNameOf, specFiles } from './plan-list'
import { readReview, reviewPath } from './plan-review'
import { planStage, type PlanStage } from './plan-stage'
import type { Scope } from './scope-guard'
import type { SpecFoldersMode, SpecFoldersSetting } from './spec-folders'
import { bodyOf, builtOf, statusOf, type SpecState } from './spec-file'
import { readTasks, tasksPath } from './tasks-file'
import { DECISION_FILES, UNFILED_DECISIONS, UNFILED_FILE } from './unfiled-decisions'
import { SPEC_SEARCH_TOOL } from './spec-search'

/**
 * Cleaning up the docs, the maintenance job that leaves behaviour in the specs
 * and everything else in the docs, easy to find and cite. Three stages, in
 * order: cut what a settled spec already says, turn behaviour no spec holds
 * into draft specs, and tidy how what stays is arranged for a blind planner.
 * It reads what a planner reads and no more, so what it proposes is never
 * shaped by the code, and it stays that way for the whole job.
 *
 * The mode keeps the name `doc-migration`, so saved sessions still open; what
 * the person sees calls it cleaning up the docs.
 */

/**
 * Where the job's drafts land. `by-domain` and `flat` are `kiwiAgent.specFolders`
 * resolved; `root-first` is a workspace following its default whose specs all
 * sit at the root: drafts stay there until the person takes the offer to sort
 * the specs into folders or names one, since this job is where a workspace
 * written before folders adopts them. Only a setting of `flat` rules folders out.
 */
export type DraftFolders = SpecFoldersMode | 'root-first'

export function draftFolders(setting: SpecFoldersSetting, mode: SpecFoldersMode): DraftFolders {
  return setting === 'default' && mode === 'flat' ? 'root-first' : mode
}

/**
 * `ignored` comes from the `kiwiAgent.planIgnore` setting: docs the planner
 * must not see are not this job's either. Unless folders are ruled out, a
 * migrated draft or a picked move may land in a domain folder at any depth as
 * well as at the root.
 */
export function docMigrationScope(ignored: string[] = [], folders: DraftFolders = 'flat'): Scope {
  const specGlobs = folders === 'flat' ? [SPECS_GLOB] : [SPECS_GLOB, SPECS_ANY_GLOB]
  return {
    readable: [`${DOCS_DIR}/**`, README_GLOB, SPECS_ANY_GLOB, ...DECISION_FILES],
    // A doc cut is offered, never made, until the user agrees. A ruling that a
    // doc is current, and a migrated draft once its features are picked, are
    // already the user's word, not a new write to confirm: writing them is
    // this job's own bookkeeping and deliverable, like a planner's.
    writable: [...DECISION_FILES, ...specGlobs],
    // The docs are the user's, the README among them: each cut or rewrite is one confirmed write.
    askable: [`${DOCS_DIR}/**`, README_GLOB],
    ignored,
  }
}

/** One existing spec not offered for a move when specs are sorted into folders, and why. */
export type BlockedMove = { feature: string; path: string; waiting: string }

/** What `waiting` says for each stage a feature's build may be caught at; a stage missing here is movable. */
const BLOCKING_WAIT: Partial<Record<PlanStage, string>> = {
  under_review: 'a review in flight',
  ruling: 'a decision to rule',
  under_development: 'an unfinished board',
}

/**
 * Every existing spec whose build has something in flight, for the offer to
 * sort specs into folders: read from the working files this job otherwise
 * never sees, since knowing a feature is mid-review, mid-ruling or mid-board
 * takes more than the docs and the specs alone. A feature not listed here is
 * free to be proposed for a move.
 */
export async function specsWithWorkInFlight(cwd: string): Promise<BlockedMove[]> {
  const blocked: BlockedMove[] = []
  for (const { slug, path, folder } of await specFiles(join(cwd, SPECS_DIR))) {
    const text = await readOptional(path)
    if (text === undefined) continue
    const spec: SpecState = { exists: true, status: statusOf(text), body: bodyOf(text), built: builtOf(text) }
    const [review, tasks, decisions] = await Promise.all([readReview(reviewPath(cwd, slug)), readTasks(tasksPath(cwd, slug)), readDecisions(decisionsPath(cwd, slug))])
    const waiting = BLOCKING_WAIT[planStage(spec, review, tasks, decisions)]
    if (waiting) blocked.push({ feature: featureNameOf(text, slug), path: `${SPECS_DIR}/${folder ? `${folder}/` : ''}${slug}.spec.md`, waiting })
  }
  return blocked
}

/**
 * Write and Edit are here for the docs changes the user confirms and for the
 * migrated drafts the job writes outright; Move is here for a picked move
 * once specs are sorted into folders, so the file travels as it stands
 * rather than being rewritten.
 */
export const DOC_MIGRATION_TOOLS = ['Read', 'Glob', MARKDOWN_SEARCH_TOOL, SPEC_SEARCH_TOOL, 'Write', 'Edit', 'MultiEdit', 'Move', ASK_USER_TOOL]

/** The first message: there is nothing to configure, so the session starts on the job. */
export function docMigrationKickoff(): string {
  return 'Clean up the docs, starting with pruning what the settled specs already say. Propose first; change nothing yet.'
}

/**
 * Cleaning up the docs, as a system prompt. Three stages, taken in order and
 * each proposed before anything is written: prune what a settled spec already
 * says, turn behaviour no spec holds into draft specs, tidy how what stays is
 * arranged. Judgment is always made per section, never per doc.
 */
export function docMigrationPrompt(cwd: string, folders: DraftFolders = 'flat', existingFolders: string[] = [], blockedMoves: BlockedMove[] = []): string {
  const proposal = `propose the domain folder its spec would land in: a folder under \`${SPECS_DIR}/\`, nested (\`orders/returns\`) where the domain is a part of a wider one, read from the sections it comes from and the domain language of the docs. Reuse one of the folders the workspace already has${existingFolders.length > 0 ? ` (${existingFolders.map((f) => `\`${f}\``).join(', ')})` : ''} where the feature belongs there, rather than coining a synonym of it.`
  const folderNote = {
    'by-domain': ` Alongside each feature, ${proposal}`,
    'root-first': ` Drafts land at the root of \`${SPECS_DIR}/\` unless the user took the offer to sort the specs into folders or asks for folders; then, alongside each feature, ${proposal}`,
    flat: '',
  }[folders]
  const draftPath = {
    'by-domain': `\`${SPECS_DIR}/<folder>/<slug>.spec.md\` with Write, \`<folder>\` the one proposed for that feature, kept or changed by the user,`,
    'root-first': `\`${SPECS_DIR}/<slug>.spec.md\` with Write, or \`${SPECS_DIR}/<folder>/<slug>.spec.md\` where a folder was settled for that feature,`,
    flat: `\`${SPECS_DIR}/<slug>.spec.md\` with Write,`,
  }[folders]
  const sortOffer = folders === 'flat' ? '' : sortOfferSection(existingFolders, blockedMoves)
  return `You are cleaning up a software product's documentation, under ${cwd}. This is a maintenance job the user picks on its own, not a step of planning a feature.

The goal: every piece of product behaviour lives in a spec, and the docs hold everything else (the domain and its language, constraints every feature respects, architecture and rationale, features not yet planned), arranged so a planner finds and cites it. A feature here is planned blind: the planner reads \`${DOCS_DIR}/**\`, the README and the specs, never the code, and writes rules that cite a doc section as \`path#Heading\`. Behaviour written twice, once in a doc and once in the spec that now defines it, lets the doc go stale without anyone noticing; a doc the planner cannot find its way through costs it reading, or a citation that leads nowhere.

Three stages, in this order:
1. Prune: offer to cut what a settled spec already says.
2. Draft specs: offer to turn behaviour no spec holds into draft specs.
3. Tidy what stays: say where the remaining docs' arrangement costs a planner, and fix what the user picks.
Each stage proposes in chat and waits for the user's answer before anything is written; move on only once the current stage is settled. The user may skip a stage or stop after any of them. You never rewrite prose for style and you never read the code, at any point in the job.

What you may read: \`${DOCS_DIR}/**\`, the README, and every spec under \`${SPECS_ANY_GLOB}\`. Nothing else exists for you; do not try. ${DOC_READING} ${EDIT_WRITING}

**Only a settled spec counts.** A spec the user has approved is what the product says, whatever stage its build has reached; a draft is still a proposal, and a doc section is never reported as covered by one.

**Outline first, judge after.** The docs map in this prompt outlines every doc you may read, section by section, with each section's line range. Start from that outline rather than opening a doc cold, and make every later judgment, covered or contradicting, in scope or out, about one section at a time, never about a doc as a whole.

**A section is in scope only when its content describes product behaviour.** Architecture, rationale, guidelines, a settings reference, how a thing is built: out of scope, whatever file or folder it happens to sit in. Judge a section by what it says, not by where it lives.
${sortOffer}
**Stage one, prune.** Sort every in-scope section against the settled specs before you offer anything.

**Covered section.** A section whose behaviour a settled spec now defines is reported in chat naming the spec and the rules that cover it, and offered for removal.
**Partly covered section.** When only part of a section is covered, what you offer for removal is that part; leave the rest standing.
**Doc left empty.** A doc left with nothing but its title is offered for deletion too, together with the index entries and the links that point at it.
**Contradicting section.** A section that says otherwise than a settled spec is reported in chat, naming the spec and the rule it disagrees with, and never offered for removal: which side is current is the user's to say, not yours.
**Contradiction the person rules on.** When the user says the doc is current, record the ruling as an unfiled decision naming the feature whose spec it reaches, with Edit on \`${UNFILED_FILE}\`: ${UNFILED_DECISIONS} The spec is not edited here.
**Cited section kept whole.** Before you offer a section for removal, check with ${SPEC_SEARCH_TOOL} whether an approved spec's rule cites it as \`path#Heading\`. If one does, do not offer the section without naming every citation that would have to change with it.
**Nothing covered.** If you go through the docs and find no covered section, say so in chat and go on to stage two.

Every write into \`${DOCS_DIR}/**\` or the README, in any stage, is put to the user first and made only once they say so, one write at a time; nothing is cut or rewritten on your own say-so. ${REFERENCE_DIRECTION}

**Stage two, draft specs.** Turn what the docs still say about product behaviour that no spec holds into specs of their own.

**Offered when pruning is settled.** Do not raise stage two while a covered section you reported is still waiting on the user; once every one has an answer, or at once when pruning found none, move on to it.
**Feature list first.** Propose in chat one line per feature you read out of the sections pruning left standing, naming the sections it comes from. A feature is what a user would plan and ship as a unit; a doc about one capability is usually one feature, a doc covering several is several. Wait for the user to say which become specs.${folderNote}
**Built or planned.** Mark each proposed feature as behaviour the code already has or behaviour not yet built. The user corrects a wrong mark, since it decides what the check against the code means once the spec is approved: carry the mark into the draft's front matter as \`built: true\` or \`built: false\`.
**One draft per pick.** For each feature picked, write ${draftPath} \`<slug>\` the feature's name lower-cased, accents dropped, every run of other characters turned into \`-\`; \`status: draft\` always, the extension records every status after it as the build moves, and \`authored: drafted\` always, so the pick-up list says this draft came from the docs, not from a conversation or by hand. ${SPEC_CONTRACT.trim()} Derive every rule from the doc sections alone: you have not read the code and do not start now.
**Source sections left standing.** Writing a draft does not cut the sections it came from; leave them exactly as they are. A later run of this job offers them for removal once that spec is settled, the same as any covered section.
**Reviewed as any draft.** A migrated draft is reviewed and approved in the plan view like any other spec; you never set its status to \`approved\` yourself.

**Stage three, tidy what stays.** Once drafting is settled or skipped, judge how the docs that remain are arranged for the planner: how much it has to read before it finds an answer, and whether it can cite what it found. Only that: not the prose, not whether the docs are right, not whether they are complete; they are meant to be to the point. Sections stage two drafted from stay out of it: a later run prunes them once their spec is settled.

What counts as a finding:
- a doc long enough that answering one question means reading all of it, where its sections would stand on their own
- a heading that does not say what is under it, so neither the map's line nor a citation to it helps
- one subject spread over several docs with nothing linking them, so finding one part does not lead to the rest
- a folder with no way in: no index, so the only way to know what is there is to open every file
- a term the docs lean on but define nowhere, or define in passing under a heading about something else, so no rule can cite its definition
- a passage a rule would want to cite that sits under no heading of its own

Say them in chat, one line per finding: the section as \`path#Heading\` (or the doc, when it is the whole file), what it costs a planner today, and the change in one sentence. Strongest first: what saves the most reading, or fixes the most citations. A finding earns its place only if a planner is measurably better off; if what stays already reads well, say so in one line, which is a good result, not a failure. Then wait for the user to pick.

**Cited headings are load-bearing.** Before you propose a change to a heading, search the specs for it with ${SPEC_SEARCH_TOOL}: a rule that cites it comes back with the citation. Renaming or moving it breaks that citation, and nothing in this product would report it, so name every citation that would have to follow on the finding's own line. When you make a picked change, keep every cited heading as it stands unless the user said to change it knowing what it costs, and a doc that is split keeps its headings in its parts, so the citations still land.

If a judgment needs something only the user can settle, ask with \`${ASK_USER_TOOL}\` rather than guessing.`
}

/**
 * The offer to sort the specs that already exist into folders: asked once,
 * separately from the three stages, so taking it or declining it never moves
 * a stage or changes their order.
 */
function sortOfferSection(existingFolders: string[], blockedMoves: BlockedMove[]): string {
  const reused = existingFolders.length > 0 ? ` (${existingFolders.map((f) => `\`${f}\``).join(', ')})` : ''
  const blocked =
    blockedMoves.length > 0
      ? ` Right now that rules out: ${blockedMoves.map((b) => `"${b.feature}" (${b.path}), waiting on ${b.waiting}`).join('; ')}.`
      : ''
  return `
Separately from the three stages above, and never as one of them, ask once at the start whether to sort the specs that already exist into domain folders: taking the offer or declining it leaves the three stages and their order untouched, and you move on to stage one either way.

**Proposal before any move.** If the person takes it, propose it in chat before moving anything: name every spec and the domain folder it would go to, reusing a folder the workspace already has${reused} rather than coining a synonym of it. Nothing moves until the person says which proposed moves to make; only those are made.
**Already in a folder.** A spec that already sits in a folder is shown as it stands, and proposed for a move only where its folder does not match the domain the others sorted into; one already in the right folder is left alone.
**Feature with work in flight.** A feature with a review in flight, a decision to rule or an unfinished board is listed as not movable now, saying what it waits for, rather than being moved.${blocked}
**A move keeps the feature.** Make a picked move with \`Move\`, never \`Write\` or \`Edit\`, so the file travels as it stands: its name, status, rules and their names, and its review and board are unchanged by the move.
**Citations follow the move.** Before moving a spec, search with ${SPEC_SEARCH_TOOL} for every citation of its path and rewrite each to the new path with Edit, as part of the same change, so no rule is left citing a file that is gone.
`
}
